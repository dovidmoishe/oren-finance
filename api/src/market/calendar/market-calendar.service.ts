import { Injectable, Logger } from '@nestjs/common';
import type {
  MacroEventKind,
  MarketCalendarDay,
  MarketCalendarResponse,
  MarketEvent,
  MarketEventUnit,
  MarketEventsResponse,
  UsEquitySessionMode,
  UsEquitySessionResponse,
} from '../../../types/market-calendar';
import {
  OFFICIAL_AGENCIES,
  OFFICIAL_EVENTS_NOTE,
  US_CASH_SESSION_NOTE,
  isOfficialAgencyId,
  officialAttribution,
} from './market-calendar.copy';
import { MACRO_EVENT_KINDS, isMacroEventKind } from './macro-catalog';
import {
  MarketEventsRepository,
  type StoredMarketEvent,
} from './market-events.repository';
import { MARKET_EVENTS_SYNC_JOB } from './market-events.sync';
import {
  UsEquityCalendarRangeError,
  US_EQUITY_TIME_ZONE,
  addDays,
  etInstant,
  parseCivilDate,
  usEquityCalendar,
} from './us-equity-calendar';
import { UsEquityCalendarService } from './us-equity-calendar.service';

/** Longest /api/calendar/events range, in days. */
export const MAX_EVENT_RANGE_DAYS = 93;
/** Longest copilot/MCP market-calendar range, in days. */
export const MAX_CALENDAR_RANGE_DAYS = 31;

const NOT_SYNCED_REASON =
  'The official US release calendar has not been loaded yet. Try again later.';
const UNAVAILABLE_REASON =
  'The official US release calendar is unavailable right now.';
const NO_EVENTS_REASON = 'No official US releases are scheduled in this range.';

const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * One facade for "is the market open" and "what's on the calendar", shared
 * by the HTTP API, the copilot, and MCP so every caller gets the same
 * payloads. Hours come from the in-process calendar; events come only from
 * Postgres (the refresh worker is the only caller of the agencies' APIs).
 */
@Injectable()
export class MarketCalendarService {
  private readonly logger = new Logger(MarketCalendarService.name);

  constructor(
    private readonly hours: UsEquityCalendarService,
    private readonly events: MarketEventsRepository,
  ) {}

  isMarketOpen(
    input: {
      at?: string | Date | null;
      session?: UsEquitySessionMode | null;
    } = {},
  ): UsEquitySessionResponse {
    const at =
      input.at instanceof Date ? input.at : parseInstant(input.at ?? undefined);
    return this.hours.getSession(at ?? new Date(), input.session ?? 'regular');
  }

  /** Official macro events whose New York date falls in [from, to]. */
  async getEvents(input: {
    from: string;
    to: string;
    kinds?: readonly MacroEventKind[];
    now?: Date;
  }): Promise<MarketEventsResponse> {
    assertRange(input.from, input.to, MAX_EVENT_RANGE_DAYS);
    const kinds = input.kinds?.length
      ? [...new Set(input.kinds)]
      : [...MACRO_EVENT_KINDS];
    const now = input.now ?? new Date();
    const base = {
      from: input.from,
      to: input.to,
      timeZone: US_EQUITY_TIME_ZONE,
      kinds,
      note: OFFICIAL_EVENTS_NOTE,
    };
    try {
      const [rows, state] = await Promise.all([
        this.events.listRange(
          etInstant(input.from, 0),
          etInstant(addDays(input.to, 1), 0),
          kinds,
        ),
        this.events.syncState(MARKET_EVENTS_SYNC_JOB),
      ]);
      const events = rows.map((row) => toMarketEvent(row, now));
      const syncedAt = state?.lastSuccessAt?.toISOString() ?? null;
      return {
        ...base,
        events,
        available: Boolean(syncedAt) || events.length > 0,
        reason: events.length
          ? null
          : syncedAt
            ? NO_EVENTS_REASON
            : NOT_SYNCED_REASON,
        syncedAt,
        attribution: officialAttribution(events.map((event) => event.agencyId)),
      };
    } catch (error) {
      this.logger.warn(
        `Market events read failed: ${error instanceof Error ? error.name : 'Error'}`,
      );
      return {
        ...base,
        events: [],
        available: false,
        reason: UNAVAILABLE_REASON,
        syncedAt: null,
        attribution: officialAttribution([]),
      };
    }
  }

  /** Trading days and official releases for today, the next 7 days, or a range. */
  async getMarketCalendar(
    input: {
      window?: 'today' | 'week' | null;
      from?: string | null;
      to?: string | null;
      now?: Date;
    } = {},
  ): Promise<MarketCalendarResponse> {
    const now = input.now ?? new Date();
    const today = this.hours.etDate(now);
    const from = input.from ?? today;
    const to = input.to ?? (input.window === 'today' ? from : addDays(from, 6));
    assertRange(from, to, MAX_CALENDAR_RANGE_DAYS);
    const days: MarketCalendarDay[] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const hours = this.hours.getHours(date);
      days.push({
        date,
        weekday: hours.weekday,
        tradingDay: hours.tradingDay,
        earlyClose: hours.earlyClose,
        holidayName: hours.holidayName,
        regularOpenEt: hours.regularOpenEt,
        regularCloseEt: hours.regularCloseEt,
        regularOpenUtc: hours.regularOpenUtc,
        regularCloseUtc: hours.regularCloseUtc,
        provisional: hours.provisional,
      });
    }
    const events = await this.getEvents({ from, to, now });
    return {
      scope: 'us_equity_cash_session',
      timeZone: US_EQUITY_TIME_ZONE,
      from,
      to,
      now: this.hours.getSession(now, 'regular'),
      days,
      events: events.events,
      eventsAvailable: events.available,
      eventsReason: events.reason,
      notes: [US_CASH_SESSION_NOTE, OFFICIAL_EVENTS_NOTE],
      attribution: events.attribution,
    };
  }
}

