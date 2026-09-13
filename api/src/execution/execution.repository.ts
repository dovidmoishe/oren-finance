import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../config/constants';
import type { Database } from '../database/database.provider';
import { executions } from '../database/schema';
import type { ExecutionStatus, ExecutionType } from '../../types/execution';

export type ExecutionRow = typeof executions.$inferSelect;

export interface InsertExecutionInput {
  walletAddress: string;
  type: ExecutionType;
  assetId?: string;
  ticker?: string;
  tokenMint?: string;
  inputAsset?: string;
  outputAsset?: string;
  amount?: number;
  amountUsd?: number;
  provider?: string;
  status: ExecutionStatus;
  transactionSignature?: string;
}

@Injectable()
export class ExecutionRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async insert(input: InsertExecutionInput): Promise<ExecutionRow> {
    const [row] = await this.db
      .insert(executions)
      .values({
        walletAddress: input.walletAddress,
        type: input.type,
        assetId: input.assetId,
        ticker: input.ticker,
        tokenMint: input.tokenMint,
        inputAsset: input.inputAsset,
        outputAsset: input.outputAsset,
        amount:
          input.amount !== undefined ? String(input.amount) : undefined,
        amountUsd:
          input.amountUsd !== undefined ? String(input.amountUsd) : undefined,
        provider: input.provider,
        status: input.status,
        transactionSignature: input.transactionSignature,
      })
      .returning();
    return row;
  }

  async updateStatus(
    id: string,
    patch: {
      status: ExecutionStatus;
      transactionSignature?: string;
    },
  ): Promise<ExecutionRow | null> {
    const [row] = await this.db
      .update(executions)
      .set({
        status: patch.status,
        ...(patch.transactionSignature !== undefined
          ? { transactionSignature: patch.transactionSignature }
          : {}),
      })
      .where(eq(executions.id, id))
      .returning();
    return row ?? null;
  }

  async findById(id: string): Promise<ExecutionRow | null> {
    const rows = await this.db
      .select()
      .from(executions)
      .where(eq(executions.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findLatestAwaitingSignature(
    walletAddress: string,
  ): Promise<ExecutionRow | null> {
    const rows = await this.db
      .select()
      .from(executions)
      .where(
        and(
          eq(executions.walletAddress, walletAddress),
          eq(executions.status, 'awaiting_signature'),
        ),
      )
      .orderBy(desc(executions.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async findBySignature(signature: string): Promise<ExecutionRow | null> {
    const rows = await this.db
      .select()
      .from(executions)
      .where(eq(executions.transactionSignature, signature))
      .limit(1);
    return rows[0] ?? null;
  }
}
