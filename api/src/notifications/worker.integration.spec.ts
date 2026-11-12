import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import type { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { SenviokEmailService } from '../senviok/senviok.service';
import type { TokensService } from '../tokens/tokens.service';
import { PriceAlerts, PricePolling } from './alerts';
import type { MorningBrief } from './brief';
import { NotificationDelivery, unsubscribeToken } from './delivery';
import { insertJob, NotificationJobs } from './jobs';
import { NotificationWorker } from './worker';

jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));

const pgUrl = process.env.MCP_TEST_POSTGRES_URL;
const redisUrl = process.env.NOTIFICATION_TEST_REDIS_URL;
const run = pgUrl && redisUrl ? describe : describe.skip;
const mint = 'NVDAVuiB7hwd3m5Wa1JuHNovPaPG6BH1QNztbKFxNjv';
const user = 'did:privy:fixture';
const secret = 'test-only'.repeat(4);
const options = {
  DEPLOYMENT_ENV: 'preview',
  NOTIFICATION_FIXTURE_MODE: 'true',
  NOTIFICATION_FIXTURE_RECIPIENT: 'fixture@example.test',
  NOTIFICATION_APP_ORIGIN: 'https://preview.example.test',
  NOTIFICATION_UNSUBSCRIBE_SECRET: secret,
  NOTIFICATION_PILOT_USERS: user,
  MORNING_BRIEF_ENABLED: 'true',
  NOTIFICATION_EMAIL_PER_MINUTE: '20',
  NOTIFICATION_TOKENS_PER_MINUTE: '20',
  PRICE_ALERTS_ENABLED: 'true',
  TOKENS_ALERT_TIMESTAMPS_VERIFIED: 'true',
  NOTIFICATION_ALERT_MINTS: mint,
};

