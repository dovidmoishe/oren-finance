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
import { PreviewBenchmark } from './preview-benchmark';

@Injectable()
export class PaperWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PaperWorker.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly service: PaperService,
    private readonly benchmark: PreviewBenchmark,
  ) {}
  onModuleInit() {
    const preview = this.benchmark.enabled;
    if (
      !preview &&
      (!this.env.PAPER_TRADING_ENABLED || !backgroundWorkersEnabled())
    )
      return;
    this.timer = setInterval(
      () => {
        this.running ??= (preview ? this.benchmark.poll() : this.service.tick())
          .catch(() => {
            this.log.error('Paper worker poll failed');
          })
          .finally(() => {
            this.running = undefined;
          });
      },
      preview ? 60000 : 15000,
    );
    this.timer.unref();
  }
  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running;
  }
}
