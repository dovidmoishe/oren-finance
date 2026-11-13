import { normalizeMarketSnapshots } from '../tokens/market-snapshots';
import { calculatePnl, priceMoves, type Valuation } from './brief-math';
import { alreadyPast, crossed, providerQuote } from './quotes';
import { nextBrief } from './schedule';
import { notificationSettings } from './settings';
import { unsubscribeJobId, unsubscribeToken } from './delivery';

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
  });
});
