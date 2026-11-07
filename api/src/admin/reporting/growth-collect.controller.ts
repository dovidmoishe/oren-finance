import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { APP_ENV } from '../../config/constants';
import type { AppEnv } from '../../config/env.schema';
import { cleanUtm } from './growth-attribution';
import { decideCollect } from './growth-collect';
import { GrowthRecorder } from './growth-recorder.service';

const buckets = new Map<string, { count: number; reset: number }>();

@Controller('growth')
export class GrowthCollectController {
  constructor(
    private readonly recorder: GrowthRecorder,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  @Post('collect')
  @HttpCode(204)
  async collect(@Body() body: unknown, @Req() request: Request): Promise<void> {
    if (!this.env.GROWTH_COLLECT_ENABLED) return;
    if (!this.allowed(request)) {
      throw new HttpException({ reason: 'rate_limited' }, 429);
    }
    if (!body || typeof body !== 'object')
      throw new BadRequestException({ reason: 'body' });
    const decision = decideCollect(
      body as Record<string, unknown>,
      new Date(),
      this.env.GROWTH_HASH_KEY || 'oren-growth-unset-pepper',
      this.env.GROWTH_EXCLUDE_HOSTS,
    );
    if (decision.status === 'rejected') {
      throw new BadRequestException({ reason: decision.reason });
    }
    if (decision.status === 'pageview')
      await this.recorder.recordPageview(decision.draft);
    if (decision.status === 'setup_cta') {
      const utm = cleanUtm(decision.utm ?? {});
      await this.recorder.recordSetup({
        occurredAt: decision.occurredAt,
        sourceId: decision.sourceId,
        sessionHash: decision.sessionHash,
        slot: decision.slot,
        utm: utm
          ? { ...utm, at: decision.occurredAt.toISOString() }
          : undefined,
      });
    }
  }

  private allowed(request: Request): boolean {
    const ip = request.ip || 'unknown';
    const now = Date.now();
    const bucket = buckets.get(ip);
    if (!bucket || bucket.reset < now) {
      buckets.set(ip, { count: 1, reset: now + 60_000 });
      if (buckets.size > 5000) buckets.clear();
      return true;
    }
    bucket.count += 1;
    return bucket.count <= 60;
  }
}
