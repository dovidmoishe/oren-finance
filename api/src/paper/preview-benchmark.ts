import {
  Controller,
  Get,
  Header,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { APP_ENV } from '../config/constants';
import type { AppEnv } from '../config/env.schema';
import { PAPER_MODEL } from '../../types/paper';
import { PaperService } from './paper.service';
import { DAY } from './strategy';
import { MarketBenchmark } from './market-benchmark';

// This opt-in belongs to the experiment PR. The preview DB persists across redeploys.
const experiment = {
  pr: 142,
  asset: 'nvidia',
  owner: 'fixture:paper:pr-142',
  duration: 2 * DAY,
};

@Injectable()
export class PreviewBenchmark {
  private lastPollAt: Date | null = null;
  private lastError: string | null = null;
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly paper: PaperService,
    private readonly market: MarketBenchmark,
  ) {}

  get enabled() {
    return (
      this.env.DEPLOYMENT_ENV === 'preview' &&
      this.env.PREVIEW_PR_NUMBER === experiment.pr
    );
  }

  async poll() {
    if (!this.enabled) return;
    this.lastPollAt = new Date();
    this.lastError = null;
    try {
      const runs = await this.paper.list(experiment.owner);
      for (const run of runs.filter((r) => r.active))
        await this.paper.setActive(experiment.owner, run.id, false);
      await this.market.poll();
    } catch (error) {
      this.lastError = 'benchmark_poll_failed';
      throw error;
    }
  }

  async report() {
    if (!this.enabled) throw new NotFoundException();
    const runs = await this.paper.list(experiment.owner);
    const startedAt = runs.at(-1)?.createdAt ?? null;
    const endsAt = startedAt && new Date(+startedAt + experiment.duration);
    const trials = await Promise.all(
      runs.map(async (run) => {
        const { events, performance } = await this.paper.activity(
          experiment.owner,
          run.id,
        );
        const observations = events
          .map(({ observedAt, barTime, evidence }) => ({
            observedAt,
            barTime,
            signal: evidence.signal,
            filled: evidence.result !== null && evidence.signal !== 'hold',
            equityUsdcRaw: evidence.result?.liquidationEquityUsdcRaw ?? null,
            error: evidence.error,
          }))
          .reverse();
        let peak = Number(PAPER_MODEL.startingUsdcRaw);
        let drawdown = 0;
        for (const mark of observations) {
          if (mark.equityUsdcRaw === null) continue;
          const equity = Number(mark.equityUsdcRaw);
          peak = Math.max(peak, equity);
          drawdown = Math.max(drawdown, 100 * (1 - equity / peak));
        }
        return {
          strategy: run.strategy,
          mint: run.mint,
          ...performance,
          active: run.active,
          lastError: run.lastError,
          nextCheckAt: run.active ? run.nextAt : null,
          fills: observations.filter((o) => o.filled).length,
          observations,
          observedDrawdownPct: observations.some(
            (o) => o.equityUsdcRaw !== null,
          )
            ? drawdown
            : null,
        };
      }),
    );
    const comparison = await this.market.report();
    return {
      ...comparison,
      archivedNvda: {
        asset: experiment.asset,
        startedAt,
        originalDeadline: endsAt,
        trials,
      },
      asset: experiment.asset,
      pr: experiment.pr,
      deployedCommit: this.env.COMMIT_SHA,
      startedAt: comparison.accounts[0]?.startedAt ?? null,
      endsAt: comparison.accounts[0]?.endsAt ?? null,
      status:
        comparison.accounts.length &&
        comparison.accounts.every((a) => a.status === 'ended')
          ? 'ended'
          : comparison.accounts.some((a) => a.status === 'observing')
            ? 'observing'
            : 'starting',
      lastPollAt: this.lastPollAt,
      pollError: this.lastError,
      trials,
    };
  }
}

@Controller('paper/benchmark')
export class PreviewBenchmarkController {
  constructor(private readonly benchmark: PreviewBenchmark) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  report() {
    return this.benchmark.report();
  }
}
