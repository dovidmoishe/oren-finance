import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { APP_ENV } from '../../config/constants';
import { backgroundWorkersEnabled } from '../../config/deployment';
import type { AppEnv } from '../../config/env.schema';
import {
  MarketEventsRepository,
  type MarketEventSyncStatus,
} from './market-events.repository';
import {
  MARKET_EVENTS_SYNC_JOB,
  MarketEventsSync,
  failureCode,
} from './market-events.sync';
import { OfficialDataClient } from './official-data.client';
import { UsEquityCalendarService } from './us-equity-calendar.service';
import {
  addDays,
  etInstant,
  type UsEquityCalendar,
} from './us-equity-calendar';

/**
 * New York times to refresh: after the 8:30 a.m. prints reach the agencies'
 * APIs, and again after the 2:00 p.m. FOMC statement. That is the brief's
 * one-to-two passes per day.
 */
export const SYNC_SLOTS_ET = [10 * 60 + 15, 17 * 60 + 15] as const;
const CHECK_INTERVAL_MS = 15 * 60_000;
const LEASE_MS = 10 * 60_000;
const RETRY_AFTER_FAILURE_MS = 60 * 60_000;

/** The most recent refresh slot at or before `now`. */
export function latestSyncSlot(calendar: UsEquityCalendar, now: Date): Date {
  const { date, minute } = calendar.etClock(now);
  const passed = SYNC_SLOTS_ET.filter((slot) => slot <= minute);
  return passed.length
    ? etInstant(date, Math.max(...passed))
    : etInstant(addDays(date, -1), Math.max(...SYNC_SLOTS_ET));
}

/** Due once per slot; after a failed pass, wait an hour before trying again. */
export function syncDue(
  calendar: UsEquityCalendar,
  state: MarketEventSyncStatus | null,
  now: Date,
): boolean {
  if (
    state?.lastSuccessAt &&
    state.lastSuccessAt.getTime() >= latestSyncSlot(calendar, now).getTime()
  )
    return false;
  const failedRecently =
    state?.lastAttemptAt &&
    state.lastErrorCode &&
    !state.lastErrorCode.startsWith('partial') &&
    (!state.lastSuccessAt || state.lastAttemptAt > state.lastSuccessAt) &&
    now.getTime() - state.lastAttemptAt.getTime() < RETRY_AFTER_FAILURE_MS;
  return !failedRecently;
}

/**
 * Background refresh of the official macro calendar. A timer inside the API
 * process, not a new production process; previews never run it. Dates, BLS
 * values, claims, and FOMC decisions need no key; GDP and PCE values need
 * BEA_API_KEY and retail sales need CENSUS_API_KEY.
 */
@Injectable()
export class MarketEventsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketEventsWorker.name);
  private readonly owner = randomUUID();
  private timer?: NodeJS.Timeout;
  private running = false;
  /** After a pass fails before it could record why, stay quiet for a while. */
  private pausedUntil = 0;

  constructor(
    private readonly repository: MarketEventsRepository,
    private readonly calendar: UsEquityCalendarService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  onModuleInit() {
    if (!backgroundWorkersEnabled()) return;
    const missing = [
      !this.env.BEA_API_KEY && 'BEA_API_KEY (GDP and PCE values)',
      !this.env.CENSUS_API_KEY && 'CENSUS_API_KEY (retail sales values)',
    ].filter(Boolean);
    if (missing.length)
      this.logger.log(
        `Official US macro calendar: ${missing.join(' and ')} not set; those releases will show dates without published values.`,
      );
    this.timer = setInterval(() => void this.tick(), CHECK_INTERVAL_MS);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now: Date = new Date()): Promise<void> {
    if (this.running || now.getTime() < this.pausedUntil) return;
    this.running = true;
    let leased = false;
    try {
      const state = await this.repository.syncState(MARKET_EVENTS_SYNC_JOB);
      if (!syncDue(this.calendar, state, now)) return;
      leased = await this.repository.claimSync(
        MARKET_EVENTS_SYNC_JOB,
        this.owner,
        LEASE_MS,
      );
      if (!leased) return;
      const report = await new MarketEventsSync(
        new OfficialDataClient({
          bls: this.env.BLS_API_KEY,
          bea: this.env.BEA_API_KEY,
          census: this.env.CENSUS_API_KEY,
        }),
        this.repository,
        this.calendar,
      ).run(now);
      await this.repository.finishSync(MARKET_EVENTS_SYNC_JOB, this.owner, {
        ok: true,
        note: report.failures.length
          ? `partial:${report.failures.slice(0, 8).join(',')}`.slice(0, 240)
          : undefined,
      });
      this.logger.log(
        `Macro calendar refreshed: ${report.scheduled} scheduled, ${report.released} released, ${report.waiting} waiting, ${report.cancelled} cancelled, ${report.missed ? `${report.missed} missed, ` : ''}${report.failures.length} failed${report.failures.length ? ` (${report.failures.join(',')})` : ''}${report.skipped.length ? `, no key for ${report.skipped.join(',')}` : ''}${report.warnings.length ? `, ${report.warnings.join(',')}` : ''}`,
      );
    } catch (error) {
      this.logger.warn(`Macro calendar refresh failed: ${failureCode(error)}`);
      if (leased)
        await this.repository
          .finishSync(MARKET_EVENTS_SYNC_JOB, this.owner, {
            ok: false,
            code: failureCode(error),
          })
          .catch(() => undefined);
      // Without a lease the failure is not recorded (for example, migration
      // 0028 has not run), so back off here instead.
      else this.pausedUntil = now.getTime() + RETRY_AFTER_FAILURE_MS;
    } finally {
      this.running = false;
    }
  }
}
