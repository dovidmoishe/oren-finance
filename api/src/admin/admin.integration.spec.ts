import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import type { Database } from '../database/database.provider';
import { AdminAuthRepository } from './auth/admin-auth.repository';
import { AdminAuthService } from './auth/admin-auth.service';
import { hashPassword, temporaryPassword } from './auth/admin-password';
import { DashboardRepository } from './dashboard/dashboard.repository';
import { validateEnv } from '../config/env.schema';
import { GrowthRecorder } from './reporting/growth-recorder.service';
import { GrowthReportService } from './reporting/growth-report.service';
import { GrowthAccessService } from './reporting/growth-access.service';
import { newMachineToken, tokenHash } from './reporting/growth-privacy';
import { countTrades } from './reporting/growth-trades';
import { GrowthRepository } from './reporting/growth.repository';

const url = process.env.MCP_TEST_POSTGRES_URL;
const databaseSuite = url ? describe : describe.skip;

databaseSuite('admin sessions and growth events in Postgres', () => {
  let client: ReturnType<typeof postgres>;
  let db: Database;

  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1'].includes(target.hostname) ||
      target.pathname !== '/oren_mcp_test'
    )
      throw new Error(
        'Admin tests require the disposable local oren_mcp_test database',
      );
    client = postgres(url!, { max: 4 });
    db = drizzle(client);
    await migrate(db, { migrationsFolder: resolve('lib/db/migrations') });
  }, 90_000);

  afterAll(async () => {
    await client?.end({ timeout: 5 });
  });

  it('issues one session for concurrent temporary logins and invalidates it on rotation', async () => {
    const repository = new AdminAuthRepository(db);
    const service = new AdminAuthService(repository);
    const email = `admin-${randomUUID()}@example.test`;
    const password = temporaryPassword();
    await repository.insertAccount({
      email,
      passwordHash: await hashPassword(password),
      isMaster: false,
      status: 'invited',
      mustChangePassword: true,
      tempPasswordExpiresAt: new Date(Date.now() + 60_000),
      createdBy: null,
      permissions: ['reports.read'],
    });
    const results = await Promise.allSettled([
      service.login({ email, password }),
      service.login({ email, password }),
    ]);
    const successes = results.filter((result) => result.status === 'fulfilled');
    expect(successes).toHaveLength(1);
    const { sessionId, csrfToken } = successes[0].value;
    await expect(service.reportActor(sessionId)).rejects.toMatchObject({
      status: 403,
    });
    const nextPassword = temporaryPassword();
    await service.changePassword({
      sessionId,
      csrfToken,
      currentPassword: password,
      nextPassword,
    });
    await expect(service.session(sessionId)).rejects.toMatchObject({
      status: 401,
    });
    const active = await service.login({ email, password: nextPassword });
    await expect(
      service.reportActor(active.sessionId),
    ).resolves.toBeUndefined();
    await expect(
      service.dashboardActor(active.sessionId),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('keeps repeated research calls while deduplicating delivery of the same event', async () => {
    const repository = new GrowthRepository(db);
    const accountHash = randomUUID();
    const event = {
      occurredAt: new Date(),
      accountHash,
      eventType: 'research_success',
      lane: 'mcp',
      toolName: 'get_stock_research',
      isFirst: true,
    };
    const sourceId = randomUUID();
    await Promise.all(
      [sourceId, sourceId, randomUUID()].map((id) =>
        repository.insertFunnel({ ...event, sourceId: id }),
      ),
    );
    const rows =
      await client`select is_first from growth_funnel_events where account_hash = ${accountHash}`;
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.is_first === true)).toHaveLength(1);
  });
  it('attributes MCP research to a campaign and authenticates a revocable bot reader', async () => {
    const repo = new GrowthRepository(db);
    const env = validateEnv({
      POSTGRES_URL: url,
      TOKENS_API_KEY: 'test',
      ALCHEMY_API_KEY: 'test',
    });
    const recorder = new GrowthRecorder(repo, env);
    const reports = new GrowthReportService(repo, env);
    const accountId = randomUUID();
    const now = new Date();
    const campaign = randomUUID();
    await recorder.recordOauth({
      eventType: 'oauth_completed',
      sourceId: randomUUID(),
      accountId,
      attribution: { first: { at: now.toISOString(), campaign } },
    });
    await recorder.recordResearch({
      accountId,
      sourceId: randomUUID(),
      lane: 'mcp',
      tool: 'get_stock_research',
    });
    const reader = new GrowthAccessService(repo);
    const token = newMachineToken();
    const hash = tokenHash(token);
    await client`insert into growth_access_grants(permission, principal_kind, token_hash, label)
      values ('marketing.bot.read', 'marketing_bot', ${hash}, 'test')`;
    await reader.authenticate(`Bearer ${token}`, undefined);
    const day = now.toISOString().slice(0, 10);
    const report = await reports.funnel(day, day, 'campaign');
    expect(report.slices.find((slice) => slice.key === campaign)).toMatchObject(
      {
        mcpResearchActivation: { calls: 1, accounts: 1 },
        inAppResearch: { calls: 0 },
      },
    );
    await client`update growth_access_grants set revoked_at=now() where token_hash=${hash}`;
    await expect(
      reader.authenticate(`Bearer ${token}`, undefined),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('deduplicates visits and preserves first and last seen when events arrive out of order', async () => {
    const repo = new GrowthRepository(db);
    const visitorHash = randomUUID();
    const draft = {
      occurredAt: new Date('2025-10-01T12:00:00Z'),
      path: '/agents',
      visitorHash,
      sessionHash: randomUUID(),
      visitorStability: 'durable' as const,
      referrerHost: null,
      country: null,
      source: 'beacon' as const,
      ingestKey: randomUUID(),
      excluded: false,
      excludeReason: null,
    };
    expect(await repo.insertPageview(draft)).toBe('inserted');
    expect(await repo.insertPageview(draft)).toBe('duplicate');
    const earlier = new Date('2025-10-01T10:00:00Z');
    await repo.insertPageview({
      ...draft,
      occurredAt: earlier,
      ingestKey: randomUUID(),
    });
    const [visitor] = await client<
      { first_seen_at: string; last_seen_at: string }[]
    >`select first_seen_at, last_seen_at from growth_visitors where visitor_hash=${visitorHash}`;
    expect(new Date(visitor.first_seen_at)).toEqual(earlier);
    expect(new Date(visitor.last_seen_at)).toEqual(draft.occurredAt);
  });

  it('freezes complete UTC and Lagos days across the retention boundary on a busy site', async () => {
    const repo = new GrowthRepository(db);
    const path = '/test-' + randomUUID();
    await client`
      insert into growth_pageviews (occurred_at, path, visitor_hash, session_hash, visitor_stability, source, ingest_key)
      select case when i = 50001 then '2025-01-01 23:30Z'::timestamptz else '2025-01-01 22:30Z'::timestamptz end,
        ${path}, 'visitor', 'session', 'durable', 'beacon', ${path} || i::text
      from generate_series(1, 50001) i
    `;
    const now = new Date('2025-02-01T12:00:00Z');
    const cutoff = new Date('2025-01-02T12:00:00Z');
    for (let pass = 0; pass < 2; pass++) {
      await repo.rollupPageviews(now, cutoff, new Date('2025-01-01T23:00:00Z'));
    }
    const rows =
      await client`select day::text, timezone, pageviews, daily_uniques, frozen from growth_daily_metrics
      where grain='path' and dimension=${path} order by timezone, day`;
    expect(rows).toEqual([
      {
        day: '2025-01-01',
        timezone: 'Africa/Lagos',
        pageviews: 50000,
        daily_uniques: 1,
        frozen: true,
      },
      {
        day: '2025-01-02',
        timezone: 'Africa/Lagos',
        pageviews: 1,
        daily_uniques: 1,
        frozen: false,
      },
      {
        day: '2025-01-01',
        timezone: 'UTC',
        pageviews: 50001,
        daily_uniques: 1,
        frozen: true,
      },
    ]);
  }, 60_000);

  it('uses one traffic collector per day for reports and exports', async () => {
    const reports = new GrowthReportService(
      new GrowthRepository(db),
      validateEnv({
        POSTGRES_URL: url,
        TOKENS_API_KEY: 'test',
        ALCHEMY_API_KEY: 'test',
      }),
    );
    await client`insert into growth_daily_metrics (day, timezone, grain, source, pageviews, sessions, daily_uniques)
      values ('2025-04-01', 'UTC', 'site', 'caddy', 11, 7, 6),
             ('2025-04-02', 'UTC', 'site', 'beacon', 5, 4, 3),
             ('2025-04-02', 'UTC', 'site', 'caddy', 20, 12, 9)
      on conflict (day, timezone, grain, source, dimension) do update
      set pageviews = excluded.pageviews, daily_uniques = excluded.daily_uniques`;
    const report = await reports.traffic('2025-04-01', '2025-04-02', 'UTC');
    expect(report.pageviews).toMatchObject({ value: 16 });
    expect(report.dailyUniques.days).toEqual([
      { day: '2025-04-01', value: 6, source: 'caddy' },
      { day: '2025-04-02', value: 3, source: 'beacon' },
    ]);
    const csv = await reports.dailyExport(
      '2025-04-01',
      '2025-04-02',
      'UTC',
      'csv',
    );
    expect(csv.body).toContain('2025-04-01,exact,11,,caddy');
    expect(csv.body).toContain('2025-04-02,exact,5,,telemetry');
  });

  it('adds verified stock fills and counts chats with a user message within the range', async () => {
    const activity = new DashboardRepository(db);
    const chat = randomUUID();
    const quietChat = randomUUID();
    const signature = randomUUID();
    const wallet = randomUUID();
    await client`insert into agent_threads (id, wallet_address) values (${chat}, ${wallet}), (${quietChat}, ${wallet})`;
    try {
      await client`insert into agent_messages (thread_id, role, content, created_at)
        values
          (${chat}, 'user', 'sample', '2025-06-11T01:00Z'),
          (${chat}, 'user', 'sample', '2025-06-11T02:00Z'),
          (${quietChat}, 'assistant', 'sample', '2025-06-11T02:00Z'),
          (${quietChat}, 'user', 'sample', '2025-06-12T00:00Z')`;
      await client`insert into trade_fills
        (transaction_signature, fill_index, wallet_address, asset_id, ticker, token_mint, side,
          stock_amount, usd_notional, execution_price_usd, feature_source, provider, slot, block_time)
        values
          (${signature}, 0, ${wallet}, 'fixture', 'TEST', 'fixture', 'buy', 1, 10, 10, 'direct', 'test', 1, '2025-06-11T01:00Z'),
          (${signature}, 1, ${wallet}, 'fixture', 'TEST', 'fixture', 'sell', 1, 12, 12, 'direct', 'test', 1, '2025-06-11T01:00Z'),
          (${signature}, 2, ${wallet}, 'fixture', 'TEST', 'fixture', 'sell', 1, 30, 30, 'direct', 'test', 2, '2025-06-12T00:00Z')`;
      await expect(
        activity.activity(new Date('2025-06-11'), new Date('2025-06-12')),
      ).resolves.toEqual({ volumeUsd: 22, trades: 1, chats: 1, messages: 2 });
    } finally {
      await client`delete from trade_fills where wallet_address = ${wallet}`;
      await client`delete from agent_threads where id in (${chat}, ${quietChat})`;
    }
  });

  it('counts a linked browser trade on its intent day across midnight', async () => {
    const repo = new GrowthRepository(db);
    const wallet = randomUUID();
    const linked = randomUUID();
    const approval = randomUUID();
    await client`insert into executions (id, wallet_address, type, status, created_at)
      values (${linked}, ${wallet}, 'stock_purchase', 'confirmed', '2025-04-02 00:01Z'),
             (gen_random_uuid(), ${wallet}, 'stock_purchase', 'confirmed', '2025-04-02 00:02Z')`;
    await client`insert into trade_approvals (id, user_id, wallet, wallet_id, kind, reference_id, execution_id,
      transaction, details, fee_lamports, expires_at)
      values (${approval}, ${wallet}, ${wallet}, ${wallet}, 'test', ${linked}, ${linked}, 'fixture', '{}', '0', now())`;
    await client`insert into mcp_trade_intents (grant_id, client_id, user_id, wallet, asset_id, ticker, approval_id,
      amount_usd, slippage_bps, status, expires_at, created_at)
      values ('test', 'test', ${wallet}, ${wallet}, 'test', 'TEST', ${approval}, 1, 5, 'confirmed', now(), '2025-04-01 23:59Z')`;
    const counts = async (from: string, to: string) =>
      countTrades(await repo.tradeFacts(new Date(from), new Date(to)));
    try {
      for (const [from, to, browser, unlinkedBrowser] of [
        ['2025-04-01', '2025-04-02', 1, 0],
        ['2025-04-02', '2025-04-03', 0, 1],
        ['2025-04-01', '2025-04-03', 1, 1],
      ] as const) {
        const expected = { browser, delegated: 0, unlinkedBrowser };
        expect(await counts(from, to)).toMatchObject({
          preparations: expected,
          confirmed: expected,
        });
      }
    } finally {
      await client`delete from mcp_trade_intents where approval_id = ${approval}`;
      await client`delete from trade_approvals where id = ${approval}`;
      await client`delete from executions where wallet_address = ${wallet}`;
    }
  });

  it('replaces a recomputed day so a visit that changes group counts once', async () => {
    const repo = new GrowthRepository(db);
    const at = (time: string) => new Date(`2024-02-29T${time}Z`);
    const caddyKey = `caddy:${randomUUID()}`;
    const visitorHash = randomUUID();
    const sessionHash = randomUUID();
    const view = {
      path: '/',
      excluded: false,
      excludeReason: null,
      country: null,
    };
    await repo.insertPageview({
      ...view,
      occurredAt: at('09:00:00'),
      visitorHash: randomUUID(),
      sessionHash: randomUUID(),
      visitorStability: 'day',
      source: 'caddy',
      ingestKey: caddyKey,
      referrerHost: null,
    });
    await repo.insertPageview({
      ...view,
      occurredAt: at('10:05:00'),
      visitorHash,
      sessionHash,
      visitorStability: 'durable',
      source: 'beacon',
      ingestKey: randomUUID(),
      referrerHost: 't.co',
    });
    const rollup = () =>
      repo.rollupPageviews(
        new Date('2024-03-02T00:00:00Z'),
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-01-01T00:00:00Z'),
      );
    await rollup();
    // A repeat import fills in the country, and the visit's first page arrives late.
    await client`update growth_pageviews set country = 'NG' where ingest_key = ${caddyKey}`;
    await repo.insertPageview({
      ...view,
      occurredAt: at('10:00:00'),
      visitorHash,
      sessionHash,
      visitorStability: 'durable',
      source: 'beacon',
      ingestKey: randomUUID(),
      referrerHost: 'news.ycombinator.com',
    });
    await rollup();
    const rows = await client<
      { grain: string; dimension: string; source: string; sessions: number }[]
    >`select grain, dimension, source, sessions from growth_daily_metrics
      where day = '2024-02-29' and timezone = 'UTC' and grain in ('country', 'referrer')`;
    // Sorted here so the database collation cannot change the order.
    expect(
      rows
        .map((row) =>
          [row.grain, row.dimension, row.source, row.sessions].join(' '),
        )
        .sort(),
    ).toEqual([
      'country (unknown) beacon 1',
      'country NG caddy 1',
      'referrer (direct) caddy 1',
      'referrer news.ycombinator.com beacon 1',
    ]);
  });
});
