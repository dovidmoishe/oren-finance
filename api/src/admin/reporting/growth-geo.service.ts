import { readFileSync } from 'node:fs';
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
import { CountryDatabase, openCountryDatabase } from './growth-geo';

const MINUTE = 60 * 1000;
const RETRY_MS = 15 * MINUTE;
const CHECK_MS = 12 * 60 * MINUTE;

/**
 * Country for pageviews. Downloads the free DB-IP country database and checks
 * twice a day for the next monthly release, or reads GROWTH_GEOIP_DB_PATH.
 * Without a database every country is null and collection continues.
 */
@Injectable()
export class GrowthGeoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GrowthGeoService.name);
  private readonly database = new CountryDatabase({
    fetch,
    now: () => new Date(),
    logger: this.logger,
  });
  private timer?: NodeJS.Timeout;

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  country(ip: string | undefined): string | null {
    return this.database.lookup(ip);
  }

  /** Database month or file in use, or null when countries are not being recorded. */
  get version(): string | null {
    return this.database.version;
  }

  onModuleInit() {
    if (!this.env.GROWTH_COLLECT_ENABLED || !this.env.GROWTH_GEOIP_ENABLED)
      return;
    const path = this.env.GROWTH_GEOIP_DB_PATH;
    if (path) {
      try {
        this.database.use(openCountryDatabase(readFileSync(path)), 'file');
        this.logger.log(
          'Loaded the country database from GROWTH_GEOIP_DB_PATH',
        );
      } catch (error) {
        this.logger.warn(
          `GROWTH_GEOIP_DB_PATH was not loaded: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
      return;
    }
    if (backgroundWorkersEnabled()) this.schedule(0);
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(delay: number) {
    this.timer = setTimeout(() => void this.refresh(), delay);
    this.timer.unref();
  }

  private async refresh() {
    const ready = await this.database.refresh();
    this.schedule(ready ? CHECK_MS : RETRY_MS);
  }
}
