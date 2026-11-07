import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { backgroundWorkersEnabled } from '../../config/deployment';
import { APP_ENV } from '../../config/constants';
import type { AppEnv } from '../../config/env.schema';
import { rollPageviews, type RawPageview } from './growth-maintenance';
import { dayBounds, retentionBoundary, zonedDay } from './growth-time';
import { GrowthRepository } from './growth.repository';

const MAX_RAW_ROWS = 50_000;

/** One leased pass. A second process skips until the lease expires. */
@Injectable()
export class GrowthRollupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GrowthRollupService.name);
  private readonly owner = randomUUID();
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly repository: GrowthRepository,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  onModuleInit() {
    if (!backgroundWorkersEnabled()) return;
    this.timer = setInterval(
      () => void this.tick(),
      this.env.GROWTH_ROLLUP_INTERVAL_MS,
    );
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    void this.repository.releaseRollup(this.owner);
  }

  async tick(): Promise<void> {
    if (!backgroundWorkersEnabled() || this.running) return;
    this.running = true;
    let leased = false;
    try {
      const lease = await this.repository.claimRollup(this.owner);
      if (!lease.acquired) return;
      leased = true;
      const now = new Date();
      const boundary = retentionBoundary(
        now,
        this.env.GROWTH_RAW_RETENTION_DAYS,
      );
      const aged = await this.repository.pageviewsBetween(
        new Date(0),
        boundary.purgeBefore,
      );
      if (aged.length > MAX_RAW_ROWS) {
        this.logger.warn(
          'Growth rollup left aged raw rows in place because the window is too large',
        );
      } else if (aged.length > 0) {
        await this.writeRollup(aged.map(toRaw), boundary.cutoff, 'freeze');
        await this.repository.purgeRaw(boundary.purgeBefore, MAX_RAW_ROWS);
      }
      const recent = await this.repository.pageviewsBetween(
        boundary.purgeBefore,
        now,
      );
      if (recent.length <= MAX_RAW_ROWS) {
        await this.writeRollup(
          recent.map(toRaw),
          boundary.cutoff,
          'provisional',
        );
      } else {
        this.logger.warn(
          'Growth rollup left the open window unrolled because it is too large',
        );
      }
      await this.repository.purgeIdentities(
        new Date(
          now.getTime() -
            this.env.GROWTH_IDENTITY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
        ),
      );
      await this.repository.markCheckpoint('rollup');
    } catch (error) {
      this.logger.warn(
        `Growth rollup failed: ${error instanceof Error ? error.name : 'Error'}`,
      );
    } finally {
      if (leased) await this.repository.releaseRollup(this.owner);
      this.running = false;
    }
  }

  private async writeRollup(
    rows: RawPageview[],
    cutoff: Date,
    mode: 'freeze' | 'provisional',
  ): Promise<void> {
    for (const timezone of ['UTC', 'Africa/Lagos'] as const) {
      const rolled = rollPageviews(rows, timezone, (instant) =>
        zonedDay(instant, timezone),
      ).filter((row) =>
        mode === 'freeze'
          ? dayBounds(row.day, timezone).end <= cutoff
          : dayBounds(row.day, timezone).end > cutoff,
      );
      await this.repository.replaceRollup(
        timezone,
        rolled.map((row) => ({
          day: row.day,
          grain: row.grain,
          dimension: row.dimension,
          source: row.source,
          pageviews: row.pageviews,
          sessions: row.sessions,
          dailyUniques: row.dailyUniques,
        })),
        [...new Set(rolled.map((row) => row.day))],
        mode === 'freeze',
      );
    }
  }
}

function toRaw(row: {
  occurredAt: Date;
  path: string;
  visitorHash: string;
  sessionHash: string;
  utmCampaign: string | null;
  source: 'beacon' | 'caddy';
  visitorStability: 'durable' | 'day';
}): RawPageview {
  return {
    occurredAt: row.occurredAt.toISOString(),
    path: row.path,
    visitorHash: row.visitorHash,
    sessionHash: row.sessionHash,
    campaign: row.utmCampaign ?? '',
    source: row.source,
    stability: row.visitorStability,
  };
}
