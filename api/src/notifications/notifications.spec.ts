import { normalizeMarketSnapshots } from '../tokens/market-snapshots';
import { calculatePnl, priceMoves, type Valuation } from './brief-math';
import {
  alertEmail,
  NotificationDelivery,
  unsubscribeJobId,
  unsubscribeToken,
} from './delivery';
import {
  alreadyPast,
  crossed,
  formatAlertPrice,
  providerQuote,
} from './quotes';
import { MorningBrief } from './brief';
import {
  briefAdmitPerMinute,
  briefEmailSlots,
  briefSnapshotSlots,
  nextBrief,
} from './schedule';
import { alertUserAllowed, notificationSettings } from './settings';
import { NotificationUnsubscribeController } from './unsubscribe.controller';
import {
  notificationDispatchError,
  notificationWorkerStartup,
  shouldLogDispatchFailure,
} from './worker';

jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));

const now = new Date('2026-11-12T08:00:00Z');

describe('notification rules', () => {
  it('schedules the first occurrence on repeated clocks and the first valid minute in a gap', () => {
    expect(
      nextBrief(
        new Date('2026-03-08T00:00Z'),
        '02:30',
        'America/New_York',
      ).toISOString(),
    ).toBe('2026-03-08T07:00:00.000Z');
    expect(
      nextBrief(
        new Date('2026-11-01T00:00Z'),
        '01:30',
        'America/New_York',
      ).toISOString(),
    ).toBe('2026-11-01T05:30:00.000Z');
    expect(
      nextBrief(
        new Date('2026-11-01T05:35Z'),
        '01:30',
        'America/New_York',
      ).toISOString(),
    ).toBe('2026-11-02T06:30:00.000Z');
    expect(nextBrief(now, '08:00', 'Africa/Lagos').toISOString()).toBe(
      '2026-11-13T07:00:00.000Z',
    );
  });

  it('normalizes the live Tokens envelope and rejects unsupported quote freshness', () => {
    const raw = normalizeMarketSnapshots([
      {
        address: 'mint',
        hasMarket: true,
        token: {
          address: 'mint',
          price: 120,
          lastFetchedAt: now.getTime() - 2000,
          lastTradeAt: now.getTime() - 4000,
        },
      },
    ])[0];
    expect(providerQuote(raw, now)).toMatchObject({ mint: 'mint', price: 120 });
    expect(
      providerQuote({ ...raw, lastTradeAt: now.getTime() - 121_000 }, now),
    ).toBeNull();
    expect(
      providerQuote({ ...raw, providerFetchedAt: now.getTime() + 1 }, now),
    ).toBeNull();
    expect(providerQuote({ mint: 'mint', price: 120 }, now)).toBeNull();
  });

  it('fires at equality only from the correct side and reestablishes baselines after gaps', () => {
    const current = { mint: 'mint', price: 120, at: now };
    const previous = { price: 119, at: new Date(now.getTime() - 60_000) };
    expect(crossed('above', 120, previous, current)).toBe(true);
    expect(crossed('below', 120, { ...previous, price: 121 }, current)).toBe(
      true,
    );
    expect(crossed('above', 120, { ...previous, price: 120 }, current)).toBe(
      false,
    );
    expect(crossed('above', 120, null, current)).toBe(false);
    expect(crossed('above', 120, { ...previous, at: now }, current)).toBe(
      false,
    );
    // A long gap (overnight, outage) must not swallow a real crossing.
    expect(
      crossed(
        'above',
        120,
        { ...previous, at: new Date(now.getTime() - 3 * 3600_000) },
        current,
      ),
    ).toBe(true);
    // ...but a stale baseline already past the target does not fire.
    expect(
      crossed(
        'above',
        120,
        { price: 125, at: new Date(now.getTime() - 3 * 3600_000) },
        current,
      ),
    ).toBe(false);
  });

  it('flags targets the price already satisfies', () => {
    expect(alreadyPast('above', 100, 105)).toBe(true);
    expect(alreadyPast('above', 100, 100)).toBe(true);
    expect(alreadyPast('above', 100, 99.99)).toBe(false);
    expect(alreadyPast('below', 100, 95)).toBe(true);
    expect(alreadyPast('below', 100, 100.01)).toBe(false);
  });

  it('reconciles balances before subtracting deposits or adding withdrawals to dollar P&L', () => {
    const opening: Valuation = {
      value: 100,
      reliable: true,
      accounts: [],
      lots: {
        example: {
          assetId: 'example',
          ticker: 'EX',
          units: '1',
          amount: 1,
          price: 100,
        },
      },
    };
    const closing: Valuation = {
      ...opening,
      value: 160,
      lots: { example: { ...opening.lots.example, price: 110 } },
    };
    expect(calculatePnl(opening, closing, new Map(), 50_000_000n)).toBe(10);
    expect(
      calculatePnl(opening, { ...closing, value: 60 }, new Map(), -50_000_000n),
    ).toBe(10);
    expect(
      calculatePnl(opening, closing, new Map([['example', 2n]]), 0n),
    ).toBeNull();
    expect(
      calculatePnl(opening, { ...closing, reliable: false }, new Map(), 0n),
    ).toBeNull();
    expect(priceMoves(opening, closing)).toEqual([{ ticker: 'EX', usd: 10 }]);
  });

  it('signs only the delivery ID and rejects a tampered unsubscribe link', () => {
    const id = 'c1bdb5a5-22d1-43ac-b125-c30466655829';
    const token = unsubscribeToken(id, 'secret');
    expect(unsubscribeJobId(token, 'secret')).toBe(id);
    expect(unsubscribeJobId(token, 'other-secret')).toBeNull();
  });

  it('keeps preview isolated and requires the timestamp flag for alerts', () => {
    const env = {
      DEPLOYMENT_ENV: 'preview',
      MORNING_BRIEF_ENABLED: 'true',
      PRICE_ALERTS_ENABLED: 'true',
      NOTIFICATION_APP_ORIGIN: 'https://preview.example',
      NOTIFICATION_UNSUBSCRIBE_SECRET: 'a'.repeat(32),
      NOTIFICATION_TOKENS_PER_MINUTE: '10',
      NOTIFICATION_EMAIL_PER_MINUTE: '10',
      NOTIFICATION_ALERT_MINTS: 'NVDAVuiB7hwd3m5Wa1JuHNovPaPG6BH1QNztbKFxNjv',
    };
    expect(notificationSettings(env).briefs).toBe(false);
    const fixture = {
      ...env,
      NOTIFICATION_FIXTURE_MODE: 'true',
      NOTIFICATION_FIXTURE_RECIPIENT: 'qa@example.test',
    };
    expect(notificationSettings(fixture).briefs).toBe(true);
    expect(notificationSettings(fixture).alerts).toBe(false);
    expect(
      notificationSettings({
        ...fixture,
        TOKENS_ALERT_TIMESTAMPS_VERIFIED: 'true',
      }).alerts,
    ).toBe(true);
    expect(notificationSettings(fixture).alertsPublic).toBe(false);
    expect(
      notificationSettings({ ...fixture, PRICE_ALERTS_PUBLIC: 'true' })
        .alertsPublic,
    ).toBe(true);
  });

  it('opens alert membership and keeps briefs behind their own switch', () => {
    const config = notificationSettings(alertRuntime());
    expect(config.alertsPublic).toBe(false);
    expect(alertUserAllowed('pilot-user', config)).toBe(true);
    expect(alertUserAllowed('other', config)).toBe(false);
    const open = notificationSettings(
      alertRuntime({
        PRICE_ALERTS_PUBLIC: 'true',
        NOTIFICATION_PILOT_USERS: '',
      }),
    );
    expect(alertUserAllowed('other', open)).toBe(true);
    expect(open.briefs).toBe(false);
    const briefs = notificationSettings(
      alertRuntime({
        PRICE_ALERTS_PUBLIC: 'false',
        MORNING_BRIEF_ENABLED: 'true',
        NOTIFICATION_PILOT_USERS: '',
      }),
    );
    expect(briefs.briefs).toBe(true);
    expect(briefs.alertsPublic).toBe(false);
  });

  it('requires pilot accounts only for private alerts', () => {
    expect(
      notificationWorkerStartup(
        notificationSettings(
          alertRuntime({
            PRICE_ALERTS_ENABLED: 'false',
            MORNING_BRIEF_ENABLED: 'false',
            NOTIFICATION_PILOT_USERS: '',
            NOTIFICATION_REDIS_URL: '',
          }),
        ),
      ),
    ).toBe('idle');
    expect(
      notificationWorkerStartup(
        notificationSettings(
          alertRuntime({
            PRICE_ALERTS_PUBLIC: 'true',
            NOTIFICATION_PILOT_USERS: '',
          }),
        ),
      ),
    ).toBe('ready');
    expect(() =>
      notificationWorkerStartup(
        notificationSettings(
          alertRuntime({
            PRICE_ALERTS_PUBLIC: 'false',
            NOTIFICATION_PILOT_USERS: '',
          }),
        ),
      ),
    ).toThrow(/pilot accounts/);
    expect(
      notificationWorkerStartup(
        notificationSettings(
          alertRuntime({
            PRICE_ALERTS_ENABLED: 'false',
            MORNING_BRIEF_ENABLED: 'true',
            NOTIFICATION_PILOT_USERS: '',
          }),
        ),
      ),
    ).toBe('ready');
    expect(
      notificationWorkerStartup(
        notificationSettings(
          alertRuntime({
            PRICE_ALERTS_PUBLIC: 'true',
            MORNING_BRIEF_ENABLED: 'true',
            NOTIFICATION_PILOT_USERS: '',
          }),
        ),
      ),
    ).toBe('ready');
    expect(() =>
      notificationWorkerStartup(
        notificationSettings(
          alertRuntime({
            PRICE_ALERTS_PUBLIC: 'false',
            MORNING_BRIEF_ENABLED: 'true',
            NOTIFICATION_PILOT_USERS: '',
          }),
        ),
      ),
    ).toThrow(/pilot accounts/);
    expect(() =>
      notificationWorkerStartup(
        notificationSettings(
          alertRuntime({
            PRICE_ALERTS_PUBLIC: 'true',
            MORNING_BRIEF_ENABLED: 'true',
            NOTIFICATION_PILOT_USERS: '',
            NOTIFICATION_REDIS_URL: '',
          }),
        ),
      ),
    ).toThrow(/provider budgets/);
    expect(
      notificationWorkerStartup(notificationSettings(alertRuntime())),
    ).toBe('ready');
  });

  it('admits briefs inside the email and token budgets', () => {
    expect(briefEmailSlots(5, true)).toBe(4);
    expect(briefEmailSlots(5, false)).toBe(5);
    expect(briefEmailSlots(1, true)).toBe(1);
    expect(briefSnapshotSlots(2, true)).toBe(1);
    expect(briefSnapshotSlots(2, false)).toBe(2);
    expect(briefSnapshotSlots(1, true)).toBe(1);
    expect(
      briefAdmitPerMinute({
        alerts: true,
        emailPerMinute: 5,
        tokensPerMinute: 2,
      }),
    ).toBe(1);
    expect(
      briefAdmitPerMinute({
        alerts: false,
        emailPerMinute: 5,
        tokensPerMinute: 2,
      }),
    ).toBe(2);
    const horizon = 120;
    const perMinute = briefAdmitPerMinute({
      alerts: true,
      emailPerMinute: 5,
      tokensPerMinute: 2,
    });
    expect(perMinute * horizon).toBe(120);
  });

  it('formats stored alert prices and delivers briefs without a pilot list', async () => {
    expect(formatAlertPrice('120.00000000')).toBe('120.00');
    expect(formatAlertPrice('120.50000000')).toBe('120.50');
    expect(formatAlertPrice('120.12340000')).toBe('120.1234');
    expect(formatAlertPrice('0.00012300')).toBe('0.000123');
    expect(formatAlertPrice(130.5)).toBe('130.50');
    const copy = alertEmail(
      {
        ticker: 'NVDA',
        variant: 'NVDAx',
        mint: alertMint,
        price: 130.5,
        quoteAt: '2026-11-14T15:00:00.000Z',
        direction: 'above',
        target: '120.00000000',
        assetId: 'nvda',
      },
      'https://oren.example',
      'https://api.oren.example/stop',
    );
    expect(copy.text).toContain('above 120.00 USD');
    expect(copy.text).toContain('130.50 USD');
    expect(copy.text).not.toContain('00000000');

    const saved = {
      ...process.env,
    };
    Object.assign(process.env, alertRuntime());
    const update = jest.fn();
    const budget = jest.fn().mockResolvedValue(false);
    const defer = jest.fn();
    const delivery = new NotificationDelivery(
      {
        update,
        budget,
        defer,
        pending: jest.fn().mockResolvedValue([]),
      } as never,
      {} as never,
      {} as never,
    );
    const alert = alertJob('other');
    try {
      await delivery.send(alert);
      expect(update).toHaveBeenCalledWith(alert, 'canceled');
      expect(budget).not.toHaveBeenCalled();

      process.env.PRICE_ALERTS_PUBLIC = 'true';
      update.mockClear();
      await delivery.send(alert);
      expect(update).not.toHaveBeenCalled();
      expect(budget).toHaveBeenCalled();
      expect(defer).toHaveBeenCalledWith(alert);

      process.env.MORNING_BRIEF_ENABLED = 'true';
      process.env.NOTIFICATION_PILOT_USERS = '';
      update.mockClear();
      budget.mockClear();
      defer.mockClear();
      const brief = {
        ...alert,
        user_id: 'other',
        kind: 'brief-email' as const,
        payload: {
          scheduled: new Date().toISOString(),
          stories: [],
          moves: [],
        },
      };
      await delivery.send(brief);
      expect(update).not.toHaveBeenCalled();
      expect(budget).toHaveBeenCalled();
      expect(defer).toHaveBeenCalledWith(brief);

      process.env.MORNING_BRIEF_ENABLED = 'false';
      update.mockClear();
      budget.mockClear();
      await delivery.send(brief);
      expect(update).toHaveBeenCalledWith(brief, 'canceled');
      expect(budget).not.toHaveBeenCalled();

      process.env.MORNING_BRIEF_ENABLED = 'true';
      update.mockClear();
      budget.mockClear();
      const expired = {
        ...brief,
        payload: {
          ...brief.payload,
          scheduled: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        },
      };
      await delivery.send(expired);
      expect(update).toHaveBeenCalledWith(expired, 'canceled');
      expect(budget).not.toHaveBeenCalled();
    } finally {
      process.env = saved;
    }
  });

  it('builds a morning brief for an opted-in user who is not on the pilot list', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, alertRuntime(), {
      MORNING_BRIEF_ENABLED: 'true',
      NOTIFICATION_PILOT_USERS: '',
    });
    const identity = jest
      .fn()
      .mockResolvedValue({ email: 'person@example.com', wallet: null });
    const brief = new MorningBrief(
      {
        scheduleFor: jest.fn().mockResolvedValue({
          brief_time: '08:00',
          time_zone: 'UTC',
          brief_wallet: null,
          brief_wallet_since: null,
        }),
        update: jest.fn().mockResolvedValue(undefined),
      } as never,
      { getNotificationIdentity: identity } as never,
      {} as never,
      {} as never,
      {} as never,
      { getSectors: jest.fn().mockResolvedValue([]) } as never,
      { getRecentNews: jest.fn().mockResolvedValue([]) } as never,
      null as never,
      { OPENAI_MODEL: 'gpt-5-mini' } as never,
    );
    try {
      await brief.build({
        id: 'c1bdb5a5-22d1-43ac-b125-c30466655829',
        user_id: 'someone-else',
        kind: 'brief',
        attempts: 1,
        lease_token: 'lease',
        logical_key: 'brief-someone-else-2026-11-14',
        payload: {
          date: '2026-11-14',
          time: '08:00',
          zone: 'UTC',
          scheduled: new Date().toISOString(),
        },
      });
      expect(identity).toHaveBeenCalledWith('someone-else', null);
    } finally {
      process.env = saved;
    }
  });

  it('logs a dispatch failure code without the query and then rate limits it', () => {
    const wrapped = new Error('Failed query: select secret\nparams: hunter2');
    (wrapped as { cause?: unknown }).cause = Object.assign(
      new Error('permission denied for table notification_jobs'),
      { code: '42501' },
    );
    expect(notificationDispatchError(wrapped)).toEqual({
      code: '42501',
      message: 'permission denied for table notification_jobs',
    });
    expect(
      notificationDispatchError(
        Object.assign(
          new Error('connection failed postgres://oren:secret@db/oren'),
          { code: '28P01' },
        ),
      ),
    ).toEqual({ code: '28P01', message: 'notification dispatch failed' });
    const state = { at: 0, key: '' };
    const key = '42501 permission denied for table notification_jobs';
    expect(shouldLogDispatchFailure(state, key, 1_000)).toBe(true);
    expect(shouldLogDispatchFailure(state, key, 30_000)).toBe(false);
    expect(shouldLogDispatchFailure(state, key, 61_000)).toBe(true);
    expect(
      shouldLogDispatchFailure(state, '08006 connection refused', 61_000),
    ).toBe(true);
  });

  it('confirms an unsubscribe with an html page', async () => {
    const subscription = jest
      .fn()
      .mockResolvedValueOnce('alert-email')
      .mockResolvedValueOnce(null);
    const controller = new NotificationUnsubscribeController({
      subscription,
    } as never);
    const page = await controller.stop('token');
    expect(page).toContain('<!doctype html>');
    expect(page).toContain('You are unsubscribed');
    expect(page).toContain('price alert');
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(subscription).toHaveBeenCalledWith('token', true);
    await expect(controller.stop('missing')).rejects.toMatchObject({
      status: 404,
    });
  });
});

