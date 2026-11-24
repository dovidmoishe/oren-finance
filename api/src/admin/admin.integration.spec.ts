import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import type { Database } from '../database/database.provider';
import { AdminAuthRepository } from './auth/admin-auth.repository';
import { AdminAuthService } from './auth/admin-auth.service';
import { hashPassword, temporaryPassword } from './auth/admin-password';
import { validateEnv } from '../config/env.schema';
import { GrowthRecorder } from './reporting/growth-recorder.service';
import { GrowthReportService } from './reporting/growth-report.service';
import { GrowthAccessService } from './reporting/growth-access.service';
import { newMachineToken, tokenHash } from './reporting/growth-privacy';
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
    const [visitor] =
      await client`select first_seen_at, last_seen_at from growth_visitors where visitor_hash=${visitorHash}`;
    expect(visitor.first_seen_at).toEqual(earlier);
    expect(visitor.last_seen_at).toEqual(draft.occurredAt);
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
  });
});
