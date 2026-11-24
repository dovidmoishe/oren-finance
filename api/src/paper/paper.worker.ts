import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import type { AppEnv } from '../config/env.schema';
import { APP_ENV } from '../config/constants';
import { backgroundWorkersEnabled } from '../config/deployment';
import { PaperService } from './paper.service';

@Injectable()
export class PaperWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PaperWorker.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly service: PaperService,
  ) {}
  onModuleInit() {
    if (!this.env.PAPER_TRADING_ENABLED || !backgroundWorkersEnabled()) return;
    this.timer = setInterval(() => {
      this.running ??= this.service
        .tick()
        .catch(() => {
          this.log.error('Paper worker poll failed');
        })
        .finally(() => {
          this.running = undefined;
        });
    }, 15000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running;
  }
}
