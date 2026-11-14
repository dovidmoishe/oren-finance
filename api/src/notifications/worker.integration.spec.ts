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
import { briefAdmitPerMinute } from './schedule';
import { notificationSettings } from './settings';
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
      await readFile('lib/db/migrations/0019_notifications.sql', 'utf8'),
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

  beforeEach(async () => {
    await client`truncate cached_stocks, user_preferences, notification_jobs,
      price_alerts, price_poll_cursor, notification_budgets`;
  });

  async function seedAlertVariant() {
    await client`insert into cached_stocks values ('nvda', 'NVDA', 'equity', now()+interval '1 hour',
      ${JSON.stringify([{ mint, symbol: 'NVDAx' }])}::jsonb)`;
  }

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
    await seedAlertVariant();
    const alerts = new PriceAlerts(jobs.db, jobs, {
      getMarketSnapshots: jest.fn().mockResolvedValue([]),
    } as unknown as TokensService);
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
    const provider = new SenviokEmailService({});
    const sendEmail = jest.spyOn(provider, 'sendEmail');
    const delivery = new NotificationDelivery(
      jobs,
      {
        getNotificationIdentity: async () => ({
          email: options.NOTIFICATION_FIXTURE_RECIPIENT,
        }),
      } as unknown as PrivyWalletAuth,
      provider,
    );
    const claimed = await jobs.claim(queued[0].id, 'alert-email');
    expect(claimed).toBeDefined();
    await delivery.send(claimed!);
    const [accepted] =
      await client`select state, provider_id from notification_jobs where id = ${queued[0].id}`;
    expect(accepted).toEqual({
      state: 'accepted',
      provider_id: `fixture-${queued[0].id}`,
    });
    expect(await jobs.claim(queued[0].id, 'alert-email')).toBeUndefined();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(
      await delivery.subscription(unsubscribeToken(queued[0].id, secret), true),
    ).toBe('alert-email');
    expect(await jobs.pending('alert-email')).toHaveLength(0);
    expect(
      (await alerts.list(user, true)).alerts.find(({ id }) => id === first.id),
    ).toBeUndefined();
    await jobs.db.execute(sql`select 1`);
  }, 60_000);

  it('enforces the active cap and creation budget under concurrent requests', async () => {
    await seedAlertVariant();
    await client`insert into price_alerts (user_id, asset_id, ticker, variant, mint, direction, target)
      select ${user}, 'nvda', 'NVDA', 'NVDAx', ${mint}, 'above', n from generate_series(1, 19) n`;
    const alerts = new PriceAlerts(jobs.db, jobs, {
      getMarketSnapshots: jest.fn().mockResolvedValue([]),
    } as unknown as TokensService);
    const body = { assetId: 'nvda', mint, direction: 'above' };
    const races = await Promise.allSettled([
      alerts.create(user, true, { ...body, target: '200' }),
      alerts.create(user, true, { ...body, target: '201' }),
    ]);
    expect(races.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(races.filter((r) => r.status === 'rejected')).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ status: 409 }),
      }),
    ]);
    const limits = await Promise.all(
      Array.from({ length: 11 }, () =>
        jobs.budget('independent-test-creation', 10),
      ),
    );
    expect(limits.filter(Boolean)).toHaveLength(10);
  }, 60_000);

  it('starts public alerts and public briefs with an empty pilot list', async () => {
    const previous = {
      MORNING_BRIEF_ENABLED: process.env.MORNING_BRIEF_ENABLED,
      PRICE_ALERTS_ENABLED: process.env.PRICE_ALERTS_ENABLED,
      PRICE_ALERTS_PUBLIC: process.env.PRICE_ALERTS_PUBLIC,
      NOTIFICATION_PILOT_USERS: process.env.NOTIFICATION_PILOT_USERS,
    };
    let started: NotificationWorker | undefined;
    const polling = {
      scan: jest.fn().mockResolvedValue(undefined),
    } as unknown as PricePolling;
    const workerFor = () =>
      new NotificationWorker(
        jobs,
        {} as MorningBrief,
        {} as NotificationDelivery,
        polling,
      );
    try {
      process.env.MORNING_BRIEF_ENABLED = 'false';
      process.env.PRICE_ALERTS_ENABLED = 'true';
      process.env.PRICE_ALERTS_PUBLIC = 'true';
      process.env.NOTIFICATION_PILOT_USERS = '';
      const running = workerFor();
      started = running;
      expect(() => running.onApplicationBootstrap()).not.toThrow();
      await running.onModuleDestroy();
      started = undefined;

      process.env.PRICE_ALERTS_PUBLIC = 'false';
      expect(() => workerFor().onApplicationBootstrap()).toThrow(
        /pilot accounts/,
      );

      process.env.PRICE_ALERTS_ENABLED = 'false';
      process.env.MORNING_BRIEF_ENABLED = 'true';
      const briefs = workerFor();
      started = briefs;
      expect(() => briefs.onApplicationBootstrap()).not.toThrow();
      await briefs.onModuleDestroy();
      started = undefined;

      process.env.PRICE_ALERTS_ENABLED = 'true';
      process.env.PRICE_ALERTS_PUBLIC = 'true';
      const both = workerFor();
      started = both;
      expect(() => both.onApplicationBootstrap()).not.toThrow();
      await both.onModuleDestroy();
      started = undefined;

      process.env.PRICE_ALERTS_PUBLIC = 'false';
      expect(() => workerFor().onApplicationBootstrap()).toThrow(
        /pilot accounts/,
      );
    } finally {
      if (started) await started.onModuleDestroy();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }, 20_000);

  it('queues a shared brief time inside the provider budgets', async () => {
    const previous = {
      MORNING_BRIEF_ENABLED: process.env.MORNING_BRIEF_ENABLED,
      PRICE_ALERTS_ENABLED: process.env.PRICE_ALERTS_ENABLED,
      NOTIFICATION_EMAIL_PER_MINUTE: process.env.NOTIFICATION_EMAIL_PER_MINUTE,
      NOTIFICATION_TOKENS_PER_MINUTE:
        process.env.NOTIFICATION_TOKENS_PER_MINUTE,
      NOTIFICATION_PILOT_USERS: process.env.NOTIFICATION_PILOT_USERS,
    };
    const now = new Date();
    const staleClock = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const briefTime = staleClock.toISOString().slice(11, 16);
    try {
      process.env.MORNING_BRIEF_ENABLED = 'true';
      process.env.PRICE_ALERTS_ENABLED = 'true';
      process.env.NOTIFICATION_EMAIL_PER_MINUTE = '5';
      process.env.NOTIFICATION_TOKENS_PER_MINUTE = '2';
      process.env.NOTIFICATION_PILOT_USERS = '';
      expect(briefAdmitPerMinute(notificationSettings())).toBe(1);
      const due = new Date(now.getTime() - 60_000).toISOString();
      const stale = staleClock.toISOString();
      for (const id of ['user-a', 'user-b', 'user-c', 'user-d', 'user-e']) {
        await client`insert into user_preferences (user_id, morning_brief, brief_time, time_zone, brief_due_at)
          values (${id}, true, ${briefTime}, 'UTC', ${due})`;
      }
      await client`insert into user_preferences (user_id, morning_brief, brief_time, time_zone, brief_due_at)
        values ('user-stale', true, ${briefTime}, 'UTC', ${stale})`;
      await client`insert into user_preferences (user_id, morning_brief, brief_time, time_zone)
        values ('user-new', true, ${briefTime}, 'UTC')`;
      expect(await jobs.schedule(now)).toBe(1);
      const queued =
        await client`select user_id from notification_jobs where kind = 'brief' order by user_id`;
      expect(queued.map((row) => row.user_id)).toEqual(['user-a']);
      const stillDue =
        await client`select count(*)::int as n from user_preferences
        where morning_brief and brief_due_at <= ${now.toISOString()} and user_id <> 'user-stale'`;
      expect(stillDue[0].n).toBe(4);
      const parked =
        await client`select brief_due_at from user_preferences where user_id in ('user-stale', 'user-new')`;
      expect(parked).toHaveLength(2);
      for (const row of parked) {
        expect(new Date(row.brief_due_at).getTime()).toBeGreaterThan(
          now.getTime(),
        );
      }
      expect(await jobs.schedule(new Date())).toBe(0);
      const second =
        await client`select count(*)::int as n from notification_jobs where kind = 'brief'`;
      expect(second[0].n).toBe(2);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
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
