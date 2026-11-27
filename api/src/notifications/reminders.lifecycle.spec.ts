import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { MarketEventsRepository } from '../market/calendar/market-events.repository';
import { releaseSpec } from '../market/calendar/macro-catalog';
import { releaseRow } from '../market/calendar/market-events.sync';
import { NotificationDelivery, unsubscribeToken } from './delivery';
import { NotificationJobs } from './jobs';
import {
  MAX_ACTIVE_REMINDERS,
  ReleaseReminders,
  ReleaseReminderScan,
} from './reminders';

jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));

const pgUrl = process.env.MCP_TEST_POSTGRES_URL;
const run = pgUrl ? describe : describe.skip;
const user = 'did:privy:fixture';
const secret = 'test-only'.repeat(4);
const env = {
  DEPLOYMENT_ENV: 'preview',
  NOTIFICATION_FIXTURE_MODE: 'true',
  NOTIFICATION_FIXTURE_RECIPIENT: 'fixture@example.test',
  NOTIFICATION_APP_ORIGIN: 'https://preview.example.test',
  NOTIFICATION_UNSUBSCRIBE_SECRET: secret,
  NOTIFICATION_PILOT_USERS: user,
  NOTIFICATION_EMAIL_PER_MINUTE: '20',
  NOTIFICATION_TOKENS_PER_MINUTE: '20',
  PRICE_ALERTS_ENABLED: 'true',
  TOKENS_ALERT_TIMESTAMPS_VERIFIED: 'true',
  NOTIFICATION_ALERT_MINTS: 'NVDAVuiB7hwd3m5Wa1JuHNovPaPG6BH1QNztbKFxNjv',
};
const MINUTE = 60_000;

