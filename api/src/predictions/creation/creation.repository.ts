import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DRIZZLE } from '../../config/constants';
import type { Database } from '../../database/database.provider';
import {
  predictionCreationDrafts as drafts,
  predictionCreationVersions as versions,
  predictionCreationAttempts as attempts,
} from '../../database/schema';
import type {
  PredictionCreationDraft,
  CreationAttempt,
} from '../../../types/prediction-creation';

@Injectable()
export class CreationRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}
  async get(id: string, wallet: string): Promise<PredictionCreationDraft> {
    const [row] = await this.db
      .select()
      .from(drafts)
      .where(and(eq(drafts.id, id), eq(drafts.wallet, wallet)))
      .limit(1);
    if (!row) throw new NotFoundException('Creation draft not found');
    return row.data as PredictionCreationDraft;
  }
  async create(data: PredictionCreationDraft) {
    await this.db.transaction(async (tx) => {
      await tx.insert(drafts).values({
        id: data.id,
        wallet: data.wallet,
        version: data.version,
        data,
      });
      await tx.insert(versions).values({
        id: randomUUID(),
        draftId: data.id,
        version: data.version,
        data,
      });
    });
    return data;
  }
  async replace(data: PredictionCreationDraft, expectedVersion: number) {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(drafts)
        .set({ version: data.version, data, updatedAt: new Date() })
        .where(
          and(
            eq(drafts.id, data.id),
            eq(drafts.wallet, data.wallet),
            eq(drafts.version, expectedVersion),
          ),
        )
        .returning({ id: drafts.id });
      if (!row)
        throw new ConflictException('Draft changed; reload the latest version');
      if (data.version !== expectedVersion)
        await tx.insert(versions).values({
          id: randomUUID(),
          draftId: data.id,
          version: data.version,
          data,
        });
    });
    return data;
  }
  /** Serializes provider sessions and attempts across API instances. */
  async locked<T>(
    id: string,
    wallet: string,
    run: (
      draft: PredictionCreationDraft,
    ) => Promise<{ draft: PredictionCreationDraft; value: T }>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(drafts)
        .where(and(eq(drafts.id, id), eq(drafts.wallet, wallet)))
        .for('update')
        .limit(1);
      if (!row) throw new NotFoundException('Creation draft not found');
      const { draft, value } = await run(row.data as PredictionCreationDraft);
      await tx
        .update(drafts)
        .set({ version: draft.version, data: draft, updatedAt: new Date() })
        .where(eq(drafts.id, id));
      if (draft.attempt)
        await tx
          .insert(attempts)
          .values({ id: draft.attempt.id, draftId: id, data: draft.attempt })
          .onConflictDoUpdate({
            target: attempts.id,
            set: { data: draft.attempt, updatedAt: new Date() },
          });
      if (draft.version !== row.version)
        await tx.insert(versions).values({
          id: randomUUID(),
          draftId: id,
          version: draft.version,
          data: draft,
        });
      return value;
    });
  }
  async attempt(id: string): Promise<CreationAttempt | null> {
    const [row] = await this.db
      .select()
      .from(attempts)
      .where(eq(attempts.id, id))
      .limit(1);
    return row ? (row.data as CreationAttempt) : null;
  }
}
