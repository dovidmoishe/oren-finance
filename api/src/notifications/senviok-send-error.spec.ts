import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { NotificationDelivery } from './delivery';
import { NotificationJobs, type Job } from './jobs';
import { redactSendError, type SenviokSendFailure } from './senviok-error';
import { NotificationWorker, senviokConfigSummary } from './worker';

jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));

const apiKey = 'svk_live_TESTKEYVALUE123';
const recipient = 'alerts-user@example.com';
const mint = 'NVDAVuiB7hwd3m5Wa1JuHNovPaPG6BH1QNztbKFxNjv';
const savedEnv = { ...process.env };

function alertJob(): Job {
  return {
    id: 'c1bdb5a5-22d1-43ac-b125-c30466655829',
    user_id: 'pilot-user',
    kind: 'alert-email',
    attempts: 1,
    lease_token: 'lease',
    logical_key: 'alert-1',
    payload: {
      mint,
      ticker: 'NVDA',
      variant: 'NVDAx',
      price: 130.5,
      quoteAt: '2026-11-14T15:00:00.000Z',
      direction: 'above',
      target: '120.00000000',
      assetId: 'nvda',
      alertId: 'alert-id',
    },
  };
}

function enableAlerts() {
  Object.assign(process.env, {
    DEPLOYMENT_ENV: 'test',
    NOTIFICATION_FIXTURE_MODE: 'false',
    NOTIFICATION_APP_ORIGIN: 'https://oren.example',
    NOTIFICATION_API_ORIGIN: 'https://api.oren.example',
    NOTIFICATION_UNSUBSCRIBE_SECRET: 's'.repeat(32),
    NOTIFICATION_ALERT_MINTS: mint,
    NOTIFICATION_TOKENS_PER_MINUTE: '10',
    NOTIFICATION_EMAIL_PER_MINUTE: '10',
    PRICE_ALERTS_ENABLED: 'true',
    PRICE_ALERTS_PUBLIC: 'true',
    TOKENS_ALERT_TIMESTAMPS_VERIFIED: 'true',
    MORNING_BRIEF_ENABLED: 'false',
    SENVIOK_API_KEY: apiKey,
    SENVIOK_FROM: 'updates@oren.finance',
  });
}

function providerError(status: number, body: unknown) {
  return Object.assign(new Error('provider error'), { status, body });
}

function recorded(value: SenviokSendFailure | undefined): SenviokSendFailure {
  if (!value) throw new Error('expected a recorded Senviok failure');
  return value;
}

function harness(sendEmail: jest.Mock) {
  const failSend = jest
    .fn<Promise<void>, [Job, SenviokSendFailure]>()
    .mockResolvedValue(undefined);
  const retry = jest
    .fn<Promise<void>, [Job, boolean, SenviokSendFailure?]>()
    .mockResolvedValue(undefined);
  const update = jest
    .fn<
      Promise<void>,
      [
        Job,
        'complete' | 'canceled' | 'uncertain' | 'accepted',
        string | undefined,
        SenviokSendFailure?,
      ]
    >()
    .mockResolvedValue(undefined);
  const delivery = new NotificationDelivery(
    {
      update,
      failSend,
      retry,
      budget: jest.fn().mockResolvedValue(true),
      defer: jest.fn(),
      pending: jest.fn().mockResolvedValue([]),
      handoff: jest.fn().mockResolvedValue(true),
    } as never,
    {
      getNotificationIdentity: jest
        .fn()
        .mockResolvedValue({ email: recipient, wallet: null }),
    } as never,
    { sendEmail },
  );
  const warn = jest
    .spyOn((delivery as unknown as { logger: Logger }).logger, 'warn')
    .mockImplementation(() => undefined);
  return { delivery, failSend, retry, update, warn };
}

function leakText(...values: unknown[]) {
  return JSON.stringify(values);
}

function expectNoSecrets(text: string) {
  expect(text).not.toContain(apiKey);
  expect(text).not.toContain('svk_');
  expect(text).not.toContain('TESTKEYVALUE123');
  expect(text).not.toContain(recipient);
  expect(text).not.toContain('alerts-user');
  expect(text).not.toContain('updates@oren.finance');
  expect(text).not.toContain('mailbox.secret');
}

