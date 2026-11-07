import recovery from './fixtures/recovery-observations.json';
import {
  accessDecision,
  browserReportRequest,
  manualDatabaseAllowed,
} from './growth-access';
import { GrowthAccessService } from './growth-access.service';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import {
  applyTouch,
  chosenTouch,
  decodeAttribution,
  encodeAttribution,
} from './growth-attribution';
import { exclusionReason } from './growth-bots';
import { caddyLineToPageview, decideCollect } from './growth-collect';
import {
  combineDaily,
  contentHash,
  pointReadings,
  recoveryCoverage,
  recoveryToImport,
  resolveDaily,
  resolveWindow,
} from './growth-import';
import { planMaintenance, rollPageviews } from './growth-maintenance';
import {
  additivePageviews,
  allTimeFromDailyUniques,
  buildFunnel,
  closedPageviews,
  compareSlices,
  retention,
} from './growth-metrics';
import { observeGrowth } from './growth-observe';
import { assertPublicReport } from './growth-privacy';
import {
  dayBounds,
  dayIsPartial,
  retentionBoundary,
  zonedDay,
} from './growth-time';
import { countTrades } from './growth-trades';

const NOW = new Date('2026-11-07T18:00:00.000Z');
const pepper = 'test-pepper';

describe('growth time zones', () => {
  it('splits the UTC and WAT civil day at 23:00Z', () => {
    const late = new Date('2026-10-29T23:30:00.000Z');
    expect(zonedDay(late, 'UTC')).toBe('2026-10-29');
    expect(zonedDay(late, 'Africa/Lagos')).toBe('2026-10-30');
    expect(zonedDay(new Date('2026-10-29T22:59:59.000Z'), 'Africa/Lagos')).toBe(
      '2026-10-29',
    );
    const bounds = dayBounds('2026-10-29', 'Africa/Lagos');
    expect(bounds.start.toISOString()).toBe('2026-10-28T23:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2026-10-29T23:00:00.000Z');
  });
});

describe('collection filters', () => {
  it('drops bots, prefetches, assets, internal hosts, and personal fields', () => {
    expect(exclusionReason({ path: '/agents', userAgent: 'Googlebot' })).toBe(
      'bot',
    );
    expect(
      exclusionReason({
        path: '/agents',
        headers: { purpose: 'prefetch' },
      }),
    ).toBe('prefetch');
    expect(exclusionReason({ path: '/app/logo.png' })).toBe('asset');
    expect(exclusionReason({ path: '/agents', host: 'localhost' })).toBe(
      'internal_host',
    );
    const rejected = decideCollect(
      {
        event: 'pageview',
        eventId: '11111111-1111-4111-8111-111111111111',
        path: '/agents',
        visitorId: '22222222-2222-4222-8222-222222222222',
        sessionId: '33333333-3333-4333-8333-333333333333',
        occurredAt: NOW.toISOString(),
        email: 'a@b.co',
      },
      NOW,
      pepper,
      ['localhost'],
    );
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: 'personal_field',
    });
    expect(
      decideCollect(
        {
          event: 'research_success',
          eventId: '11111111-1111-4111-8111-111111111111',
          path: '/agents',
          visitorId: '22222222-2222-4222-8222-222222222222',
          sessionId: '33333333-3333-4333-8333-333333333333',
          occurredAt: NOW.toISOString(),
        },
        NOW,
        pepper,
        ['localhost'],
      ),
    ).toMatchObject({ status: 'rejected', reason: 'event' });
    const page = decideCollect(
      {
        event: 'pageview',
        eventId: '11111111-1111-4111-8111-111111111111',
        path: '/agents',
        visitorId: '22222222-2222-4222-8222-222222222222',
        sessionId: '33333333-3333-4333-8333-333333333333',
        occurredAt: NOW.toISOString(),
        utm: { campaign: 'oren_rpt_secretvalue', source: 'x' },
      },
      NOW,
      pepper,
      ['localhost'],
    );
    expect(page.status).toBe('pageview');
    if (page.status === 'pageview') {
      expect(page.draft.utmCampaign).toBeUndefined();
      expect(page.draft.utmSource).toBe('x');
    }
  });

  it('keeps a caddy page and ignores an API hit, with a stable idempotency key', () => {
    const line = {
      ts: Date.parse('2026-10-29T12:00:00.000Z') / 1000,
      status: 200,
      request: {
        method: 'GET',
        uri: '/agents',
        remote_ip: '203.0.113.8',
        headers: { 'User-Agent': ['Mozilla/5.0'] },
      },
    };
    const first = caddyLineToPageview(line, pepper, 'Africa/Lagos');
    const second = caddyLineToPageview(line, pepper, 'Africa/Lagos');
    expect(first?.ingestKey).toBe(second?.ingestKey);
    expect(first?.visitorStability).toBe('day');
    expect(JSON.stringify(first)).not.toContain('203.0.113.8');
    expect(
      caddyLineToPageview(
        { ...line, request: { ...line.request, uri: '/api/health' } },
        pepper,
        'UTC',
      ),
    ).toBeNull();
  });
});

