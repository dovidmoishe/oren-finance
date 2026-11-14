import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { TokensService } from '../tokens/tokens.service';
import { PriceAlerts, PricePolling } from './alerts';
import { NotificationJobs } from './jobs';

const pgUrl = process.env.MCP_TEST_POSTGRES_URL;
const run = pgUrl ? describe : describe.skip;
const mint = 'NVDAVuiB7hwd3m5Wa1JuHNovPaPG6BH1QNztbKFxNjv';
const user = 'did:privy:fixture';
const env = {
  DEPLOYMENT_ENV: 'preview',
  NOTIFICATION_FIXTURE_MODE: 'true',
  NOTIFICATION_FIXTURE_RECIPIENT: 'fixture@example.test',
  NOTIFICATION_APP_ORIGIN: 'https://preview.example.test',
  NOTIFICATION_UNSUBSCRIBE_SECRET: 'test-only'.repeat(4),
  NOTIFICATION_PILOT_USERS: user,
  NOTIFICATION_EMAIL_PER_MINUTE: '20',
  NOTIFICATION_TOKENS_PER_MINUTE: '20',
  PRICE_ALERTS_ENABLED: 'true',
  TOKENS_ALERT_TIMESTAMPS_VERIFIED: 'true',
  NOTIFICATION_ALERT_MINTS: mint,
};
type Row = {
  direction: string;
  target: string;
  state: string;
  quote_price: string | null;
};
let price = 100;
const tokens = {
  getMarketSnapshots: jest.fn(() =>
    Promise.resolve([
      {
        mint,
        price,
        providerFetchedAt: Date.now() - 1000,
        lastTradeAt: Date.now() - 2000,
      },
    ]),
  ),
} as unknown as TokensService;

