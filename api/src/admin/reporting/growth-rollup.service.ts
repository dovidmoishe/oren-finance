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
import { zonedDay } from './growth-time';
import { GrowthRepository } from './growth.repository';

/** Restart-safe aggregation inside the API process. A laptop is not part of this path. */
@Injectable()
export class GrowthRollupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GrowthRollupService.name);
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
  }

  async tick(): Promise<void> {
    if (!backgroundWorkersEnabled() || this.running) return;
    this.running = true;
    try {
      const cutoff = new Date(
        Date.now() - this.env.GROWTH_RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );
      const loaded = await this.repository.pageviewsBetween(cutoff, new Date());
      if (loaded.length > 50000) {
        this.logger.warn(
          'Growth rollup left raw rows in place because the window is too large',
        );
      } else {
        const rows = loaded.map(toRaw);
        for (const timezone of ['UTC', 'Africa/Lagos'] as const) {
          const rolled = rollPageviews(rows, timezone, (instant) =>
            zonedDay(instant, timezone),
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
          );
        }
      }
      await this.repository.freezeBefore(zonedDay(cutoff, 'UTC'));
      await this.repository.purgeRaw(cutoff, 1000);
      await this.repository.purgeIdentities(
        new Date(
          Date.now() -
            this.env.GROWTH_IDENTITY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
        ),
      );
      await this.repository.markCheckpoint('rollup');
    } catch (error) {
      this.logger.warn(
        `Growth rollup failed: ${error instanceof Error ? error.name : 'Error'}`,
      );
    } finally {
      this.running = false;
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