/** Strict ISO 8601 instant with an explicit offset, or undefined when absent. */
export function parseInstant(value: string | undefined): Date | undefined {
  if (value === undefined || value === '') return undefined;
  if (!ISO_INSTANT.test(value))
    throw new UsEquityCalendarRangeError(
      'Use an ISO 8601 time with an offset, for example 2026-11-27T14:30:00Z',
    );
  const at = new Date(value);
  if (Number.isNaN(at.getTime()))
    throw new UsEquityCalendarRangeError(`Invalid time: ${value}`);
  return at;
}

export function parseEventKinds(value: string | undefined): MacroEventKind[] {
  if (!value) return [];
  const kinds = value
    .split(',')
    .map((kind) => kind.trim())
    .filter(Boolean);
  for (const kind of kinds)
    if (!isMacroEventKind(kind))
      throw new UsEquityCalendarRangeError(
        `Unknown event kind "${kind}". Use: ${MACRO_EVENT_KINDS.join(', ')}`,
      );
  return kinds as MacroEventKind[];
}

function assertRange(from: string, to: string, maxDays: number) {
  parseCivilDate(from);
  parseCivilDate(to);
  if (from > to)
    throw new UsEquityCalendarRangeError('`from` must be on or before `to`');
  if (addDays(from, maxDays - 1) < to)
    throw new UsEquityCalendarRangeError(
      `A range can cover at most ${maxDays} days`,
    );
}

const UNIT_LABELS: Record<MarketEventUnit, string> = {
  percent_change: '% change from prior month',
  percent_saar: '% change from prior quarter, annualized',
  thousands_change: 'change in jobs, thousands',
  count: 'initial claims',
  percent_range: 'federal funds target range',
};

/**
 * Public shape of a stored event. Only named fields; never the raw payload.
 * A release whose time has passed is `released` even before its published
 * value is stored: the agency put it out, and `actual` stays null until the
 * refresh reads it.
 */
export function toMarketEvent(
  row: StoredMarketEvent,
  now: Date = new Date(),
): MarketEvent {
  const raw: Record<string, unknown> = row.raw ?? {};
  const result =
    raw.result && typeof raw.result === 'object'
      ? (raw.result as Record<string, unknown>)
      : {};
  const unit =
    typeof row.unit === 'string' && row.unit in UNIT_LABELS
      ? (row.unit as MarketEventUnit)
      : null;
  const actual = toNumber(row.actual);
  const previous = toNumber(row.previous);
  const dateEt = text(raw.dateEt) ?? usEquityCalendar.etDate(row.scheduledAt);
  const clock = usEquityCalendar.etClock(row.scheduledAt);
  const agencyId = isOfficialAgencyId(raw.agencyId)
    ? raw.agencyId
    : isOfficialAgencyId(row.source)
      ? row.source
      : 'frb';
  const status =
    row.dateStatus === 'scheduled' && row.scheduledAt <= now
      ? 'released'
      : row.dateStatus;
  return {
    id: row.id,
    family: row.family,
    kind: row.kind as MacroEventKind,
    title: row.title,
    country: row.country,
    agencyId,
    agency: text(raw.agency) ?? OFFICIAL_AGENCIES[agencyId].name,
    scheduledAt: row.scheduledAt.toISOString(),
    dateEt,
    timeEt:
      row.timePrecision === 'datetime'
        ? (text(raw.timeEt) ?? hhmm(clock.minute))
        : null,
    timePrecision: row.timePrecision,
    timeBasis: raw.timeBasis === 'customary' ? 'customary' : 'published',
    dateBasis: raw.dateBasis === 'computed' ? 'computed' : 'published',
    status,
    actual,
    previous,
    unit,
    unitLabel: unit ? UNIT_LABELS[unit] : null,
    actualText: formatValue(actual, unit, toNumber(result.lowerActual)),
    previousText: formatValue(previous, unit, toNumber(result.lowerPrevious)),
    referencePeriod: text(result.referencePeriod) ?? text(raw.referencePeriod),
    referenceLabel: text(result.referenceLabel) ?? text(raw.referenceLabel),
    sourceUrl: row.sourceUrl,
    dataSourceUrl: text(result.url),
    retrievedAt: text(result.retrievedAt),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Agency-style rounding: one decimal for percents, whole thousands for jobs. */
export function formatValue(
  value: number | null,
  unit: MarketEventUnit | null,
  lower?: number | null,
): string | null {
  if (value === null || unit === null) return null;
  const signed = (text: string, number: number) =>
    number > 0 ? `+${text}` : text;
  // `|| 0` turns a rounded -0 into 0 so "-0.0%" never appears.
  const tenths = Number(value.toFixed(1)) || 0;
  const whole = Math.round(value) || 0;
  switch (unit) {
    case 'percent_change':
    case 'percent_saar':
      return `${signed(tenths.toFixed(1), tenths)}%`;
    case 'thousands_change':
      return `${signed(whole.toLocaleString('en-US'), whole)}K`;
    case 'count':
      return whole.toLocaleString('en-US');
    case 'percent_range':
      return lower === null || lower === undefined
        ? `${value.toFixed(2)}% (upper limit)`
        : `${lower.toFixed(2)}%–${value.toFixed(2)}%`;
  }
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
