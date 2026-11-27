import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { DRIZZLE } from '../../config/constants';
import type { Database } from '../../database/database.provider';
import { marketEventSyncState, marketEvents } from '../../database/schema';

export type StoredMarketEvent = typeof marketEvents.$inferSelect;

export type MarketEventScheduleRow = Pick<
  typeof marketEvents.$inferInsert,
  | 'family'
  | 'kind'
  | 'title'
  | 'country'
  | 'scheduledAt'
  | 'timePrecision'
  | 'source'
  | 'sourceEventId'
  | 'sourceUrl'
  | 'raw'
>;

export interface MarketEventResult {
  actual: number | null;
  previous: number | null;
  unit: string;
  raw: Record<string, unknown>;
}

export interface MarketEventSyncStatus {
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorCode: string | null;
}

/** What the refresh needs from storage. Tests use an in-memory fake. */
export interface MarketEventStore {
  upsertSchedule(rows: MarketEventScheduleRow[]): Promise<void>;
  cancelMissing(input: {
    source: string;
    kind: string;
    keep: string[];
    from: Date;
  }): Promise<number>;
  pendingResults(input: {
    kinds: readonly string[];
    from: Date;
    to: Date;
  }): Promise<StoredMarketEvent[]>;
  recordResult(id: string, result: MarketEventResult): Promise<void>;
}

/** Reads are what the UI, brief, copilot, and MCP use. They never call an agency. */
@Injectable()
export class MarketEventsRepository implements MarketEventStore {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Insert or refresh scheduled events. A released event keeps its status and
   * published values; a cancelled one that reappears is scheduled again.
   * `raw` is merged so result metadata survives schedule refreshes.
   */
  async upsertSchedule(rows: MarketEventScheduleRow[]): Promise<void> {
    if (!rows.length) return;
    const status = sql`case when ${marketEvents.dateStatus} = 'released' then 'released' else 'scheduled' end`;
    await this.db
      .insert(marketEvents)
      .values(rows)
      .onConflictDoUpdate({
        target: [marketEvents.source, marketEvents.sourceEventId],
        set: {
          kind: sql`excluded.kind`,
          title: sql`excluded.title`,
          scheduledAt: sql`excluded.scheduled_at`,
          timePrecision: sql`excluded.time_precision`,
          sourceUrl: sql`excluded.source_url`,
          dateStatus: status,
          raw: sql`${marketEvents.raw} || excluded.raw`,
          fetchedAt: sql`now()`,
          updatedAt: sql`case when (${marketEvents.kind}, ${marketEvents.title}, ${marketEvents.scheduledAt}, ${marketEvents.timePrecision}, ${marketEvents.sourceUrl}, ${marketEvents.dateStatus})
            is distinct from (excluded.kind, excluded.title, excluded.scheduled_at, excluded.time_precision, excluded.source_url, ${status})
            then now() else ${marketEvents.updatedAt} end`,
        },
      });
  }

  /** Future scheduled events the source no longer lists become `cancelled`. */
  async cancelMissing(input: {
    source: string;
    kind: string;
    keep: string[];
    from: Date;
  }): Promise<number> {
    const rows = await this.db
      .update(marketEvents)
      .set({ dateStatus: 'cancelled', updatedAt: sql`now()` })
      .where(
        and(
          eq(marketEvents.source, input.source),
          eq(marketEvents.kind, input.kind),
          eq(marketEvents.dateStatus, 'scheduled'),
          gte(marketEvents.scheduledAt, input.from),
          input.keep.length
            ? notInArray(marketEvents.sourceEventId, input.keep)
            : undefined,
        ),
      )
      .returning({ id: marketEvents.id });
    return rows.length;
  }

  async pendingResults(input: {
    kinds: readonly string[];
    from: Date;
    to: Date;
  }): Promise<StoredMarketEvent[]> {
    if (!input.kinds.length) return [];
    return this.db
      .select()
      .from(marketEvents)
      .where(
        and(
          inArray(marketEvents.kind, [...input.kinds]),
          eq(marketEvents.dateStatus, 'scheduled'),
          gte(marketEvents.scheduledAt, input.from),
          lte(marketEvents.scheduledAt, input.to),
        ),
      )
      .orderBy(asc(marketEvents.scheduledAt));
  }

  async recordResult(id: string, result: MarketEventResult): Promise<void> {
    await this.db
      .update(marketEvents)
      .set({
        actual: result.actual === null ? null : String(result.actual),
        previous: result.previous === null ? null : String(result.previous),
        unit: result.unit,
        dateStatus: 'released',
        raw: sql`${marketEvents.raw} || ${JSON.stringify(result.raw)}::jsonb`,
        updatedAt: sql`now()`,
      })
      .where(eq(marketEvents.id, id));
  }

  /** Macro events scheduled in [from, to), in time order. */
  async listRange(
    from: Date,
    to: Date,
    kinds?: readonly string[],
    limit = 500,
  ): Promise<StoredMarketEvent[]> {
    return this.db
      .select()
      .from(marketEvents)
      .where(
        and(
          eq(marketEvents.family, 'macro'),
          gte(marketEvents.scheduledAt, from),
          lt(marketEvents.scheduledAt, to),
          kinds?.length ? inArray(marketEvents.kind, [...kinds]) : undefined,
        ),
      )
      .orderBy(asc(marketEvents.scheduledAt), asc(marketEvents.kind))
      .limit(limit);
  }

  async syncState(job: string): Promise<MarketEventSyncStatus | null> {
    const [row] = await this.db
      .select({
        lastAttemptAt: marketEventSyncState.lastAttemptAt,
        lastSuccessAt: marketEventSyncState.lastSuccessAt,
        lastErrorCode: marketEventSyncState.lastErrorCode,
      })
      .from(marketEventSyncState)
      .where(eq(marketEventSyncState.job, job))
      .limit(1);
    return row ?? null;
  }

  /** Take the lease when nobody holds it. Another process holding it wins. */
  async claimSync(
    job: string,
    owner: string,
    leaseMs: number,
  ): Promise<boolean> {
    await this.db
      .insert(marketEventSyncState)
      .values({ job })
      .onConflictDoNothing();
    const rows = await this.db
      .update(marketEventSyncState)
      .set({
        leaseOwner: owner,
        leaseUntil: sql`now() + make_interval(secs => ${Math.ceil(leaseMs / 1000)}::int)`,
        lastAttemptAt: sql`now()`,
      })
      .where(
        and(
          eq(marketEventSyncState.job, job),
          or(
            isNull(marketEventSyncState.leaseUntil),
            lt(marketEventSyncState.leaseUntil, sql`now()`),
          ),
        ),
      )
      .returning({ job: marketEventSyncState.job });
    return rows.length > 0;
  }

  async finishSync(
    job: string,
    owner: string,
    outcome: { ok: true; note?: string } | { ok: false; code: string },
  ): Promise<void> {
    await this.db
      .update(marketEventSyncState)
      .set({
        leaseOwner: null,
        leaseUntil: null,
        ...(outcome.ok
          ? { lastSuccessAt: sql`now()`, lastErrorCode: outcome.note ?? null }
          : { lastErrorCode: outcome.code }),
      })
      .where(
        and(
          eq(marketEventSyncState.job, job),
          eq(marketEventSyncState.leaseOwner, owner),
        ),
      );
  }
}
