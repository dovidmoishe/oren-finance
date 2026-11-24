import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../config/constants';
import type { Database } from '../../database/database.provider';
import {
  executions,
  growthAccessGrants,
  growthAttributionTouches,
  growthCheckpoints,
  growthCoverage,
  growthDailyMetrics,
  growthFunnelEvents,
  growthImportBatches,
  growthImportObservations,
  growthPageviews,
  growthSessions,
  growthVisitors,
  mcpConnections,
  mcpTradeIntents,
  tradeApprovals,
} from '../../database/schema';
import type { PageviewDraft } from './growth-collect';
import type { GrowthImportDocument, GrowthObservation } from './growth-import';
import type { UtmTouch } from './growth-attribution';

@Injectable()
export class GrowthRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async insertPageview(
    draft: PageviewDraft,
  ): Promise<'inserted' | 'duplicate'> {
    const rows = await this.db
      .insert(growthPageviews)
      .values({
        occurredAt: draft.occurredAt,
        path: draft.path,
        visitorHash: draft.visitorHash,
        sessionHash: draft.sessionHash,
        visitorStability: draft.visitorStability,
        utmSource: draft.utmSource,
        utmMedium: draft.utmMedium,
        utmCampaign: draft.utmCampaign,
        utmContent: draft.utmContent,
        utmTerm: draft.utmTerm,
        referrerHost: draft.referrerHost,
        source: draft.source,
        ingestKey: draft.ingestKey,
        excluded: draft.excluded,
        excludeReason: draft.excludeReason,
      })
      .onConflictDoNothing({ target: growthPageviews.ingestKey })
      .returning({ id: growthPageviews.id });
    if (rows.length === 0 || draft.excluded) {
      return rows.length === 0 ? 'duplicate' : 'inserted';
    }
    await this.db
      .insert(growthVisitors)
      .values({
        visitorHash: draft.visitorHash,
        firstSeenAt: draft.occurredAt,
        lastSeenAt: draft.occurredAt,
        stability: draft.visitorStability,
      })
      .onConflictDoUpdate({
        target: growthVisitors.visitorHash,
        set: { lastSeenAt: draft.occurredAt },
      });
    await this.db
      .insert(growthSessions)
      .values({
        sessionHash: draft.sessionHash,
        visitorHash: draft.visitorHash,
        firstSeenAt: draft.occurredAt,
        lastSeenAt: draft.occurredAt,
      })
      .onConflictDoUpdate({
        target: growthSessions.sessionHash,
        set: { lastSeenAt: draft.occurredAt },
      });
    await this.db
      .insert(growthCoverage)
      .values({
        source: draft.source,
        startedAt: draft.occurredAt,
        notes: 'First accepted pageview for this collector.',
      })
      .onConflictDoUpdate({
        target: growthCoverage.source,
        set: {
          startedAt: sql`least(${growthCoverage.startedAt}, excluded.started_at)`,
        },
      });
    return 'inserted';
  }

  async insertFunnel(input: {
    occurredAt: Date;
    eventType: string;
    accountHash?: string | null;
    sessionHash?: string | null;
    sourceId: string;
    lane?: string | null;
    toolName?: string | null;
    slot?: string | null;
    utm?: Partial<UtmTouch>;
    isFirst?: boolean;
  }): Promise<void> {
    const values = {
      occurredAt: input.occurredAt,
      eventType: input.eventType,
      accountHash: input.accountHash ?? null,
      sessionHash: input.sessionHash ?? null,
      sourceId: input.sourceId,
      lane: input.lane ?? null,
      toolName: input.toolName ?? null,
      slot: input.slot ?? null,
      utmSource: input.utm?.source,
      utmMedium: input.utm?.medium,
      utmCampaign: input.utm?.campaign,
      utmContent: input.utm?.content,
      utmTerm: input.utm?.term,
      isFirst: input.isFirst ?? false,
    };
    const rows = await this.db
      .insert(growthFunnelEvents)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: growthFunnelEvents.id });
    if (input.isFirst && !rows.length) {
      await this.db
        .insert(growthFunnelEvents)
        .values({ ...values, isFirst: false })
        .onConflictDoNothing();
    }
  }

  async rememberTouch(
    subjectKind: 'visitor' | 'account',
    subjectHash: string,
    touch: 'first' | 'last',
    value: UtmTouch,
  ): Promise<void> {
    const row = {
      subjectKind,
      subjectHash,
      touch,
      touchedAt: new Date(value.at),
      utmSource: value.source,
      utmMedium: value.medium,
      utmCampaign: value.campaign,
      utmContent: value.content,
      utmTerm: value.term,
      path: value.path,
    };
    if (touch === 'first') {
      await this.db
        .insert(growthAttributionTouches)
        .values(row)
        .onConflictDoNothing({
          target: [
            growthAttributionTouches.subjectKind,
            growthAttributionTouches.subjectHash,
            growthAttributionTouches.touch,
          ],
        });
      return;
    }
    await this.db
      .insert(growthAttributionTouches)
      .values(row)
      .onConflictDoUpdate({
        target: [
          growthAttributionTouches.subjectKind,
          growthAttributionTouches.subjectHash,
          growthAttributionTouches.touch,
        ],
        set: row,
      });
  }

  async accountTouch(
    accountHash: string,
    model: 'first' | 'last',
    since: Date,
    now: Date,
  ) {
    const rows = await this.db
      .select()
      .from(growthAttributionTouches)
      .where(
        and(
          eq(growthAttributionTouches.subjectKind, 'account'),
          eq(growthAttributionTouches.subjectHash, accountHash),
          gte(growthAttributionTouches.touchedAt, since),
          lte(growthAttributionTouches.touchedAt, now),
        ),
      );
    const row = rows.find((entry) => entry.touch === model) ?? rows[0];
    if (!row) return undefined;
    return {
      source: row.utmSource ?? undefined,
      medium: row.utmMedium ?? undefined,
      campaign: row.utmCampaign ?? undefined,
      content: row.utmContent ?? undefined,
      term: row.utmTerm ?? undefined,
    };
  }

  async grantsFor(tokenHashValue: string) {
    return this.db
      .select({
        id: growthAccessGrants.id,
        principalKind: growthAccessGrants.principalKind,
        permission: growthAccessGrants.permission,
        revokedAt: growthAccessGrants.revokedAt,
        expiresAt: growthAccessGrants.expiresAt,
      })
      .from(growthAccessGrants)
      .where(eq(growthAccessGrants.tokenHash, tokenHashValue));
  }

  async coverage() {
    return this.db
      .select({
        source: growthCoverage.source,
        startedAt: growthCoverage.startedAt,
      })
      .from(growthCoverage);
  }

  async durableVisitors(from: Date, to: Date): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(growthVisitors)
      .where(
        and(
          eq(growthVisitors.stability, 'durable'),
          gte(growthVisitors.firstSeenAt, from),
          lt(growthVisitors.firstSeenAt, to),
        ),
      );
    return row?.count ?? 0;
  }

  async dailyMetrics(
    from: string,
    to: string,
    timezone: 'UTC' | 'Africa/Lagos',
  ) {
    return this.db
      .select({
        day: growthDailyMetrics.day,
        source: growthDailyMetrics.source,
        grain: growthDailyMetrics.grain,
        dimension: growthDailyMetrics.dimension,
        pageviews: growthDailyMetrics.pageviews,
        sessions: growthDailyMetrics.sessions,
        dailyUniques: growthDailyMetrics.dailyUniques,
        frozen: growthDailyMetrics.frozen,
      })
      .from(growthDailyMetrics)
      .where(
        and(
          eq(growthDailyMetrics.timezone, timezone),
          gte(growthDailyMetrics.day, from),
          lt(growthDailyMetrics.day, shiftDay(to, 1)),
        ),
      );
  }

  async pageviewsBetween(start: Date, end: Date) {
    return this.db
      .select({
        occurredAt: growthPageviews.occurredAt,
        path: growthPageviews.path,
        visitorHash: growthPageviews.visitorHash,
        sessionHash: growthPageviews.sessionHash,
        utmCampaign: growthPageviews.utmCampaign,
        utmContent: growthPageviews.utmContent,
        utmTerm: growthPageviews.utmTerm,
        source: growthPageviews.source,
        visitorStability: growthPageviews.visitorStability,
      })
      .from(growthPageviews)
      .where(
        and(
          eq(growthPageviews.excluded, false),
          gte(growthPageviews.occurredAt, start),
          lt(growthPageviews.occurredAt, end),
        ),
      )
      .limit(50001);
  }

  async funnelEvents(from: Date, to: Date) {
    return this.db
      .select({
        occurredAt: growthFunnelEvents.occurredAt,
        eventType: growthFunnelEvents.eventType,
        accountHash: growthFunnelEvents.accountHash,
        sessionHash: growthFunnelEvents.sessionHash,
        lane: growthFunnelEvents.lane,
        toolName: growthFunnelEvents.toolName,
        slot: growthFunnelEvents.slot,
        campaign: growthFunnelEvents.utmCampaign,
        content: growthFunnelEvents.utmContent,
        term: growthFunnelEvents.utmTerm,
        isFirst: growthFunnelEvents.isFirst,
      })
      .from(growthFunnelEvents)
      .where(
        and(
          gte(growthFunnelEvents.occurredAt, from),
          lt(growthFunnelEvents.occurredAt, to),
        ),
      );
  }

  async connections(from: Date, to: Date) {
    return this.db
      .select({
        campaign: growthFunnelEvents.utmCampaign,
        grantId: mcpConnections.grantId,
        userId: mcpConnections.userId,
        createdAt: mcpConnections.createdAt,
        revokedAt: mcpConnections.revokedAt,
      })
      .from(mcpConnections)
      .leftJoin(
        growthFunnelEvents,
        and(
          eq(growthFunnelEvents.sourceId, mcpConnections.grantId),
          eq(growthFunnelEvents.eventType, 'oauth_completed'),
        ),
      )
      .where(
        and(
          gte(mcpConnections.createdAt, from),
          lt(mcpConnections.createdAt, to),
        ),
      );
  }

  async tradeFacts(from: Date, to: Date) {
    const intents = await this.db
      .select({
        id: mcpTradeIntents.id,
        userId: mcpTradeIntents.userId,
        mode: mcpTradeIntents.mode,
        status: mcpTradeIntents.status,
        approvalId: mcpTradeIntents.approvalId,
        createdAt: mcpTradeIntents.createdAt,
      })
      .from(mcpTradeIntents)
      .where(
        and(
          gte(mcpTradeIntents.createdAt, from),
          lt(mcpTradeIntents.createdAt, to),
        ),
      );
    const executionRows = await this.db
      .select({ id: executions.id, status: executions.status })
      .from(executions)
      .where(
        and(gte(executions.createdAt, from), lt(executions.createdAt, to)),
      );
    const approvalIds = intents
      .map((row) => row.approvalId)
      .filter((id): id is string => Boolean(id));
    const approvals =
      approvalIds.length === 0
        ? []
        : await this.db
            .select({
              id: tradeApprovals.id,
              userId: tradeApprovals.userId,
              executionId: tradeApprovals.executionId,
            })
            .from(tradeApprovals)
            .where(inArray(tradeApprovals.id, approvalIds));
    return { intents, approvals, executions: executionRows };
  }

  async observations(): Promise<GrowthObservation[]> {
    const rows = await this.db
      .select({
        snapshotId: growthImportObservations.snapshotId,
        metric: growthImportObservations.metric,
        family: growthImportObservations.family,
        grain: growthImportObservations.grain,
        periodStart: growthImportObservations.periodStart,
        periodEnd: growthImportObservations.periodEnd,
        day: growthImportObservations.day,
        value: growthImportObservations.value,
        coverage: growthImportObservations.coverage,
        usableInTotals: growthImportObservations.usableInTotals,
        usableAsWindow: growthImportObservations.usableAsWindow,
        dimensions: growthImportObservations.dimensions,
        notes: growthImportObservations.notes,
      })
      .from(growthImportObservations);
    return rows.map((row) => ({
      snapshotId: row.snapshotId,
      metric: row.metric,
      family: row.family as GrowthObservation['family'],
      grain: row.grain as GrowthObservation['grain'],
      periodStart: row.periodStart?.toISOString() ?? null,
      periodEnd: row.periodEnd?.toISOString() ?? null,
      day: row.day,
      value: row.value === null ? null : Number(row.value),
      coverage: row.coverage as GrowthObservation['coverage'],
      usableInTotals: row.usableInTotals,
      usableAsWindow: row.usableAsWindow,
      dimensions: row.dimensions ?? {},
      notes: row.notes,
    }));
  }

  async insertImport(
    document: GrowthImportDocument,
    hash: string,
  ): Promise<'inserted' | 'duplicate'> {
    const existing = await this.db
      .select({ id: growthImportBatches.id })
      .from(growthImportBatches)
      .where(eq(growthImportBatches.contentHash, hash))
      .limit(1);
    if (existing.length > 0) return 'duplicate';
    const [batch] = await this.db
      .insert(growthImportBatches)
      .values({
        schemaVersion: document.schema,
        sourceSystem: document.source.system,
        provenance: document.source.provenance,
        verification: document.source.verification,
        contentHash: hash,
        timezone: document.timezone,
      })
      .returning({ id: growthImportBatches.id });
    if (document.observations.length > 0) {
      await this.db.insert(growthImportObservations).values(
        document.observations.map((item) => ({
          batchId: batch.id,
          snapshotId: item.snapshotId,
          metric: item.metric,
          family: item.family,
          grain: item.grain,
          periodStart: item.periodStart ? new Date(item.periodStart) : null,
          periodEnd: item.periodEnd ? new Date(item.periodEnd) : null,
          day: item.day,
          value: item.value === null ? null : String(item.value),
          coverage: item.coverage,
          usableInTotals: item.usableInTotals,
          usableAsWindow: item.usableAsWindow,
          dimensions: item.dimensions,
          notes: item.notes,
        })),
      );
    }
    return 'inserted';
  }

  async replaceRollup(
    timezone: 'UTC' | 'Africa/Lagos',
    rows: Array<{
      day: string;
      grain: 'site' | 'path' | 'campaign';
      dimension: string;
      source: 'beacon' | 'caddy';
      pageviews: number;
      sessions: number;
      dailyUniques: number;
    }>,
    days: string[],
    frozen: boolean,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const day of days) {
        await tx
          .delete(growthDailyMetrics)
          .where(
            and(
              eq(growthDailyMetrics.day, day),
              eq(growthDailyMetrics.timezone, timezone),
              eq(growthDailyMetrics.frozen, false),
            ),
          );
      }
      if (rows.length > 0) {
        await tx
          .insert(growthDailyMetrics)
          .values(rows.map((row) => ({ ...row, timezone, frozen })))
          .onConflictDoNothing({
            target: [
              growthDailyMetrics.day,
              growthDailyMetrics.timezone,
              growthDailyMetrics.grain,
              growthDailyMetrics.source,
              growthDailyMetrics.dimension,
            ],
          });
      }
    });
  }

  async claimRollup(
    owner: string,
  ): Promise<{ acquired: boolean; identitiesExact: boolean }> {
    await this.db
      .insert(growthCheckpoints)
      .values({ name: 'rollup' })
      .onConflictDoNothing();
    const stale = new Date(Date.now() - 10 * 60 * 1000);
    const rows = await this.db
      .update(growthCheckpoints)
      .set({ lockedAt: new Date(), lockOwner: owner, updatedAt: new Date() })
      .where(
        and(
          eq(growthCheckpoints.name, 'rollup'),
          or(
            isNull(growthCheckpoints.lockedAt),
            lt(growthCheckpoints.lockedAt, stale),
          ),
        ),
      )
      .returning({ identitiesExact: growthCheckpoints.identitiesExact });
    return {
      acquired: rows.length > 0,
      identitiesExact: rows[0]?.identitiesExact ?? true,
    };
  }

  async releaseRollup(owner: string): Promise<void> {
    await this.db
      .update(growthCheckpoints)
      .set({ lockedAt: null, lockOwner: null, updatedAt: new Date() })
      .where(
        and(
          eq(growthCheckpoints.name, 'rollup'),
          eq(growthCheckpoints.lockOwner, owner),
        ),
      );
  }

  async identitiesExact(): Promise<boolean> {
    const [row] = await this.db
      .select({ identitiesExact: growthCheckpoints.identitiesExact })
      .from(growthCheckpoints)
      .where(eq(growthCheckpoints.name, 'rollup'))
      .limit(1);
    return row?.identitiesExact ?? true;
  }

  async purgeRaw(cutoff: Date, limit: number): Promise<number> {
    const rows = await this.db.execute<{ id: string }>(sql`
      DELETE FROM growth_pageviews
      WHERE id IN (
        SELECT id FROM growth_pageviews WHERE occurred_at < ${cutoff} LIMIT ${limit}
      )
      RETURNING id
    `);
    return Array.isArray(rows) ? rows.length : 0;
  }

  async purgeIdentities(cutoff: Date): Promise<number> {
    const visitors = await this.db
      .delete(growthVisitors)
      .where(sql`${growthVisitors.lastSeenAt} < ${cutoff}`)
      .returning({ visitorHash: growthVisitors.visitorHash });
    await this.db
      .delete(growthSessions)
      .where(sql`${growthSessions.lastSeenAt} < ${cutoff}`);
    if (visitors.length > 0) {
      await this.db
        .update(growthCheckpoints)
        .set({ identitiesExact: false, updatedAt: new Date() })
        .where(eq(growthCheckpoints.name, 'rollup'));
    }
    return visitors.length;
  }

  async markCheckpoint(name: string): Promise<void> {
    await this.db
      .insert(growthCheckpoints)
      .values({ name, cursorAt: new Date(), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: growthCheckpoints.name,
        set: { cursorAt: new Date(), updatedAt: new Date() },
      });
  }
}

function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}