run('release reminder life cycle with disposable Postgres', () => {
  const saved = { ...process.env };
  const ns = `reminders_${randomUUID().replaceAll('-', '')}`;
  let admin: ReturnType<typeof postgres>, client: ReturnType<typeof postgres>;
  let jobs: NotificationJobs;
  let reminders: ReleaseReminders;
  let scan: ReleaseReminderScan;
  let delivery: NotificationDelivery;

  /** One official release, `minutes` from the database clock. */
  async function release(
    minutes: number,
    extra: { status?: string; precision?: string; kind?: string } = {},
  ) {
    const raw = {
      agencyId: 'bls',
      agency: 'U.S. Bureau of Labor Statistics',
      timeBasis: 'published',
      referenceLabel: 'November 2026',
    };
    const [row] = await client<{ id: string }[]>`
      insert into market_events (kind, title, scheduled_at, time_precision, date_status,
        source, source_event_id, source_url, raw)
      values (${extra.kind ?? 'cpi'}, 'Consumer Price Index (CPI)',
        date_trunc('second', now()) + make_interval(mins => ${minutes}),
        ${extra.precision ?? 'datetime'},
        ${extra.status ?? 'scheduled'}, 'bls', ${randomUUID()},
        'https://www.bls.gov/schedule/news_release/cpi.htm',
        ${JSON.stringify(raw)}::jsonb)
      returning id`;
    return row.id;
  }
  const move = (id: string, minutes: number) =>
    client`update market_events
      set scheduled_at = date_trunc('second', now()) + make_interval(mins => ${minutes})
      where id = ${id}`;
  const later = (minutes: number) => new Date(Date.now() + minutes * MINUTE);
  const state = async (id: string) =>
    (
      await client<
        { state: string }[]
      >`select state from release_reminders where id = ${id}`
    )[0]?.state;
  const queued = () =>
    client<
      { id: string; state: string; logical_key: string; scheduled: string }[]
    >`select id, state, logical_key, payload->>'scheduledAt' as scheduled
      from notification_jobs where kind = 'reminder-email' order by updated_at`;
  // drizzle(client) leaves timestamps as driver strings, so format in SQL.
  const scheduledAt = async (id: string) =>
    (
      await client<{ at: string }[]>`
        select to_char(scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at
        from market_events where id = ${id}`
    )[0].at;

  beforeAll(async () => {
    if (new URL(pgUrl!).hostname !== '127.0.0.1')
      throw new Error('Use a disposable local test database');
    Object.assign(process.env, env);
    admin = postgres(pgUrl!);
    await admin`create schema ${admin(ns)}`;
    client = postgres(pgUrl!, {
      connection: { search_path: ns },
      onnotice: () => undefined,
    });
    await client.unsafe(`create table cached_stocks (asset_id text, ticker text, category text, expires_at timestamptz);
      create table user_preferences (user_id text primary key, sectors text[], morning_brief boolean, breaking_news boolean, brief_time text, time_zone text);`);
    for (const f of [
      '0019_notifications',
      '0022_notification_job_send_errors',
      '0028_market_events',
      '0029_release_reminders',
    ])
      await client.unsafe(await readFile(`lib/db/migrations/${f}.sql`, 'utf8'));
    jobs = new NotificationJobs(drizzle(client) as never);
    reminders = new ReleaseReminders(jobs.db, jobs);
    scan = new ReleaseReminderScan(jobs);
    delivery = new NotificationDelivery(
      jobs,
      {
        getNotificationIdentity: () =>
          Promise.resolve({ email: env.NOTIFICATION_FIXTURE_RECIPIENT }),
      } as unknown as PrivyWalletAuth,
      { sendEmail: jest.fn() },
    );
  }, 30_000);
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
  beforeEach(async () => {
    delete process.env.PRICE_ALERTS_PUBLIC;
    await client`truncate release_reminders, notification_jobs, notification_budgets, market_events cascade`;
  });

  it('preserves a subscribed event through the identity migration and an agency reschedule', async () => {
    const repository = new MarketEventsRepository(jobs.db);
    const reference = { period: '2026-11', label: 'November 2026' };
    const spec = releaseSpec('cpi')!;
    const oldTime = later(24 * 60);
    const oldDate = oldTime.toISOString().slice(0, 10);
    const old = releaseRow(spec, oldDate, reference, oldTime);
    await repository.upsertSchedule([
      { ...old, sourceEventId: `cpi:${oldDate}` },
    ]);
    const [{ id: eventId }] = await client<
      { id: string }[]
    >`select id from market_events`;
    const reminder = await reminders.create(user, true, { eventId });

    await client.unsafe(
      await readFile(
        'lib/db/migrations/0030_market_release_identity.sql',
        'utf8',
      ),
    );
    const newTime = later(3 * 24 * 60);
    const moved = releaseRow(
      spec,
      newTime.toISOString().slice(0, 10),
      reference,
      newTime,
    );
    await repository.upsertSchedule([moved]);
    expect(await client`select id from market_events`).toEqual([
      { id: eventId },
    ]);
    expect((await reminders.list(user, true)).reminders).toEqual([
      {
        id: reminder.id,
        eventId,
        remindAt: new Date(+newTime - 15 * MINUTE).toISOString(),
      },
    ]);
    await scan.scan(new Date(+oldTime - 15 * MINUTE));
    expect(await queued()).toHaveLength(0);
    await scan.scan(new Date(+newTime - 15 * MINUTE));
    expect(await queued()).toMatchObject([
      { scheduled: newTime.toISOString() },
    ]);
  });

  it('reopens a stored stale GDP revision while retaining a verified release', async () => {
    await client`insert into market_events
      (kind, title, scheduled_at, time_precision, date_status, source, source_event_id, source_url, actual, raw)
      select 'gdp','GDP', published::timestamptz,'datetime','released','bea','gdp:' || published,
        'https://www.bea.gov/', 4.3, jsonb_build_object('dateEt',published,'estimate',estimate,
        'referencePeriod','2026-Q3','result',jsonb_build_object('lastRevised','2026-11-25'))
      from (values ('2026-11-25','second'), ('2026-12-23','third')) dates(published,estimate)`;
    await client.unsafe(
      await readFile(
        'lib/db/migrations/0030_market_release_identity.sql',
        'utf8',
      ),
    );
    const rows =
      await client`select source_event_id, date_status, actual, raw ? 'result' as has_result
      from market_events order by scheduled_at`;
    expect(rows).toEqual([
      {
        source_event_id: 'gdp:period:2026-Q3:second',
        date_status: 'released',
        actual: '4.3',
        has_result: true,
      },
      {
        source_event_id: 'gdp:period:2026-Q3:third',
        date_status: 'scheduled',
        actual: null,
        has_result: false,
      },
    ]);
  });

  it('validates the release, stays idempotent, caps active reminders and cancels', async () => {
    const missing = randomUUID();
    await expect(
      reminders.create(user, true, { eventId: missing }),
    ).rejects.toMatchObject({ status: 404 });
    for (const eventId of [
      await release(60, { status: 'cancelled' }),
      await release(60, { status: 'released' }),
      await release(-5),
      await release(60, { precision: 'date' }),
    ]) {
      await expect(
        reminders.create(user, true, { eventId }),
      ).rejects.toMatchObject({ status: 400 });
    }

    const eventId = await release(60);
    const [first, second] = await Promise.all([
      reminders.create(user, true, { eventId }),
      reminders.create(user, true, { eventId }),
    ]);
    expect(second).toEqual(first);
    expect(first.eventId).toBe(eventId);
    expect(new Date(first.remindAt).getTime()).toBe(
      new Date(await scheduledAt(eventId)).getTime() - 15 * MINUTE,
    );
    await expect(reminders.list(user, true)).resolves.toEqual({
      enabled: true,
      emailVerified: true,
      reminders: [first],
    });
    expect(
      await client`select 1 from release_reminders where user_id = ${user}`,
    ).toHaveLength(1);

    // Fill the cap with other upcoming releases, then one more is refused.
    await client`insert into market_events (kind, title, scheduled_at, time_precision, source, source_event_id, source_url)
      select 'cpi', 'CPI', now() + n * interval '1 day', 'datetime', 'bls', 'cap:' || n, 'https://www.bls.gov/'
      from generate_series(1, ${MAX_ACTIVE_REMINDERS}) n`;
    await client`insert into release_reminders (user_id, event_id)
      select ${user}, id from market_events where source_event_id like 'cap:%'
      order by scheduled_at limit ${MAX_ACTIVE_REMINDERS - 1}`;
    const extra = (
      await client<
        { id: string }[]
      >`select id from market_events where source_event_id = ${`cap:${MAX_ACTIVE_REMINDERS}`}`
    )[0].id;
    await expect(
      reminders.create(user, true, { eventId: extra }),
    ).rejects.toMatchObject({ status: 409 });
    // A repeat of a reminder that is already on is still fine at the cap.
    await expect(reminders.create(user, true, { eventId })).resolves.toEqual(
      first,
    );

    await reminders.cancel(user, first.id);
    expect(await state(first.id)).toBe('canceled');
    expect((await reminders.list(user, true)).reminders).not.toContainEqual(
      first,
    );
    const again = await reminders.create(user, true, { eventId });
    expect(again.id).not.toBe(first.id);
    await expect(
      reminders.create(user, true, { eventId: extra }),
    ).rejects.toMatchObject({ status: 409 });
  }, 60_000);

  it('queues 15 minutes before the current time and follows a moved release', async () => {
    const eventId = await release(30);
    const reminder = await reminders.create(user, true, { eventId });

    await scan.scan();
    expect(await queued()).toHaveLength(0);

    // Rescheduled to three hours out before the original reminder time.
    await move(eventId, 180);
    await scan.scan(later(16));
    expect(await queued()).toHaveLength(0);
    expect(await state(reminder.id)).toBe('active');
    const [listed] = (await reminders.list(user, true)).reminders;
    expect(new Date(listed.remindAt).getTime()).toBe(
      new Date(await scheduledAt(eventId)).getTime() - 15 * MINUTE,
    );

    await scan.scan(later(164));
    expect(await queued()).toHaveLength(0);
    await scan.scan(later(166));
    const [job] = await queued();
    expect(job).toMatchObject({
      state: 'pending',
      logical_key: `reminder-${reminder.id}`,
      scheduled: await scheduledAt(eventId),
    });
    expect(await state(reminder.id)).toBe('sent');
    // Still shown as on until the release is out, and never queued twice.
    expect((await reminders.list(user, true)).reminders).toHaveLength(1);
    await scan.scan(later(167));
    expect(await queued()).toHaveLength(1);

    const claimed = await jobs.claim(job.id, 'reminder-email');
    await delivery.send(claimed!);
    expect((await queued())[0].state).toBe('accepted');
    expect(await state(reminder.id)).toBe('sent');
  }, 60_000);

  it('waits again when a release moves after its email was queued', async () => {
    const eventId = await release(10);
    const reminder = await reminders.create(user, true, { eventId });
    await scan.scan();
    const [job] = await queued();
    expect(job.state).toBe('pending');

    await move(eventId, 120);
    await delivery.send((await jobs.claim(job.id, 'reminder-email'))!);
    expect((await queued())[0].state).toBe('canceled');

    await scan.scan();
    expect(await state(reminder.id)).toBe('active');
    expect((await queued())[0].state).toBe('canceled');

    await scan.scan(later(110));
    const [requeued] = await queued();
    expect(requeued).toMatchObject({
      id: job.id,
      state: 'pending',
      scheduled: await scheduledAt(eventId),
    });
    expect(await state(reminder.id)).toBe('sent');
  }, 60_000);

  it('moves a reminder earlier with its release', async () => {
    const eventId = await release(300);
    const reminder = await reminders.create(user, true, { eventId });
    await move(eventId, 12);
    await scan.scan();
    expect(await queued()).toHaveLength(1);
    expect(await state(reminder.id)).toBe('sent');
  }, 30_000);

  it('cancels with a cancelled release and fails a missed or undelivered one', async () => {
    const cancelled = await release(10);
    const missed = await release(60);
    const undelivered = await release(5);
    const [a, b, c] = await Promise.all(
      [cancelled, missed, undelivered].map((eventId) =>
        reminders.create(user, true, { eventId }),
      ),
    );
    await scan.scan();
    expect(await queued()).toHaveLength(2);

    await client`update market_events set date_status = 'cancelled' where id = ${cancelled}`;
    await move(missed, -1);
    await client`update notification_jobs set state = 'failed' where logical_key = ${`reminder-${c.id}`}`;
    await scan.scan();
    expect(await state(a.id)).toBe('canceled');
    expect(await state(b.id)).toBe('failed');
    expect(await state(c.id)).toBe('failed');
    const jobStates = Object.fromEntries(
      (await queued()).map((row) => [row.logical_key, row.state]),
    );
    expect(jobStates[`reminder-${a.id}`]).toBe('canceled');
    expect((await reminders.list(user, true)).reminders).toEqual([]);
  }, 30_000);

  it('queues only pilot accounts until alerts are public, and unsubscribes every reminder', async () => {
    const outsider = 'did:privy:outsider';
    const eventId = await release(10);
    const farOff = await release(600);
    await client`insert into release_reminders (user_id, event_id) values (${outsider}, ${eventId})`;
    await reminders.create(user, true, { eventId });
    const kept = await reminders.create(user, true, { eventId: farOff });
    await scan.scan();
    const pilotOnly = await client<
      { user_id: string }[]
    >`select user_id from notification_jobs`;
    expect(pilotOnly).toEqual([{ user_id: user }]);

    process.env.PRICE_ALERTS_PUBLIC = 'true';
    await scan.scan();
    expect(await client`select 1 from notification_jobs`).toHaveLength(2);

    const [job] = await client<
      { id: string }[]
    >`select id from notification_jobs where user_id = ${user}`;
    expect(
      await delivery.subscription(unsubscribeToken(job.id, secret), true),
    ).toBe('reminder-email');
    expect(await state(kept.id)).toBe('canceled');
    expect(
      await client`select 1 from release_reminders where user_id = ${user} and state <> 'canceled'`,
    ).toHaveLength(0);
    expect(
      await client`select 1 from notification_jobs where user_id = ${user} and state = 'pending'`,
    ).toHaveLength(0);
  }, 30_000);
});
