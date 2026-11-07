import { Inject, Injectable } from '@nestjs/common';
import { APP_ENV } from '../../config/constants';
import type { AppEnv } from '../../config/env.schema';
import { digest } from './growth-privacy';
import { assertPublicReport } from './growth-privacy';
import {
  allTimeFromDailyUniques,
  buildFunnel,
  closedPageviews,
  compareSlices,
  FUNNEL_DEFINITIONS,
  retention,
  type FunnelFact,
} from './growth-metrics';
import {
  combineDaily,
  pointReadings,
  resolveDaily,
  resolveWindow,
} from './growth-import';
import { countTrades } from './growth-trades';
import {
  assertTimezone,
  dayBounds,
  dayIsPartial,
  eachDay,
  type ReportTimezone,
} from './growth-time';
import { GrowthRepository } from './growth.repository';

const X_METRICS = [
  'x_impressions',
  'x_engagements',
  'x_link_clicks',
  'x_profile_visits',
  'x_follower_delta',
] as const;
const REVENUE_METRICS = ['cost', 'revenue', 'contribution_margin'] as const;

@Injectable()
export class GrowthReportService {
  constructor(
    private readonly repository: GrowthRepository,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async coverage() {
    const rows = await this.repository.coverage();
    const report = {
      definitions: FUNNEL_DEFINITIONS,
      laptopRequired: false,
      scheduler: 'api-process',
      rawRetentionDays: this.env.GROWTH_RAW_RETENTION_DAYS,
      identityRetentionDays: this.env.GROWTH_IDENTITY_RETENTION_DAYS,
      idempotencyRetentionDays: this.env.GROWTH_IDEMPOTENCY_RETENTION_DAYS,
      attribution: {
        model: this.env.GROWTH_ATTRIBUTION_MODEL,
        windowDays: this.env.GROWTH_ATTRIBUTION_WINDOW_DAYS,
      },
      collectors: rows.map((row) => ({
        source: row.source,
        startedAt: row.startedAt.toISOString(),
      })),
      historicalImports:
        'Manual only. Not loaded by deploy and not mixed into telemetry totals.',
      x: { status: 'unavailable' as const, reason: 'no_sync' },
      revenue: { status: 'unavailable' as const, reason: 'no_ledger_join' },
      tokenHolders: {
        status: 'unavailable' as const,
        reason: 'separate_from_product_activation',
      },
      summingDailyUniquesIsLifetime: false,
      liveTradesVerified: false,
    };
    assertPublicReport(report);
    return report;
  }

  async traffic(from: string, to: string, timezoneValue?: string) {
    const timezone = assertTimezone(timezoneValue);
    const days = eachDay(from, to);
    const observations = await this.repository.observations();
    const metrics = await this.repository.dailyMetrics(from, to, timezone);
    const telemetry = metrics
      .filter((row) => row.grain === 'site' && row.source === 'beacon')
      .map((row) => ({ day: row.day, value: row.pageviews }));
    const imported = resolveDaily(observations, 'page_views', from, to);
    const combined = combineDaily(telemetry, imported);
    const bounds = rangeBounds(from, to, timezone);
    const now = new Date();
    const identitiesExact = await this.repository.identitiesExact();
    const identitiesCover =
      bounds.start.getTime() >=
      now.getTime() -
        this.env.GROWTH_IDENTITY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const closed = closedPageviews(
      combined,
      new Set(
        combined
          .filter((day) => dayIsPartial(day.day, timezone, now))
          .map((day) => day.day),
      ),
    );
    const report = {
      timezone,
      definitions: FUNNEL_DEFINITIONS,
      pageviews: closed.total,
      daily: closed.daily,
      dailyUniques: {
        status: 'unavailable' as const,
        value: null,
        reason: 'use_per_day_rows_do_not_sum',
        days: metrics
          .filter((row) => row.grain === 'site' && row.source === 'beacon')
          .map((row) => ({ day: row.day, value: row.dailyUniques })),
      },
      lifetimeUniques: allTimeFromDailyUniques(),
      distinctDurableVisitorsFirstSeenInRange: !identitiesExact
        ? {
            status: 'unavailable' as const,
            value: null,
            reason: 'identity_keys_purged',
          }
        : identitiesCover
          ? {
              status: 'exact' as const,
              value: await this.repository.durableVisitors(
                bounds.start,
                bounds.end,
              ),
              note: 'First-seen durable visitors in this range. Not a sum of daily uniques and not people.',
            }
          : {
              status: 'unavailable' as const,
              value: null,
              reason: 'identity_retention_does_not_cover_the_range',
            },
      historicalWindowPageviews: resolveWindow(
        observations,
        'window_page_views',
      ),
      caddyDayVisitorsAreNotLifetime: true,
      days: days.length,
    };
    assertPublicReport(report);
    return report;
  }

  async funnel(from: string, to: string, groupBy?: string) {
    const grouping =
      groupBy === 'week' || groupBy === 'campaign' ? groupBy : 'none';
    const bounds = rangeBounds(from, to, 'UTC');
    const [events, connections, trades] = await Promise.all([
      this.repository.funnelEvents(bounds.start, bounds.end),
      this.repository.connections(bounds.start, bounds.end),
      this.repository.tradeFacts(bounds.start, bounds.end),
    ]);
    const facts: FunnelFact[] = events.map((event) => ({
      occurredAt: event.occurredAt.toISOString(),
      eventType: event.eventType as FunnelFact['eventType'],
      accountHash: event.accountHash,
      sessionHash: event.sessionHash,
      lane: event.lane,
      toolName: event.toolName,
      campaign: event.campaign,
      content: event.content,
      term: event.term,
      slot: event.slot,
      isFirst: event.isFirst,
    }));
    const report = {
      ...buildFunnel({
        facts,
        connections: connections.map((row) => ({
          grantId: row.grantId,
          accountHash: digest(this.pepper, 'account', row.userId),
          createdAt: row.createdAt.toISOString(),
          revokedAt: row.revokedAt?.toISOString() ?? null,
        })),
        from,
        to,
        groupBy: grouping,
      }),
      trades: countTrades(trades),
      researchRetention7d: retention({
        events: researchAndTrades(events, trades, this.pepper),
        cohortFrom: from,
        cohortTo: to,
        windowDays: 7,
        asOf: new Date(),
      }),
      researchRetention30d: retention({
        events: researchAndTrades(events, trades, this.pepper),
        cohortFrom: from,
        cohortTo: to,
        windowDays: 30,
        asOf: new Date(),
      }),
      liveTradesVerified: false,
    };
    assertPublicReport(report);
    return report;
  }

  async compare(from: string, to: string, dimension?: string) {
    const keyName =
      dimension === 'content' || dimension === 'term' || dimension === 'slot'
        ? dimension
        : 'campaign';
    const bounds = rangeBounds(from, to, 'UTC');
    const [metrics, events] = await Promise.all([
      this.repository.dailyMetrics(from, to, 'UTC'),
      this.repository.funnelEvents(bounds.start, bounds.end),
    ]);
    const groups = new Map<
      string,
      { pageviews: number; connections: number; research: Set<string> }
    >();
    if (keyName === 'campaign') {
      for (const row of metrics) {
        if (row.grain !== 'campaign' || row.source !== 'beacon') continue;
        const group = groups.get(row.dimension) ?? {
          pageviews: 0,
          connections: 0,
          research: new Set<string>(),
        };
        group.pageviews += row.pageviews;
        groups.set(row.dimension, group);
      }
    }
    for (const event of events) {
      const key =
        keyName === 'slot'
          ? event.slot || '(none)'
          : keyName === 'content'
            ? event.content || '(none)'
            : keyName === 'term'
              ? event.term || '(none)'
              : event.campaign || '(none)';
      const group = groups.get(key) ?? {
        pageviews: 0,
        connections: 0,
        research: new Set<string>(),
      };
      if (event.eventType === 'oauth_completed') group.connections += 1;
      if (
        event.eventType === 'research_success' &&
        event.toolName === 'getStockResearch' &&
        event.accountHash
      ) {
        group.research.add(event.accountHash);
      }
      groups.set(key, group);
    }
    const report = {
      denominator: keyName === 'campaign' ? 'pageviews' : 'unavailable',
      uniqueVisitors: {
        status: 'unavailable' as const,
        reason: 'not_the_sum_of_daily_uniques',
      },
      ...compareSlices(
        [...groups.entries()].map(([key, group]) => ({
          key,
          sampleSize: keyName === 'campaign' ? group.pageviews : 0,
          connections: group.connections,
          researchAccounts: group.research.size,
        })),
        this.env.GROWTH_MIN_COMPARISON_SAMPLE,
      ),
    };
    assertPublicReport(report);
    return report;
  }

  async external(family: string, from: string, to: string) {
    const metrics =
      family === 'x'
        ? X_METRICS
        : family === 'revenue'
          ? REVENUE_METRICS
          : ['token_holders'];
    const observations = (await this.repository.observations()).filter(
      (item) =>
        family === 'token'
          ? item.family === 'token'
          : family === 'revenue'
            ? item.family === 'revenue'
            : item.family === 'x',
    );
    const series: Record<string, unknown> = {};
    for (const metric of metrics) {
      series[metric] = observations.some((item) => item.metric === metric)
        ? {
            daily: resolveDaily(observations, metric, from, to),
            window: resolveWindow(observations, metric),
          }
        : {
            status: 'unavailable',
            reason: 'no_imported_observations',
            value: null,
          };
    }
    const report = {
      family,
      series,
      activation: family === 'token' ? 'not_product_activation' : undefined,
      sync: 'not_enabled',
    };
    assertPublicReport(report);
    return report;
  }

  async snapshots() {
    const observations = await this.repository.observations();
    const report = {
      users: pointReadings(observations, 'reported_users'),
      confirmedTrades: pointReadings(observations, 'reported_confirmed_trades'),
      note: 'Point-in-time readings are not daily deltas and are not added to live trade counts.',
    };
    assertPublicReport(report);
    return report;
  }

  async dailyExport(
    from: string,
    to: string,
    timezoneValue: string | undefined,
    format: string,
  ) {
    const traffic = await this.traffic(from, to, timezoneValue);
    if (format === 'csv') {
      const lines = [
        'day,status,pageviews,reason,source',
        ...traffic.daily.map((day) =>
          [
            day.day,
            day.status,
            day.value ?? '',
            day.reason ?? '',
            day.source ?? '',
          ]
            .map(csvCell)
            .join(','),
        ),
      ];
      return { format: 'csv' as const, body: `${lines.join('\n')}\n` };
    }
    return { format: 'json' as const, body: traffic };
  }

  private get pepper(): string {
    return this.env.GROWTH_HASH_KEY || 'oren-growth-unset-pepper';
  }
}

function rangeBounds(from: string, to: string, timezone: ReportTimezone) {
  return {
    start: dayBounds(from, timezone).start,
    end: dayBounds(to, timezone).end,
  };
}

function researchAndTrades(
  events: Array<{
    occurredAt: Date;
    eventType: string;
    accountHash: string | null;
    toolName: string | null;
  }>,
  trades: {
    intents: Array<{ userId: string; status: string; createdAt: Date }>;
  },
  pepper: string,
) {
  return [
    ...events
      .filter(
        (event) =>
          event.eventType === 'research_success' &&
          event.toolName === 'getStockResearch' &&
          event.accountHash,
      )
      .map((event) => ({
        accountHash: event.accountHash as string,
        at: event.occurredAt.toISOString(),
        kind: 'research' as const,
      })),
    ...trades.intents
      .filter((intent) => intent.status === 'confirmed')
      .map((intent) => ({
        accountHash: digest(pepper, 'account', intent.userId),
        at: intent.createdAt.toISOString(),
        kind: 'trade_confirmed' as const,
      })),
  ];
}

function csvCell(value: string | number): string {
  const text = String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