describe('reporting access', () => {
  const bot = {
    id: 'bot-1',
    principalKind: 'marketing_bot',
    permission: 'marketing.bot.read',
    revokedAt: null as Date | null,
    expiresAt: null as Date | null,
  };
  it('allows only the designated marketing bot read grant', () => {
    expect(accessDecision(undefined, NOW)).toMatchObject({
      ok: false,
      reason: 'missing',
    });
    expect(accessDecision(bot, NOW)).toMatchObject({
      ok: true,
      grantId: 'bot-1',
    });
    expect(accessDecision({ ...bot, revokedAt: NOW }, NOW)).toMatchObject({
      ok: false,
      reason: 'revoked',
    });
    expect(
      accessDecision(
        { ...bot, expiresAt: new Date('2026-11-01T00:00:00.000Z') },
        NOW,
      ),
    ).toMatchObject({ ok: false, reason: 'expired' });
    for (const grant of [
      { ...bot, principalKind: 'privy_user', permission: 'marketing.read' },
      { ...bot, principalKind: 'owner', permission: 'admin' },
      { ...bot, principalKind: 'admin', permission: 'admin.full' },
      { ...bot, principalKind: 'machine', permission: 'marketing.bot.read' },
      { ...bot, permission: 'marketing.import' },
    ]) {
      expect(accessDecision(grant, NOW).ok).toBe(false);
    }
    expect(browserReportRequest('https://oren.finance')).toBe(true);
    expect(browserReportRequest(undefined)).toBe(false);
  });

  it('rejects humans, other machines, browsers, and anonymous callers', async () => {
    const grants = [bot];
    const repository = {
      grantsFor: jest.fn(() => Promise.resolve(grants)),
    };
    const service = new GrowthAccessService(repository as never);
    await expect(
      service.authenticate(undefined, undefined),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.authenticate('Bearer did:privy:person', undefined),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.authenticate(`Bearer ${botToken()}`, 'https://oren.finance'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.grantsFor).not.toHaveBeenCalled();
    repository.grantsFor.mockResolvedValue([
      { ...bot, principalKind: 'privy_user', permission: 'marketing.read' },
    ]);
    await expect(
      service.authenticate(`Bearer ${botToken()}`, undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
    repository.grantsFor.mockResolvedValue([
      { ...bot, principalKind: 'machine', permission: 'marketing.bot.read' },
    ]);
    await expect(
      service.authenticate(`Bearer ${botToken()}`, undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
    repository.grantsFor.mockResolvedValue([{ ...bot, revokedAt: NOW }]);
    await expect(
      service.authenticate(`Bearer ${botToken()}`, undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
    repository.grantsFor.mockResolvedValue([]);
    await expect(
      service.authenticate(`Bearer ${botToken()}`, undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
    repository.grantsFor.mockResolvedValue([bot]);
    await expect(
      service.authenticate(`Bearer ${botToken()}`, undefined),
    ).resolves.toBeUndefined();
  });

  it('refuses a production database unless the operator opts in', () => {
    expect(() =>
      manualDatabaseAllowed({
        postgresUrl: 'postgres://oren@db.oren.finance/oren',
        deploymentEnv: 'production',
        allowProduction: false,
      }),
    ).toThrow(/production/);
    expect(() =>
      manualDatabaseAllowed({
        postgresUrl: 'postgres://oren@127.0.0.1/oren',
        deploymentEnv: 'development',
        allowProduction: false,
      }),
    ).not.toThrow();
  });
});

describe('attribution across the consent redirect', () => {
  it('keeps the first touch through a later visit and an OAuth completion', () => {
    const first = applyTouch(
      {},
      {
        source: 'x',
        campaign: 'launch',
        content: 'a',
        at: '2026-11-01T00:00:00.000Z',
        path: '/agents',
      },
    );
    const both = applyTouch(first, {
      source: 'x',
      campaign: 'launch',
      content: 'b',
      at: '2026-11-02T00:00:00.000Z',
      path: '/agents',
    });
    const header = encodeAttribution(both);
    const restored = decodeAttribution(header ?? undefined);
    expect(
      chosenTouch(restored, 'first', new Date('2026-11-03T00:00:00.000Z'), 7)
        ?.content,
    ).toBe('a');
    expect(
      chosenTouch(restored, 'last', new Date('2026-11-03T00:00:00.000Z'), 7)
        ?.content,
    ).toBe('b');
    expect(
      chosenTouch(restored, 'first', new Date('2026-12-01T00:00:00.000Z'), 7),
    ).toBeUndefined();
  });
});

describe('historical recovery observations', () => {
  const imported = recoveryToImport(recovery);

  it('does not fabricate visits or a baseline total', () => {
    expect(JSON.stringify(imported)).not.toContain('"visits"');
    expect(
      imported.observations.every(
        (item) => item.value === null || typeof item.value === 'number',
      ),
    ).toBe(true);
    expect(recoveryCoverage(recovery).status).toBe('unresolved');
    expect(recoveryCoverage(recovery).conflictsMentionAllCandidates).toBe(true);
  });

  it('keeps the recounted days and withholds overlapping, excluded, and unresolved figures', () => {
    const views = resolveDaily(
      imported.observations,
      'page_views',
      '2026-10-28',
      '2026-11-06',
    );
    const byDay = Object.fromEntries(views.map((day) => [day.day, day]));
    expect(byDay['2026-10-28']).toMatchObject({
      status: 'unavailable',
      value: null,
    });
    expect(byDay['2026-10-29']).toMatchObject({ status: 'exact', value: 4163 });
    expect(byDay['2026-10-30']).toMatchObject({ status: 'exact', value: 2234 });
    for (const day of [
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
    ]) {
      expect(byDay[day]).toMatchObject({
        status: 'unavailable',
        value: null,
        reason: 'reported_unknown',
      });
    }
    expect(byDay['2026-11-05'].value).toBeNull();
    expect(byDay['2026-11-06']).toMatchObject({
      status: 'unavailable',
      reason: 'no_observation',
    });
    const summed = views.reduce((sum, day) => sum + (day.value ?? 0), 0);
    expect(summed).not.toBe(16425);
    expect(additivePageviews(views).status).toBe('unavailable');
    expect(
      resolveWindow(imported.observations, 'window_page_views'),
    ).toMatchObject({
      status: 'exact',
      value: 16425,
    });
    expect(resolveWindow(imported.observations, 'window_ip_ua')).toMatchObject({
      status: 'unavailable',
      reason: 'window_not_usable',
    });
    const withheld = resolveWindow(
      imported.observations,
      'window_page_views',
    ).withheld;
    expect(
      withheld.some(
        (item) => item.value === 36930 && item.coverage === 'excluded',
      ),
    ).toBe(true);
    expect(
      withheld.some(
        (item) => item.snapshotId === 'H11' && item.value === 36930,
      ),
    ).toBe(true);
    expect(16425 + 36930).not.toBe(
      resolveWindow(imported.observations, 'window_page_views').value,
    );
  });

  it('does not treat 5764 or 7145 as people or add them to new telemetry', () => {
    const unresolved = imported.observations.find(
      (item) => item.snapshotId === 'H14' && item.metric === 'window_ip_ua',
    );
    expect(unresolved).toMatchObject({
      value: 5764,
      coverage: 'unresolved',
      usableInTotals: false,
    });
    const anyHit = imported.observations.find(
      (item) => item.metric === 'any_hit_ip_ua',
    );
    expect(anyHit).toMatchObject({ value: 7145, usableInTotals: false });
    const daily = resolveDaily(
      imported.observations,
      'daily_ip_ua',
      '2026-10-29',
      '2026-10-30',
    );
    expect(daily.map((day) => day.value)).toEqual([2219, 772]);
    expect(allTimeFromDailyUniques()).toMatchObject({
      status: 'unavailable',
      value: null,
    });
    expect(2219 + 772).not.toBe(5764);
    const mixed = combineDaily(
      [{ day: '2026-10-30', value: 10 }],
      resolveDaily(
        imported.observations,
        'page_views',
        '2026-10-30',
        '2026-10-30',
      ),
    );
    expect(mixed[0]).toMatchObject({
      status: 'unavailable',
      reason: 'overlapping_sources',
      value: null,
    });
  });

  it('keeps database snapshots as readings, not activation or summed users', () => {
    const users = pointReadings(imported.observations, 'reported_users');
    expect(users.latest?.value).toBe(105);
    expect(users.summed).toBeNull();
    const confirmed = imported.observations.filter(
      (item) => item.metric === 'reported_confirmed_trades',
    );
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.value).toBe(3);
    expect(contentHash(imported)).toBe(contentHash(recoveryToImport(recovery)));
  });
});

describe('funnel, trades, and comparisons', () => {
  it('does not count a setup click as a connection and separates grant outcomes', () => {
    const report = buildFunnel({
      from: '2026-11-01',
      to: '2026-11-07',
      facts: [
        {
          occurredAt: '2026-11-01T00:00:00.000Z',
          eventType: 'setup_cta',
          sessionHash: 's',
        },
        { occurredAt: '2026-11-01T01:00:00.000Z', eventType: 'oauth_refused' },
        { occurredAt: '2026-11-01T02:00:00.000Z', eventType: 'oauth_failed' },
        { occurredAt: '2026-11-01T03:00:00.000Z', eventType: 'oauth_expired' },
        {
          occurredAt: '2026-11-02T00:00:00.000Z',
          eventType: 'research_success',
          toolName: 'getStockResearch',
          accountHash: 'a',
        },
        {
          occurredAt: '2026-11-03T00:00:00.000Z',
          eventType: 'research_success',
          toolName: 'get_stock',
          accountHash: 'a',
        },
        {
          occurredAt: '2026-11-03T01:00:00.000Z',
          eventType: 'mcp_stock_context',
          toolName: 'get_stock',
          lane: 'mcp',
          accountHash: 'a',
        },
      ],
      connections: [
        {
          grantId: 'g',
          accountHash: 'a',
          createdAt: '2026-11-01T04:00:00.000Z',
          revokedAt: null,
        },
      ],
    });
    expect(report.slices[0]).toMatchObject({
      setupEvents: 1,
      connections: 1,
      oauthRefused: 1,
      oauthFailed: 1,
      oauthExpired: 1,
      researchCalls: 1,
      researchAccounts: 1,
      mcpResearchActivation: {
        status: 'unavailable',
        reason: 'no_mcp_research_tool',
      },
      mcpStockContext: { tool: 'get_stock', calls: 1, accounts: 1 },
    });
    assertPublicReport(report);
  });

  it('counts each trade once across browser and delegated lanes', () => {
    const counts = countTrades({
      intents: [
        {
          id: '1',
          userId: 'a',
          mode: 'browser',
          status: 'confirmed',
          approvalId: 'ap1',
        },
        {
          id: '1',
          userId: 'a',
          mode: 'browser',
          status: 'confirmed',
          approvalId: 'ap1',
        },
        { id: '2', userId: 'a', mode: 'delegated', status: 'prepared' },
        { id: '3', userId: 'b', mode: 'delegated', status: 'confirmed' },
      ],
      approvals: [{ id: 'ap1', userId: 'a', executionId: 'e1' }],
      executions: [
        { id: 'e1', status: 'confirmed' },
        { id: 'e2', status: 'confirmed' },
        { id: 'e3', status: 'failed' },
      ],
    });
    expect(counts.confirmed).toEqual({
      browser: 1,
      delegated: 1,
      unlinkedBrowser: 1,
    });
    expect(counts.uniqueActivatedAccounts).toBe(2);
    expect(counts.preparations.browser).toBe(1);
    assertPublicReport(counts);
  });

  it('withholds significance and unfinished retention windows', () => {
    expect(
      compareSlices(
        [{ key: 'launch', sampleSize: 5, connections: 1, researchAccounts: 0 }],
        30,
      ).rows[0]?.significance,
    ).toEqual({
      status: 'unavailable',
      reason: 'sample_below_minimum',
    });
    expect(
      retention({
        events: [
          {
            accountHash: 'a',
            at: '2026-11-06T00:00:00.000Z',
            kind: 'research',
          },
          {
            accountHash: 'a',
            at: '2026-11-07T00:00:00.000Z',
            kind: 'trade_confirmed',
          },
        ],
        cohortFrom: '2026-11-01',
        cohortTo: '2026-11-07',
        windowDays: 7,
        asOf: NOW,
      }).status,
    ).toBe('unavailable');
  });

  it('keeps a partial WAT day out of raw deletion and out of a closed pageview total', () => {
    const now = new Date('2026-11-07T10:00:00.000Z');
    const boundary = retentionBoundary(now, 30);
    expect(boundary.purgeBefore.toISOString()).toBe('2026-10-07T23:00:00.000Z');
    expect(dayIsPartial('2026-11-07', 'Africa/Lagos', now)).toBe(true);
    expect(dayIsPartial('2026-11-06', 'Africa/Lagos', now)).toBe(false);
    const totals = closedPageviews(
      [
        { day: '2026-11-06', status: 'exact' as const, value: 10 },
        { day: '2026-11-07', status: 'exact' as const, value: 4 },
      ],
      new Set(['2026-11-07']),
    );
    expect(totals.total).toEqual({ status: 'exact', value: 10 });
    expect(totals.daily[1]).toMatchObject({
      status: 'partial',
      reason: 'civil_day_still_open',
    });
    expect(() => assertPublicReport({ note: 'oren_rpt_secret' })).toThrow();
  });

  it('rolls a shared visitor once per day and does not treat that sum as lifetime', () => {
    const rolled = rollPageviews(
      [
        row('2026-10-29T10:00:00.000Z', 'v1', 's1'),
        row('2026-10-29T11:00:00.000Z', 'v1', 's2'),
        row('2026-10-30T10:00:00.000Z', 'v1', 's3'),
      ],
      'UTC',
      (instant) => zonedDay(instant, 'UTC'),
    );
    const site = rolled.filter((item) => item.grain === 'site');
    expect(site.map((item) => item.dailyUniques)).toEqual([1, 1]);
    expect(site.reduce((sum, item) => sum + item.dailyUniques, 0)).toBe(2);
    expect(allTimeFromDailyUniques().reason).toBe(
      'summing_daily_uniques_is_not_lifetime_uniques',
    );
    expect(
      planMaintenance({
        today: '2026-11-07',
        lookbackDays: 3,
        rawRetentionDays: 30,
        daysWithRaw: ['2026-10-01', '2026-11-06'],
        frozenDays: [],
      }),
    ).toEqual({ recompute: ['2026-11-06'], freeze: ['2026-10-01'] });
  });
});

describe('reporting failures stay off the core path', () => {
  it('swallows a recorder error', async () => {
    await expect(
      observeGrowth(() => Promise.reject(new Error('db down'))),
    ).resolves.toBeUndefined();
  });
});

function botToken(): string {
  return `oren_rpt_${'a'.repeat(43)}`;
}

function row(occurredAt: string, visitorHash: string, sessionHash: string) {
  return {
    occurredAt,
    path: '/agents',
    visitorHash,
    sessionHash,
    campaign: 'launch',
    source: 'beacon' as const,
    stability: 'durable' as const,
  };
}
