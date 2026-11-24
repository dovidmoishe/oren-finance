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
import { retentionBoundary } from './growth-time';
import { GrowthRepository } from './growth.repository';

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
      await this.repository.rollupPageviews(
        now,
        boundary.cutoff,
        boundary.purgeBefore,
      );
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
      try {
        if (leased) await this.repository.releaseRollup(this.owner);
      } catch {
        this.logger.warn(
          'Growth rollup lease will expire after release failure',
        );
      } finally {
        this.running = false;
      }
    }
  }
}