describe('Senviok send failures', () => {
  beforeEach(() => {
    enableAlerts();
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('redacts keys and emails before truncating', () => {
    const email = 'mailbox.secret@example.com';
    const text = redactSendError(
      `${'n'.repeat(290)}${email} Bearer ${apiKey}`,
      [recipient],
    );
    expect(text.length).toBeLessThanOrEqual(300);
    expectNoSecrets(text);
    expect(text).not.toContain(email);
  });

  it('records a redacted 401 and fails the job once', async () => {
    const sendEmail = jest.fn().mockRejectedValue(
      providerError(401, {
        code: 'unauthorized',
        message: `API key ${apiKey} rejected for ${recipient}`,
      }),
    );
    const { delivery, failSend, retry, update, warn } = harness(sendEmail);
    const job = alertJob();
    await delivery.send(job);

    expect(failSend).toHaveBeenCalledTimes(1);
    const failure = recorded(failSend.mock.calls[0][1]);
    expect(failure.status).toBe(401);
    expect(failure.message).toContain('unauthorized');
    expect(failure.message).toContain('[redacted]');
    expect(retry).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'senviok_send_failed',
        jobId: job.id,
        kind: 'alert-email',
        status: 401,
        error: failure.message,
      }),
    );
    expectNoSecrets(leakText(warn.mock.calls, failure));
  });

  it('records a redacted 422 JSON body and fails the job', async () => {
    const sendEmail = jest.fn().mockRejectedValue(
      providerError(422, {
        code: 'invalid_sender',
        message: `Sender updates@oren.finance is not verified for ${recipient}. Bearer ${apiKey}`,
        errors: [{ field: 'to', message: `rejected ${recipient}` }],
      }),
    );
    const { delivery, failSend, retry, update, warn } = harness(sendEmail);
    await delivery.send(alertJob());

    const failure = recorded(failSend.mock.calls[0][1]);
    expect(failure.status).toBe(422);
    expect(failure.message).toContain('invalid_sender');
    expect(failure.message).toContain('not verified');
    expect(failure.message.length).toBeLessThanOrEqual(300);
    expect(retry).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expectNoSecrets(leakText(warn.mock.calls, failure));
  });

  it('records a redacted 429 and retries', async () => {
    const sendEmail = jest.fn().mockRejectedValue(
      providerError(429, {
        code: 'rate_limited',
        message: `Too many requests for ${recipient} using ${apiKey}`,
      }),
    );
    const { delivery, failSend, retry, update, warn } = harness(sendEmail);
    const job = alertJob();
    await delivery.send(job);

    expect(failSend).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledTimes(1);
    const [retriedJob, submitted, rawFailure] = retry.mock.calls[0];
    const failure = recorded(rawFailure);
    expect(retriedJob).toBe(job);
    expect(submitted).toBe(true);
    expect(failure).toMatchObject({
      status: 429,
      message: expect.stringContaining('rate_limited') as string,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 429, kind: 'alert-email' }),
    );
    expectNoSecrets(leakText(warn.mock.calls, failure));
  });

  it('records a timeout with no status and leaves the outcome uncertain', async () => {
    jest.useFakeTimers();
    const sendEmail = jest.fn().mockReturnValue(new Promise(() => {}));
    const { delivery, failSend, retry, update, warn } = harness(sendEmail);
    const job = alertJob();
    const pending = delivery.send(job);
    try {
      await jest.advanceTimersByTimeAsync(25_000);
      await pending;
    } finally {
      jest.useRealTimers();
    }

    expect(failSend).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(job, 'uncertain', undefined, {
      status: null,
      message: 'Senviok submission timed out',
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: job.id,
        kind: 'alert-email',
        status: null,
        error: 'Senviok submission timed out',
      }),
    );
    expectNoSecrets(leakText(warn.mock.calls, update.mock.calls));
  });

  it('keeps a 503 from missing Senviok config uncertain', async () => {
    const sendEmail = jest
      .fn()
      .mockRejectedValue(
        new ServiceUnavailableException('Senviok email is not configured'),
      );
    const { delivery, failSend, retry, update } = harness(sendEmail);
    await delivery.send(alertJob());
    expect(failSend).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    const [, state, , rawFailure] = update.mock.calls[0];
    const failure = recorded(rawFailure);
    expect(state).toBe('uncertain');
    expect(failure.status).toBe(503);
    expect(failure.message).toContain('not configured');
    expectNoSecrets(leakText(failure));
  });
});

