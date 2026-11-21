import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../config/constants';
import type { Database } from '../database/database.provider';
import { ataRentSponsorships } from '../database/schema';

export type AtaRentReservation = typeof ataRentSponsorships.$inferSelect;
export type ReservationResult =
  | { row: AtaRentReservation }
  | { reason: 'previous_attempt' | 'per_user_cap' | 'daily_budget' };

@Injectable()
export class AtaRentSponsorRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async reserve(input: {
    userId: string;
    wallet: string;
    mint: string;
    lamports: bigint;
    perUserCap: number;
    dailyBudgetLamports: bigint;
  }): Promise<ReservationResult> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '1000ms'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '2000ms'`);
      // Serialize budget + cap + pair admission across replicas. Never hold across RPC/signing.
      // Every status counts, including uncertain failures.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(1635017074, 1)`);
      // Crashes never make a pair reusable or release uncertain spend/lifetime capacity.
      await tx.execute(sql`UPDATE ${ataRentSponsorships}
        SET status = 'failed', failure_reason = 'stale_reservation', updated_at = now()
        WHERE status = 'reserved' AND created_at < now() - interval '5 minutes'`);
      const [existing] = await tx
        .select({ id: ataRentSponsorships.id })
        .from(ataRentSponsorships)
        .where(
          and(
            eq(ataRentSponsorships.wallet, input.wallet),
            eq(ataRentSponsorships.mint, input.mint),
          ),
        )
        .limit(1);
      if (existing) return { reason: 'previous_attempt' };
      const [usage] = await tx
        .select({
          count: sql<string>`count(*) filter (where ${ataRentSponsorships.userId} = ${input.userId})`,
          // Carry recent attempts across UTC midnight while their blockhash could still land.
          spent: sql<string>`coalesce(sum(${ataRentSponsorships.lamports}) filter (
          where ${ataRentSponsorships.createdAt} >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
          or ${ataRentSponsorships.createdAt} >= now() - interval '5 minutes'), 0)`,
        })
        .from(ataRentSponsorships);
      if (BigInt(usage.count) >= BigInt(input.perUserCap))
        return { reason: 'per_user_cap' };
      if (BigInt(usage.spent) + input.lamports > input.dailyBudgetLamports)
        return { reason: 'daily_budget' };
      const [row] = await tx
        .insert(ataRentSponsorships)
        .values({
          userId: input.userId,
          wallet: input.wallet,
          mint: input.mint,
          lamports: input.lamports.toString(),
        })
        .onConflictDoNothing({
          target: [ataRentSponsorships.wallet, ataRentSponsorships.mint],
        })
        .returning();
      return row ? { row } : { reason: 'previous_attempt' };
    });
  }

  async signature(id: string, signature: string): Promise<void> {
    await this.db
      .update(ataRentSponsorships)
      .set({ signature, updatedAt: new Date() })
      .where(eq(ataRentSponsorships.id, id));
  }

  async finish(
    id: string,
    status: 'sponsored' | 'failed',
    reason?: string,
  ): Promise<void> {
    await this.db
      .update(ataRentSponsorships)
      .set({
        status,
        failureReason: reason ?? null,
        updatedAt: new Date(),
        ...(status === 'sponsored' ? { sponsoredAt: new Date() } : {}),
      })
      .where(eq(ataRentSponsorships.id, id));
  }
}
