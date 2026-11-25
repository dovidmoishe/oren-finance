import type { AppEnv } from '../../config/env.schema';
import { breakdown, dailySources, originHosts } from './growth-breakdowns';
import { caddyLineToPageview, decideCollect } from './growth-collect';
import type { GrowthGeoService } from './growth-geo.service';
import { externalReferrer, siteHost } from './growth-privacy';
import { GrowthReportService } from './growth-report.service';
import type { GrowthRepository } from './growth.repository';

const row = (
  day: string,
  source: 'beacon' | 'caddy',
  grain: string,
  dimension: string,
  sessions: number,
  pageviews = sessions,
) => ({ day, source, grain, dimension, sessions, pageviews });

describe('referring sites', () => {
  it('keeps only the host of another site, without www or a port', () => {
    expect(externalReferrer('https://t.co/abc?x=1', 'oren.finance')).toBe(
      't.co',
    );
    expect(externalReferrer('https://www.google.com/', 'oren.finance')).toBe(
      'google.com',
    );
    expect(externalReferrer('https://docs.oren.finance', 'oren.finance')).toBe(
      'docs.oren.finance',
    );
    expect(externalReferrer('http://localhost:3000/x', 'oren.finance')).toBe(
      'localhost',
    );
    expect(siteHost('WWW.Example.com:8443')).toBe('example.com');
  });

  it('drops links within the same site, bare addresses and garbage', () => {
    expect(
      externalReferrer('https://oren.finance/app', 'oren.finance'),
    ).toBeNull();
    expect(
      externalReferrer('https://www.oren.finance/', 'oren.finance:443'),
    ).toBeNull();
    expect(
      externalReferrer('http://203.0.113.5/page', 'oren.finance'),
    ).toBeNull();
    expect(
      externalReferrer('http://[2001:db8::1]/', 'oren.finance'),
    ).toBeNull();
    expect(externalReferrer('not a url', 'oren.finance')).toBeNull();
    expect(externalReferrer(undefined, 'oren.finance')).toBeNull();
  });

  it('records the referrer from the beacon and leaves the country to the controller', () => {
    const now = new Date('2026-11-25T12:00:00Z');
    const body = {
      event: 'pageview',
      eventId: '11111111-1111-4111-8111-111111111111',
      occurredAt: now.toISOString(),
      path: '/app/markets',
      visitorId: '22222222-2222-4222-8222-222222222222',
      sessionId: '33333333-3333-4333-8333-333333333333',
      host: 'oren.finance',
      userAgent: 'Mozilla/5.0',
    };
    const external = decideCollect(
      { ...body, referrer: 'https://www.reddit.com' },
      now,
      'pepper',
      [],
    );
    const internal = decideCollect(
      {
        ...body,
        eventId: '44444444-4444-4444-8444-444444444444',
        referrer: 'https://oren.finance',
      },
      now,
      'pepper',
      [],
    );
    expect(external.status === 'pageview' && external.draft).toMatchObject({
      referrerHost: 'reddit.com',
      country: null,
    });
    expect(internal.status === 'pageview' && internal.draft).toMatchObject({
      referrerHost: null,
    });
  });

  it('adds country and referrer to an imported Caddy line without keeping the address', () => {
    const line = {
      ts: Date.parse('2026-11-25T10:00:00Z') / 1000,
      status: 200,
      request: {
        method: 'GET',
        host: 'oren.finance',
        uri: '/agents?utm_source=x',
        client_ip: '41.58.0.1',
        headers: {
          'User-Agent': ['Mozilla/5.0'],
          Referer: ['https://news.ycombinator.com/item?id=1'],
        },
      },
    };
    const countryOf = jest.fn((ip: string | null | undefined) =>
      ip === '41.58.0.1' ? 'NG' : null,
    );
    const draft = caddyLineToPageview(line, 'pepper', 'UTC', countryOf);
    expect(draft).toMatchObject({
      country: 'NG',
      referrerHost: 'news.ycombinator.com',
    });
    expect(JSON.stringify(draft)).not.toContain('41.58.0.1');
    expect(caddyLineToPageview(line, 'pepper', 'UTC')?.country).toBeNull();
    const internal = caddyLineToPageview(
      {
        ...line,
        request: {
          ...line.request,
          headers: {
            ...line.request.headers,
            Referer: ['https://oren.finance/'],
          },
        },
      },
      'pepper',
      'UTC',
    );
    expect(internal?.referrerHost).toBeNull();
  });
});