run('price alert life cycle with disposable Postgres', () => {
  const saved = { ...process.env };
  const ns = `lifecycle_${randomUUID().replaceAll('-', '')}`;
  let admin: ReturnType<typeof postgres>, client: ReturnType<typeof postgres>;
  let jobs: NotificationJobs, alerts: PriceAlerts, polling: PricePolling;
  const body = (direction: string, target: string) => ({
    assetId: 'nvda',
    mint,
    direction,
    target,
  });
  const scan = async () => {
    await client`truncate notification_budgets, price_poll_cursor`;
    await polling.scan();
  };
  const rows = () =>
    client<
      Row[]
    >`select direction, target::text, state, quote_price::text from price_alerts order by target`;

  beforeAll(async () => {
    if (new URL(pgUrl!).hostname !== '127.0.0.1')
      throw new Error('Use a disposable local test database');
    Object.assign(process.env, env);
    admin = postgres(pgUrl!);
    await admin`create schema ${admin(ns)}`;
    client = postgres(pgUrl!, { connection: { search_path: ns } });
    await client.unsafe(`create table cached_stocks (asset_id text, ticker text, category text, expires_at timestamptz);
      create table user_preferences (user_id text primary key, sectors text[], morning_brief boolean, breaking_news boolean, brief_time text, time_zone text);`);
    for (const f of ['0019_notifications', '0020_price_alert_failed'])
      await client.unsafe(await readFile(`lib/db/migrations/${f}.sql`, 'utf8'));
    await client`insert into cached_stocks values ('nvda','NVDA','equity',now()+interval '1 hour',
      ${client.unsafe(`'${JSON.stringify([{ mint, symbol: 'NVDAx' }])}'::jsonb`)})`;
    jobs = new NotificationJobs(drizzle(client) as never);
    alerts = new PriceAlerts(jobs.db, jobs, tokens);
    polling = new PricePolling(jobs, tokens);
  }, 30000);
  afterAll(async () => {
    if (client) await client.end();
    if (admin) {
      await admin`drop schema ${admin(ns)} cascade`;
      await admin.end();
    }
    for (const key of Object.keys(env)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('walks the whole alert life cycle', async () => {
    price = 100;
    // already-met targets are refused, others accepted
    await expect(
      alerts.create(user, true, body('above', '90')),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      alerts.create(user, true, body('below', '110')),
    ).rejects.toMatchObject({ status: 400 });
    await alerts.create(user, true, body('above', '120'));
    await alerts.create(user, true, body('below', '80'));
    await alerts.create(user, true, body('above', '150'));
    await client`update price_alerts set created_at = now() - interval '1 day'`;

    await scan(); // baseline at 100, nothing fires
    expect((await rows()).map((r) => r.state)).toEqual([
      'active',
      'active',
      'active',
    ]);

    // a 6 hour gap (overnight) then a jump to 130: must fire "above 120" only
    await client`update price_alerts set quote_at = now() - interval '6 hours'`;
    price = 130;
    await scan();
    const after = await rows();
    expect(after.find((r) => r.target === '120.00000000')!.state).toBe(
      'triggered',
    );
    expect(after.find((r) => r.target === '150.00000000')!.state).toBe(
      'active',
    );
    expect(after.find((r) => r.target === '80.00000000')!.state).toBe('active');
    const queued =
      await client`select kind, state, payload->>'price' as price from notification_jobs`;
    expect(queued).toHaveLength(1);

    // it must not fire again
    await scan();
    await scan();
    expect(await client`select 1 from notification_jobs`).toHaveLength(1);

    // price drops: "below 80" fires; the triggered one stays triggered
    price = 70;
    await client`update price_alerts set quote_at = now() - interval '2 minutes' where state = 'active'`;
    await scan();
    expect((await rows()).find((r) => r.target === '80.00000000')!.state).toBe(
      'triggered',
    );
    expect(await client`select 1 from notification_jobs`).toHaveLength(2);

    // email permanently fails -> alert becomes failed, other alert stays triggered
    await client`update notification_jobs set state = 'failed' where payload->>'direction' = 'above'`;
    await jobs.sweep();
    const states = Object.fromEntries(
      (await rows()).map((r) => [r.target, r.state]),
    );
    expect(states['120.00000000']).toBe('failed');
    expect(states['80.00000000']).toBe('triggered');

    // user cancels the failed one and the triggered one: both canceled, stay canceled after sweep
    const list = await alerts.list(user, true, 'nvda');
    expect(list.alerts.map((a) => a.state).sort()).toEqual([
      'active',
      'failed',
      'triggered',
    ]);
    await alerts.cancelRules(user);
    await jobs.sweep();
    expect((await rows()).every((r) => r.state === 'canceled')).toBe(true);
  }, 60000);

  it('evaluates every user while alerts are public and only the pilot otherwise', async () => {
    await client`truncate price_alerts, notification_jobs, notification_budgets, price_poll_cursor`;
    const outsider = 'did:privy:public';
    process.env.PRICE_ALERTS_PUBLIC = 'true';
    try {
      price = 100;
      const created = await alerts.create(outsider, true, body('above', '120'));
      expect(created.target).toBe('120.00');
      await client`update price_alerts set created_at = now() - interval '1 day',
        quote_at = now() - interval '6 hours', quote_price = 100 where user_id = ${outsider}`;
      price = 130;
      await scan();
      const [fired] =
        await client`select state from price_alerts where user_id = ${outsider}`;
      expect(fired.state).toBe('triggered');

      delete process.env.PRICE_ALERTS_PUBLIC;
      await client`truncate price_alerts, notification_jobs, notification_budgets, price_poll_cursor`;
      await client`insert into price_alerts
        (user_id, asset_id, ticker, variant, mint, direction, target, created_at, quote_at, quote_price)
        values (${outsider}, 'nvda', 'NVDA', 'NVDAx', ${mint}, 'above', 110,
          now() - interval '1 day', now() - interval '6 hours', 100)`;
      price = 100;
      await alerts.create(user, true, body('above', '140'));
      await client`update price_alerts set created_at = now() - interval '1 day',
        quote_at = now() - interval '6 hours', quote_price = 100 where user_id = ${user}`;
      price = 150;
      await scan();
      const states = await client<
        { user_id: string; state: string }[]
      >`select user_id, state from price_alerts`;
      expect(states.find((row) => row.user_id === outsider)?.state).toBe(
        'active',
      );
      expect(states.find((row) => row.user_id === user)?.state).toBe(
        'triggered',
      );
      const queued =
        await client`select user_id from notification_jobs where kind = 'alert-email'`;
      expect(queued).toEqual([{ user_id: user }]);
    } finally {
      delete process.env.PRICE_ALERTS_PUBLIC;
    }
  }, 60000);

  it('offers and fires alerts on any stock, even with expired catalog rows and a quiet market', async () => {
    const other = 'So11111111111111111111111111111111111111112';
    await client`truncate price_alerts, notification_jobs, notification_budgets, price_poll_cursor`;
    await client`delete from cached_stocks where asset_id = 'thin'`;
    await client`update cached_stocks set expires_at = now() - interval '2 hours'`;
    await client.unsafe(`insert into cached_stocks values
      ('thin','THIN','equity',now()-interval '2 hours','[{"mint":"${other}","symbol":"THINx"}]'::jsonb)`);
    // Last trades five minutes old: ignored by default, accepted with a 10 minute window.
    const quiet = {
      getMarketSnapshots: jest.fn((mints: string[]) =>
        Promise.resolve(
          mints.map((m) => ({
            mint: m,
            price,
            providerFetchedAt: Date.now() - 1000,
            lastTradeAt: Date.now() - 300000,
          })),
        ),
      ),
    } as unknown as TokensService;
    const anyStock = new PriceAlerts(jobs.db, jobs, quiet);
    const anyPolling = new PricePolling(jobs, quiet);
    process.env.NOTIFICATION_ALERT_MINTS = '*';
    process.env.NOTIFICATION_QUOTE_MAX_TRADE_AGE_SECONDS = '600';
    try {
      price = 100;
      for (const [assetId, m] of [
        ['nvda', mint],
        ['thin', other],
      ]) {
        const list = await anyStock.list(user, true, assetId);
        expect(list).toMatchObject({ enabled: true, variants: [m] });
        await anyStock.create(user, true, {
          assetId,
          mint: m,
          direction: 'above',
          target: '120',
        });
      }
      await client`update price_alerts set created_at = now() - interval '1 day',
        quote_at = now() - interval '6 hours', quote_price = 100`;
      price = 130;
      await client`truncate notification_budgets, price_poll_cursor`;
      await anyPolling.scan();
      const states = await client<
        { state: string }[]
      >`select state from price_alerts`;
      expect(states.map((r) => r.state)).toEqual(['triggered', 'triggered']);
      expect(await client`select 1 from notification_jobs`).toHaveLength(2);
    } finally {
      process.env.NOTIFICATION_ALERT_MINTS = mint;
      delete process.env.NOTIFICATION_QUOTE_MAX_TRADE_AGE_SECONDS;
      await client`delete from cached_stocks where asset_id = 'thin'`;
      await client`update cached_stocks set expires_at = now() + interval '1 hour'`;
    }
  }, 60000);
});
