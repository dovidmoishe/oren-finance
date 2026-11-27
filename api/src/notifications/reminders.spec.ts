import { Logger } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  BEA_NOTICE,
  BLS_NOTICE,
} from '../market/calendar/market-calendar.copy';
import { NotificationDelivery } from './delivery';
import { NotificationJobs, type Job } from './jobs';
import { reminderEmail, type ReminderEmailFacts } from './reminder-email';
import { ReleaseReminders, ReleaseReminderScan } from './reminders';
import { NotificationUnsubscribeController } from './unsubscribe.controller';
import { NotificationWorker } from './worker';

jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));

const eventId = '0c9f6a52-4f1e-4f5e-9d3a-7b8f2f7f6a10';
const reminderId = 'c1bdb5a5-22d1-43ac-b125-c30466655829';
const env = {
  DEPLOYMENT_ENV: 'test',
  NOTIFICATION_FIXTURE_MODE: 'false',
  NOTIFICATION_APP_ORIGIN: 'https://oren.example',
  NOTIFICATION_API_ORIGIN: 'https://api.oren.example',
  NOTIFICATION_UNSUBSCRIBE_SECRET: 's'.repeat(32),
  NOTIFICATION_ALERT_MINTS: 'NVDAVuiB7hwd3m5Wa1JuHNovPaPG6BH1QNztbKFxNjv',
  NOTIFICATION_TOKENS_PER_MINUTE: '10',
  NOTIFICATION_EMAIL_PER_MINUTE: '10',
  NOTIFICATION_PILOT_USERS: 'pilot-user',
  PRICE_ALERTS_ENABLED: 'true',
  TOKENS_ALERT_TIMESTAMPS_VERIFIED: 'true',
  MORNING_BRIEF_ENABLED: 'false',
};
const saved = { ...process.env };

const cpi: ReminderEmailFacts = {
  reminderId,
  eventId,
  kind: 'cpi',
  title: 'Consumer Price Index (CPI)',
  agencyId: 'bls',
  agency: 'U.S. Bureau of Labor Statistics',
  scheduledAt: '2026-12-10T13:30:00.000Z',
  dateEt: '2026-12-10',
  timeBasis: 'published',
  referenceLabel: 'November 2026',
  sourceUrl: 'https://www.bls.gov/schedule/news_release/cpi.htm',
};

function reminderJob(): Job {
  return {
    id: 'a5b3d7e0-1c2f-4d8a-9e6b-0f1a2b3c4d5e',
    user_id: 'pilot-user',
    kind: 'reminder-email',
    attempts: 1,
    lease_token: 'lease',
    logical_key: `reminder-${reminderId}`,
    payload: { ...cpi },
  };
}

beforeEach(() => Object.assign(process.env, env));
afterEach(() => {
  process.env = { ...saved };
});

