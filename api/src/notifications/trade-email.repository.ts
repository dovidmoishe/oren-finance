import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import { DRIZZLE } from '../config/constants';
import type { Database } from '../database/database.provider';
import {
  tradeEmailPreferences,
  tradeFills,
  tradeReceiptJobs,
} from '../database/schema';

export type TradeReceiptJob = typeof tradeReceiptJobs.$inferSelect;

@Injectable()
export class TradeEmailRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async enabled(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ enabled: tradeEmailPreferences.tradeReceiptsEnabled })
      .from(tradeEmailPreferences)
      .where(eq(tradeEmailPreferences.userId, userId))
      .limit(1);
    return row?.enabled ?? false;
  }

  async setEnabled(userId: string, enabled: boolean): Promise<void> {
    await this.db
      .insert(tradeEmailPreferences)
      .values({ userId, tradeReceiptsEnabled: enabled, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: tradeEmailPreferences.userId,
        set: { tradeReceiptsEnabled: enabled, updatedAt: new Date() },
      });
  }

  async claimJobs(limit = 20): Promise<TradeReceiptJob[]> {
    const staleBefore = new Date(Date.now() - 10 * 60_000);
    await this.db
      .update(tradeReceiptJobs)
      .set({ status: 'retry', lockedAt: null })
      .where(
        and(
          eq(tradeReceiptJobs.status, 'processing'),
          lt(tradeReceiptJobs.lockedAt, staleBefore),
        ),
      );

    const candidates = await this.db
      .select()
      .from(tradeReceiptJobs)
      .where(
        and(
          inArray(tradeReceiptJobs.status, ['pending', 'retry']),
          lte(tradeReceiptJobs.availableAt, new Date()),
          or(
            isNull(tradeReceiptJobs.lockedAt),
            lt(tradeReceiptJobs.lockedAt, staleBefore),
          ),
        ),
      )
      .orderBy(asc(tradeReceiptJobs.availableAt))
      .limit(limit);

    const claimed: TradeReceiptJob[] = [];
    for (const candidate of candidates) {
      const [row] = await this.db
        .update(tradeReceiptJobs)
        .set({
          status: 'processing',
          lockedAt: new Date(),
          attempts: candidate.attempts + 1,
        })
        .where(
          and(
            eq(tradeReceiptJobs.id, candidate.id),
            inArray(tradeReceiptJobs.status, ['pending', 'retry']),
          ),
        )
        .returning();
      if (row) claimed.push(row);
    }
    return claimed;
  }

  async receipt(job: TradeReceiptJob) {
    const [row] = await this.db
      .select({
        ticker: tradeFills.ticker,
        side: tradeFills.side,
        stockAmount: tradeFills.stockAmount,
        usdNotional: tradeFills.usdNotional,
        blockTime: tradeFills.blockTime,
      })
      .from(tradeFills)
      .where(
        and(
          eq(tradeFills.executionId, job.executionId),
          eq(tradeFills.transactionSignature, job.transactionSignature),
        ),
      )
      .limit(1);
    return row;
  }

  async complete(jobId: string): Promise<void> {
    await this.db
      .update(tradeReceiptJobs)
      .set({ status: 'completed', completedAt: new Date(), lockedAt: null })
      .where(eq(tradeReceiptJobs.id, jobId));
  }

  async retry(job: TradeReceiptJob): Promise<void> {
    const dead = job.attempts >= 12;
    const delayMs = Math.min(
      6 * 60 * 60_000,
      10_000 * 2 ** Math.max(0, job.attempts - 1),
    );
    await this.db
      .update(tradeReceiptJobs)
      .set({
        status: dead ? 'dead' : 'retry',
        lockedAt: null,
        availableAt: new Date(Date.now() + delayMs),
      })
      .where(eq(tradeReceiptJobs.id, job.id));
  }
}