describe('notification job error columns', () => {
  function compiled(query: SQL) {
    return new PgDialect().sqlToQuery(query);
  }

  it('binds status and message on failure and clears them when a send is accepted', async () => {
    const queries: SQL[] = [];
    const jobs = new NotificationJobs({
      execute: (query: SQL) => {
        queries.push(query);
        return Promise.resolve([]);
      },
    } as never);
    const job = alertJob();
    await jobs.failSend(job, { status: 401, message: 'unauthorized' });
    await jobs.retry(job, true, { status: 429, message: 'rate_limited' });
    await jobs.update(job, 'uncertain', undefined, {
      status: null,
      message: 'Senviok submission timed out',
    });
    await jobs.update(job, 'accepted', 'provider-1');

    const failed = compiled(queries[0]);
    expect(failed.sql).toContain("state = 'failed'");
    expect(failed.sql).toContain('last_error_status');
    expect(failed.sql).toContain('last_error');
    expect(failed.sql).not.toContain('provider_id');
    expect(failed.params).toEqual(
      expect.arrayContaining([401, 'unauthorized']),
    );

    const retried = compiled(queries[1]);
    expect(retried.sql).toContain('last_error');
    expect(retried.params).toEqual(
      expect.arrayContaining([429, 'rate_limited']),
    );

    const uncertain = compiled(queries[2]);
    expect(uncertain.sql).toContain('last_error_status');
    expect(uncertain.params).toEqual(
      expect.arrayContaining([null, 'Senviok submission timed out']),
    );

    const accepted = compiled(queries[3]);
    expect(accepted.sql).toContain('last_error');
    expect(accepted.params).toContain('provider-1');
    expect(accepted.params).toContain(null);
    expect(accepted.params).not.toContain('Senviok submission timed out');
    expectNoSecrets(JSON.stringify([failed, retried, uncertain, accepted]));
  });
});

describe('senviok config summary', () => {
  it('reports presence and the sender domain only', () => {
    expect(senviokConfigSummary({})).toBe(
      'senviok config api_key=missing from=missing from_domain=missing',
    );
    const present = senviokConfigSummary({
      SENVIOK_API_KEY: apiKey,
      SENVIOK_FROM: 'Oren Updates <updates@oren.finance>',
    });
    expect(present).toBe(
      'senviok config api_key=present from=present from_domain=oren.finance',
    );
    const invalid = senviokConfigSummary({
      SENVIOK_API_KEY: apiKey,
      SENVIOK_FROM: apiKey,
    });
    expect(invalid).toBe(
      'senviok config api_key=present from=present from_domain=invalid',
    );
    expectNoSecrets(`${present}\n${invalid}`);
  });

  it('logs the summary when the worker starts', async () => {
    const saved = { ...process.env };
    process.env.MORNING_BRIEF_ENABLED = 'false';
    process.env.PRICE_ALERTS_ENABLED = 'false';
    process.env.SENVIOK_API_KEY = apiKey;
    process.env.SENVIOK_FROM = 'Oren Updates <updates@oren.finance>';
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const worker = new NotificationWorker(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    try {
      worker.onApplicationBootstrap();
      const lines = log.mock.calls.map((call) => String(call[0]));
      expect(lines).toContain(
        'senviok config api_key=present from=present from_domain=oren.finance',
      );
      expectNoSecrets(lines.join('\n'));
    } finally {
      log.mockRestore();
      await worker.onModuleDestroy();
      process.env = saved;
    }
  });
});
