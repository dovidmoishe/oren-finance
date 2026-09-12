import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../config/constants';
import type { Database } from '../database/database.provider';
import {
  executions,
  portfolioSnapshots,
  vaultPositions,
} from '../database/schema';

export type SnapshotRow = typeof portfolioSnapshots.$inferSelect;
export type VaultPositionRow = typeof vaultPositions.$inferSelect;
export type ExecutionRow = typeof executions.$inferSelect;

export interface InsertSnapshotInput {
  walletAddress: string;
  totalValueUsd: number;
  availableValueUsd: number;
  lockedValueUsd: number;
  positionsJson: unknown;
}

@Injectable()
export class PortfolioRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async insertSnapshot(input: InsertSnapshotInput): Promise<SnapshotRow> {
    const [row] = await this.db
      .insert(portfolioSnapshots)
      .values({
        walletAddress: input.walletAddress,
        totalValueUsd: String(input.totalValueUsd),
        availableValueUsd: String(input.availableValueUsd),
        lockedValueUsd: String(input.lockedValueUsd),
        positionsJson: input.positionsJson ?? [],
      })
      .returning();
    return row;
  }

  async listSnapshots(
    walletAddress: string,
    limit = 500,
  ): Promise<SnapshotRow[]> {
    return this.db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.walletAddress, walletAddress))
      .orderBy(desc(portfolioSnapshots.timestamp))
      .limit(limit);
  }

  async getLatestSnapshot(
    walletAddress: string,
  ): Promise<SnapshotRow | null> {
    const rows = await this.listSnapshots(walletAddress, 1);
    return rows[0] ?? null;
  }

  async listVaultPositions(owner: string): Promise<VaultPositionRow[]> {
    return this.db
      .select()
      .from(vaultPositions)
      .where(eq(vaultPositions.owner, owner));
  }

  async listExecutions(
    walletAddress: string,
    limit = 50,
  ): Promise<ExecutionRow[]> {
    return this.db
      .select()
      .from(executions)
      .where(eq(executions.walletAddress, walletAddress))
      .orderBy(desc(executions.createdAt))
      .limit(limit);
  }
}