const alertMint = 'NVDAVuiB7hwd3m5Wa1JuHNovPaPG6BH1QNztbKFxNjv';

function alertRuntime(overrides: Record<string, string> = {}) {
  return {
    DEPLOYMENT_ENV: 'test',
    NOTIFICATION_FIXTURE_MODE: 'false',
    NOTIFICATION_APP_ORIGIN: 'https://oren.example',
    NOTIFICATION_API_ORIGIN: 'https://api.oren.example',
    NOTIFICATION_UNSUBSCRIBE_SECRET: 's'.repeat(32),
    NOTIFICATION_ALERT_MINTS: alertMint,
    NOTIFICATION_TOKENS_PER_MINUTE: '10',
    NOTIFICATION_EMAIL_PER_MINUTE: '10',
    NOTIFICATION_REDIS_URL: 'redis://127.0.0.1:6379',
    PRICE_ALERTS_ENABLED: 'true',
    TOKENS_ALERT_TIMESTAMPS_VERIFIED: 'true',
    MORNING_BRIEF_ENABLED: 'false',
    NOTIFICATION_PILOT_USERS: 'pilot-user',
    ...overrides,
  };
}

function alertJob(userId: string) {
  return {
    id: 'c1bdb5a5-22d1-43ac-b125-c30466655829',
    user_id: userId,
    kind: 'alert-email' as const,
    attempts: 0,
    lease_token: 'lease',
    logical_key: 'alert-1',
    payload: {
      mint: alertMint,
      ticker: 'NVDA',
      variant: 'NVDAx',
      price: 130.5,
      quoteAt: '2026-11-14T15:00:00.000Z',
      direction: 'above',
      target: '120.00000000',
      assetId: 'nvda',
    },
  };
}
