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
import { PAPER_MODEL, PAPER_STRATEGIES } from '../../types/paper';
import { PaperService } from './paper.service';
import { DAY } from './strategy';

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
      const first =
        runs.at(-1) ??
        (await this.paper.start(
          experiment.owner,
          experiment.asset,
          'buy-hold-v1',
        ));
      const endsAt = +first.createdAt + experiment.duration;
      if (Date.now() >= endsAt) {
        for (const run of runs.filter((r) => r.active))
          await this.paper.setActive(experiment.owner, run.id, false);
        return;
      }
      for (const strategy of PAPER_STRATEGIES) {
        if (
          strategy !== first.strategy &&
          !runs.some((r) => r.strategy === strategy)
        )
          await this.paper.start(
            experiment.owner,
            experiment.asset,
            strategy,
            first.mint,
          );
      }
      await this.paper.tick({ owner: experiment.owner, endsAt });
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
    return {
      asset: experiment.asset,
      pr: experiment.pr,
      deployedCommit: this.env.COMMIT_SHA,
      startedAt,
      endsAt,
      status: !endsAt
        ? 'starting'
        : Date.now() < +endsAt
          ? 'observing'
          : 'ended',
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