run('notification jobs with disposable Postgres and Redis', () => {
  const namespace = `notification_test_${randomUUID().replaceAll('-', '')}`;
  let admin: ReturnType<typeof postgres>;
  let client: ReturnType<typeof postgres>;
  let jobs: NotificationJobs;
  let worker: NotificationWorker | undefined;
  const saved = { ...process.env };

  beforeAll(async () => {
    const pg = new URL(pgUrl!);
    const redis = new URL(redisUrl!);
    if (
      pg.hostname !== '127.0.0.1' ||
      pg.pathname !== '/oren_mcp_test' ||
      redis.hostname !== '127.0.0.1' ||
      redis.protocol !== 'redis:'
    )
      throw new Error('Use disposable local test services');
    Object.assign(process.env, options, { NOTIFICATION_REDIS_URL: redisUrl });
    admin = postgres(pgUrl!);
    await admin`create schema ${admin(namespace)}`;
    client = postgres(pgUrl!, { connection: { search_path: namespace } });
    await client.unsafe(`
      create table cached_stocks (asset_id text, ticker text, category text, expires_at timestamptz);
      create table user_preferences (
        user_id text primary key, sectors text[], morning_brief boolean, breaking_news boolean,
        brief_time text, time_zone text
      );
    `);
    await client.unsafe(
      await readFile('lib/db/migrations/0018_notifications.sql', 'utf8'),
    );
    jobs = new NotificationJobs(drizzle(client) as never);
  }, 20_000);

  afterAll(async () => {
    if (worker) await worker.onModuleDestroy();
    if (client) await client.end();
    if (admin) {
      await admin`drop schema ${admin(namespace)} cascade`;
      await admin.end();
    }
    for (const key of [...Object.keys(options), 'NOTIFICATION_REDIS_URL']) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('recovers a pending outbox job, accepts it once, and holds expired handoffs as uncertain', async () => {
    process.env.PRICE_ALERTS_ENABLED = 'false';
    await client`insert into user_preferences (user_id, morning_brief, brief_time, time_zone)
      values (${user}, true, '08:00', 'UTC')`;
    const identity = {
      getNotificationIdentity: jest
        .fn()
        .mockResolvedValue({ email: 'fixture@example.test' }),
    };
    const provider = new SenviokEmailService({});
    const sendEmail = jest.spyOn(provider, 'sendEmail');
    const delivery = new NotificationDelivery(
      jobs,
      identity as unknown as PrivyWalletAuth,
      provider,
    );
    await jobs.db.execute(
      insertJob(user, 'brief-email', 'recoverable-brief', {
        date: '2026-11-12',
        time: '08:00',
        zone: 'UTC',
        scheduled: new Date().toISOString(),
        stories: [],
        moves: [],
      }),
    );
    const [pending] = await jobs.pending('brief-email');
    worker = new NotificationWorker(
      jobs,
      {} as MorningBrief,
      delivery,
      {} as PricePolling,
    );
    worker.onApplicationBootstrap();
    await waitFor(async () => {
      const [row] =
        await client`select state from notification_jobs where id = ${pending.id}`;
      return row.state === 'accepted';
    });
    const conn = new Redis(redisUrl!);
    const queue = new Queue('oren-notification-brief-email', {
      connection: conn,
    });
    try {
      await queue.add(
        'duplicate',
        {},
        { jobId: pending.id, removeOnComplete: true },
      );
      await waitFor(async () => (await queue.getJob(pending.id)) === undefined);
    } finally {
      await queue.close();
      conn.disconnect();
    }
    expect(identity.getNotificationIdentity).toHaveBeenCalledTimes(1);
    expect(sendEmail).not.toHaveBeenCalled();
    await worker.onModuleDestroy();
    worker = undefined;
    await client`update notification_jobs set state = 'sending', lease_until = now() - interval '1 minute'
      where id = ${pending.id}`;
    expect(await jobs.sweep()).toBe(1);
    expect(await jobs.claim(pending.id, 'brief-email')).toBeUndefined();
    expect(
      await delivery.subscription(unsubscribeToken(pending.id, secret), true),
    ).toBe('brief-email');
    const [prefs] =
      await client`select morning_brief from user_preferences where user_id = ${user}`;
    expect(prefs.morning_brief).toBe(false);
    process.env.PRICE_ALERTS_ENABLED = 'true';
  }, 25_000);

  it('checks one mint for concurrent rules and cancels queued alert email on unsubscribe', async () => {
    await client`insert into cached_stocks values ('nvda', 'NVDA', 'equity', now()+interval '1 hour',
      ${JSON.stringify([{ mint, symbol: 'NVDAx' }])}::jsonb)`;
    const alerts = new PriceAlerts(jobs.db, jobs);
    const body = { assetId: 'nvda', mint, direction: 'above', target: '120' };
    const first = await alerts.create(user, true, body);
    await expect(alerts.create(user, true, body)).rejects.toMatchObject({
      status: 409,
    });
    await alerts.create(user, true, { ...body, target: '119' });
    await client`update price_alerts set quote_at = now()-interval '1 minute', quote_price = 118,
      created_at = now()-interval '2 minutes' where user_id = ${user}`;
    const getMarketSnapshots = jest.fn().mockResolvedValue([
      {
        mint,
        price: 120,
        providerFetchedAt: Date.now() - 1000,
        lastTradeAt: Date.now() - 2000,
      },
    ]);
    const polling = new PricePolling(jobs, {
      getMarketSnapshots,
    } as unknown as TokensService);
    await Promise.all([polling.scan(), polling.scan()]);
    expect(getMarketSnapshots).toHaveBeenCalledTimes(1);
    const queued = await jobs.pending('alert-email');
    expect(queued).toHaveLength(2);
    const delivery = new NotificationDelivery(
      jobs,
      {} as PrivyWalletAuth,
      {} as SenviokEmailService,
    );
    expect(
      await delivery.subscription(unsubscribeToken(queued[0].id, secret), true),
    ).toBe('alert-email');
    expect(await jobs.pending('alert-email')).toHaveLength(0);
    expect(
      (await alerts.list(user, true)).alerts.find(({ id }) => id === first.id),
    ).toBeUndefined();
    await jobs.db.execute(sql`select 1`);
  }, 20_000);

  it('enforces the active cap and creation budget under concurrent requests', async () => {
    await client`delete from notification_budgets where scope = ${`create-alert-${user}`}`;
    await client`insert into price_alerts (user_id, asset_id, ticker, variant, mint, direction, target)
      select ${user}, 'nvda', 'NVDA', 'NVDAx', ${mint}, 'above', n from generate_series(1, 19) n`;
    const alerts = new PriceAlerts(jobs.db, jobs);
    const body = { assetId: 'nvda', mint, direction: 'above' };
    const races = await Promise.allSettled([
      alerts.create(user, true, { ...body, target: '200' }),
      alerts.create(user, true, { ...body, target: '201' }),
    ]);
    expect(races.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const limits = await Promise.all(
      Array.from({ length: 11 }, () =>
        jobs.budget('independent-test-creation', 10),
      ),
    );
    expect(limits.filter(Boolean)).toHaveLength(10);
  }, 20_000);
});

async function waitFor(check: () => Promise<boolean>) {
  const deadline = Date.now() + 12_000;
  do {
    if (await check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for notification worker');
}