describe('release reminder requests', () => {
  function service() {
    const transaction = jest.fn().mockRejectedValue(new Error('reached db'));
    const budget = jest.fn().mockResolvedValue(true);
    const reminders = new ReleaseReminders(
      { transaction, execute: jest.fn().mockResolvedValue([]) } as never,
      { budget } as unknown as NotificationJobs,
    );
    return { reminders, transaction, budget };
  }

  it('follows the price-alert switch and pilot list', async () => {
    const { reminders, transaction } = service();
    await expect(
      reminders.create('other', true, { eventId }),
    ).rejects.toMatchObject({ status: 503 });
    process.env.PRICE_ALERTS_ENABLED = 'false';
    await expect(
      reminders.create('pilot-user', true, { eventId }),
    ).rejects.toMatchObject({ status: 503 });
    process.env.PRICE_ALERTS_ENABLED = 'true';
    process.env.PRICE_ALERTS_PUBLIC = 'true';
    await expect(reminders.create('other', true, { eventId })).rejects.toThrow(
      'reached db',
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('requires a verified email, a request budget and exactly one event id', async () => {
    const { reminders, transaction, budget } = service();
    await expect(
      reminders.create('pilot-user', false, { eventId }),
    ).rejects.toMatchObject({ status: 400 });
    for (const body of [
      undefined,
      [],
      {},
      { eventId: 'cpi:2026-12-10' },
      { eventId, extra: true },
      { eventId: 42 },
    ]) {
      await expect(
        reminders.create('pilot-user', true, body),
      ).rejects.toMatchObject({ status: 400 });
    }
    budget.mockResolvedValueOnce(false);
    await expect(
      reminders.create('pilot-user', true, { eventId }),
    ).rejects.toMatchObject({ status: 429 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('reports the feature and the email rule separately so the app can explain', async () => {
    const { reminders } = service();
    await expect(reminders.list('pilot-user', false)).resolves.toEqual({
      enabled: true,
      emailVerified: false,
      reminders: [],
    });
    await expect(reminders.list('other', true)).resolves.toMatchObject({
      enabled: false,
      emailVerified: true,
    });
  });
});

describe('release reminder email', () => {
  const app = 'https://oren.example';
  const stop = 'https://api.oren.example/stop';

  it('says when the release comes out, in New York time, with the agency and the Calendar day', () => {
    const email = reminderEmail(cpi, app, stop);
    expect(email.subject).toBe('Oren reminder · CPI inflation at 8:30 AM ET');
    expect(email.text.split('\n\n')[0]).toBe(
      'CPI inflation is released at 8:30 AM ET.',
    );
    expect(email.text).toContain(
      'Consumer Price Index (CPI), November 2026. From the U.S. Bureau of Labor Statistics on Thursday, December 10.',
    );
    expect(email.text).toContain(
      'See the day in Oren: https://oren.example/app/calendar?date=2026-12-10',
    );
    expect(email.text).toContain(
      'Agency schedule: https://www.bls.gov/schedule/news_release/cpi.htm',
    );
    expect(email.text).toContain(BLS_NOTICE);
    expect(email.text).not.toContain(BEA_NOTICE);
    expect(email.text).toContain(`Stop release reminder emails: ${stop}`);
  });

  it('stays plain: no em dashes, hype, forecasts or narrow spaces', () => {
    const fomc = reminderEmail(
      {
        ...cpi,
        kind: 'fomc_decision',
        title: 'FOMC rate decision',
        agencyId: 'frb',
        agency: 'Federal Reserve Board',
        scheduledAt: '2026-12-09T19:00:00.000Z',
        dateEt: '2026-12-09',
        timeBasis: 'customary',
        referenceLabel: null,
        sourceUrl: 'http://insecure.example/schedule',
      },
      app,
      stop,
    );
    expect(fomc.text.split('\n\n')[0]).toBe(
      'The Fed rate decision is usually announced at 2:00 PM ET.',
    );
    expect(fomc.text).toContain(
      'FOMC rate decision. From the Federal Reserve Board on Wednesday, December 9.',
    );
    expect(fomc.text).not.toContain('insecure.example');
    const claims = reminderEmail(
      { ...cpi, kind: 'jobless_claims', title: 'Initial jobless claims' },
      app,
      stop,
    );
    expect(claims.text).toMatch(/^Jobless claims are released at 8:30 AM ET\./);
    for (const { subject, text } of [
      reminderEmail(cpi, app, stop),
      fomc,
      claims,
    ]) {
      const body = `${subject}\n${text}`;
      expect(body).not.toMatch(/[\u2014\u202f]/);
      expect(body).not.toMatch(
        /!|instant|real-time|live|don't miss|consensus|forecast/i,
      );
    }
  });
});

describe('release reminder delivery', () => {
  function harness() {
    const sendEmail = jest.fn().mockResolvedValue({ id: 'provider-1' });
    const update = jest.fn().mockResolvedValue(undefined);
    const budget = jest.fn().mockResolvedValue(true);
    const handoff = jest.fn().mockResolvedValue(true);
    const delivery = new NotificationDelivery(
      {
        update,
        budget,
        handoff,
        defer: jest.fn(),
        pending: jest.fn().mockResolvedValue([]),
      } as never,
      {
        getNotificationIdentity: jest
          .fn()
          .mockResolvedValue({ email: 'reader@example.com', wallet: null }),
      } as never,
      { sendEmail },
    );
    return { delivery, sendEmail, update, budget, handoff };
  }

  it('sends through the alert path without a mint check', async () => {
    const { delivery, sendEmail, update, handoff } = harness();
    const job = reminderJob();
    await delivery.send(job);
    expect(handoff).toHaveBeenCalledWith(job);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [message] = sendEmail.mock.calls[0] as [
      { to: string; subject: string; text: string },
    ];
    expect(message.to).toBe('reader@example.com');
    expect(message.subject).toBe('Oren reminder · CPI inflation at 8:30 AM ET');
    expect(message.text).toContain(
      'https://oren.example/app/calendar?date=2026-12-10',
    );
    expect(message.text).toMatch(
      /Stop release reminder emails: https:\/\/api\.oren\.example\/api\/notifications\/unsubscribe\//,
    );
    expect(update).toHaveBeenCalledWith(job, 'accepted', 'provider-1');
  });

  it('cancels when alerts are off or the account is outside the pilot', async () => {
    for (const change of [
      { PRICE_ALERTS_ENABLED: 'false' },
      { NOTIFICATION_PILOT_USERS: 'someone-else' },
    ]) {
      Object.assign(process.env, env, change);
      const { delivery, sendEmail, update, budget } = harness();
      const job = reminderJob();
      await delivery.send(job);
      expect(update).toHaveBeenCalledWith(job, 'canceled');
      expect(budget).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
    }
  });

  it('cancels instead of sending when the handoff finds the release moved or out', async () => {
    const { delivery, sendEmail, update, handoff } = harness();
    handoff.mockResolvedValueOnce(false);
    const job = reminderJob();
    await delivery.send(job);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(job, 'canceled');
  });

  it('hands off only while the release is still scheduled for the queued time', async () => {
    const queries: SQL[] = [];
    const jobs = new NotificationJobs({
      execute: (query: SQL) => {
        queries.push(query);
        return Promise.resolve([{ id: 'job' }]);
      },
    } as never);
    await expect(jobs.handoff(reminderJob())).resolves.toBe(true);
    const compiled = new PgDialect().sqlToQuery(queries[0]);
    expect(compiled.sql).toContain(
      'from release_reminders r join market_events e',
    );
    expect(compiled.sql).toContain("r.state = 'sent'");
    expect(compiled.sql).toContain("e.date_status = 'scheduled'");
    expect(compiled.sql).toContain('e.scheduled_at > now()');
    expect(compiled.params).toEqual(
      expect.arrayContaining([reminderId, cpi.scheduledAt, 'pilot-user']),
    );
  });

  it('names release reminders on the unsubscribe page', async () => {
    const controller = new NotificationUnsubscribeController({
      subscription: jest.fn().mockResolvedValue('reminder-email'),
    } as never);
    await expect(controller.confirm('token')).resolves.toContain(
      'Stop release reminder emails?',
    );
    await expect(controller.stop('token')).resolves.toContain(
      'Oren will stop sending release reminder emails.',
    );
  });
});

describe('release reminder worker', () => {
  function worker(scan: jest.Mock) {
    const jobs = {
      schedule: jest.fn().mockResolvedValue(0),
      sweep: jest.fn().mockResolvedValue(0),
      pending: jest.fn().mockResolvedValue([]),
      db: { execute: jest.fn().mockResolvedValue([{ pending: 0, lag: 0 }]) },
    };
    const running = new NotificationWorker(
      jobs as never,
      {} as never,
      {} as never,
      {} as never,
      { scan } as unknown as ReleaseReminderScan,
    );
    jest
      .spyOn((running as unknown as { logger: Logger }).logger, 'log')
      .mockImplementation(() => undefined);
    const warn = jest
      .spyOn((running as unknown as { logger: Logger }).logger, 'warn')
      .mockImplementation(() => undefined);
    const dispatch = () =>
      (running as unknown as { dispatch(): Promise<void> }).dispatch();
    return { dispatch, jobs, warn };
  }

  it('scans once a minute with price alerts and keeps dispatching when a scan fails', async () => {
    const scan = jest.fn().mockRejectedValue(new Error('db down'));
    const { dispatch, jobs, warn } = worker(scan);
    await expect(dispatch()).resolves.toBeUndefined();
    expect(scan).toHaveBeenCalledWith(expect.any(Date));
    expect(warn).toHaveBeenCalledWith('Release reminder scan will retry');
    expect(jobs.db.execute).toHaveBeenCalled();
    expect(jobs.pending).not.toHaveBeenCalled();

    process.env.PRICE_ALERTS_ENABLED = 'false';
    const off = worker(jest.fn());
    await off.dispatch();
    expect(off.jobs.sweep).toHaveBeenCalled();
  });

  it('does not scan while price alerts are off', async () => {
    process.env.PRICE_ALERTS_ENABLED = 'false';
    const scan = jest.fn();
    await worker(scan).dispatch();
    expect(scan).not.toHaveBeenCalled();
    const transaction = jest.fn();
    await new ReleaseReminderScan({ db: { transaction } } as never).scan();
    expect(transaction).not.toHaveBeenCalled();
  });
});