describe('country and referrer breakdowns', () => {
  const metrics = [
    // Day one has both collectors: only the beacon counts.
    row('2026-11-20', 'beacon', 'site', '', 6),
    row('2026-11-20', 'beacon', 'country', 'NG', 4, 9),
    row('2026-11-20', 'beacon', 'country', '(unknown)', 2),
    row('2026-11-20', 'caddy', 'site', '', 50),
    row('2026-11-20', 'caddy', 'country', 'US', 50),
    // Day two only has Caddy.
    row('2026-11-21', 'caddy', 'site', '', 5),
    row('2026-11-21', 'caddy', 'country', 'NG', 1),
    row('2026-11-21', 'caddy', 'country', 'GB', 3),
    row('2026-11-21', 'caddy', 'country', 'US', 1),
  ];

  it('uses one collector per day and keeps unknown countries out of the list', () => {
    expect(dailySources(metrics)).toEqual(
      new Map([
        ['2026-11-20', 'beacon'],
        ['2026-11-21', 'caddy'],
      ]),
    );
    expect(
      breakdown(metrics, 'country', {
        limit: 10,
        isMissing: (key) => key === '(unknown)',
      }),
    ).toEqual({
      total: 9,
      rows: [
        { key: 'NG', visits: 5, pageviews: 10 },
        { key: 'GB', visits: 3, pageviews: 3 },
        { key: 'US', visits: 1, pageviews: 1 },
      ],
      otherVisits: 0,
      missing: 2,
    });
  });

  it('sorts by visits and folds the rest into other visits', () => {
    const result = breakdown(metrics, 'country', {
      limit: 2,
      isMissing: () => false,
    });
    expect(result.rows.map((item) => item.key)).toEqual(['NG', 'GB']);
    expect(result.otherVisits).toBe(3);
    expect(result.total).toBe(11);
  });

  it('reads the app origins from CORS_ORIGIN', () => {
    expect(
      originHosts('https://oren.finance, https://www.oren.finance:443,*'),
    ).toEqual(new Set(['oren.finance']));
    expect(originHosts('*')).toEqual(new Set());
  });

  it('reports referrers with own-site and address keys as direct visits', async () => {
    const dailyMetrics = jest
      .fn()
      .mockResolvedValue([
        row('2026-11-20', 'beacon', 'site', '', 20),
        row('2026-11-20', 'beacon', 'referrer', 't.co', 7, 12),
        row('2026-11-20', 'beacon', 'referrer', 'google.com', 5),
        row('2026-11-20', 'beacon', 'referrer', 'oren.finance', 2),
        row('2026-11-20', 'beacon', 'referrer', '203.0.113.5', 1),
        row('2026-11-20', 'beacon', 'referrer', '(direct)', 5),
        row('2026-11-20', 'beacon', 'country', 'NG', 15),
        row('2026-11-20', 'beacon', 'country', '(unknown)', 5),
      ]);
    const repository = { dailyMetrics } as unknown as GrowthRepository;
    const env = { CORS_ORIGIN: 'https://oren.finance' } as AppEnv;
    const geo = { version: '2026-11' } as GrowthGeoService;
    const report = await new GrowthReportService(
      repository,
      env,
      geo,
    ).breakdowns('2026-11-20', '2026-11-20', 'UTC');
    expect(dailyMetrics).toHaveBeenCalledWith(
      '2026-11-20',
      '2026-11-20',
      'UTC',
    );
    expect(report.referrers).toEqual({
      total: 12,
      rows: [
        { key: 't.co', visits: 7, pageviews: 12 },
        { key: 'google.com', visits: 5, pageviews: 5 },
      ],
      otherVisits: 0,
      missing: 8,
    });
    expect(report.countries).toMatchObject({ total: 15, missing: 5 });
    expect(report.geolocation).toEqual({
      provider: 'DB-IP',
      attributionUrl: 'https://db-ip.com',
      database: '2026-11',
    });
    expect(
      (
        await new GrowthReportService(repository, env).breakdowns(
          '2026-11-20',
          '2026-11-20',
        )
      ).geolocation.database,
    ).toBeNull();
  });
});
