import { providerQuote } from './quotes';
import { alertMintAllowed, notificationSettings } from './settings';

const mintA = 'NVDAVuiB7hwd3m5Wa1JuHNovPaPG6BH1QNztbKFxNjv';
const mintB = 'So11111111111111111111111111111111111111112';
const user = 'did:privy:coverage';
const base = {
  NOTIFICATION_APP_ORIGIN: 'https://preview.example.test',
  NOTIFICATION_UNSUBSCRIBE_SECRET: 'test-only'.repeat(4),
  NOTIFICATION_PILOT_USERS: user,
  NOTIFICATION_EMAIL_PER_MINUTE: '20',
  NOTIFICATION_TOKENS_PER_MINUTE: '20',
  PRICE_ALERTS_ENABLED: 'true',
  TOKENS_ALERT_TIMESTAMPS_VERIFIED: 'true',
  NOTIFICATION_ALERT_MINTS: '*',
  NOTIFICATION_QUOTE_MAX_TRADE_AGE_SECONDS: '600',
};

describe('alert settings', () => {
  it('lets "*" allow every mint and keeps explicit lists strict', () => {
    const all = notificationSettings({ ...base });
    expect(all.alerts).toBe(true);
    expect(alertMintAllowed(mintB, all)).toBe(true);
    const list = notificationSettings({
      ...base,
      NOTIFICATION_ALERT_MINTS: mintA,
    });
    expect(alertMintAllowed(mintA, list)).toBe(true);
    expect(alertMintAllowed(mintB, list)).toBe(false);
    expect(
      notificationSettings({ ...base, NOTIFICATION_ALERT_MINTS: '' }).alerts,
    ).toBe(false);
  });

  it('defaults to a 2 minute trade age and accepts an override', () => {
    expect(notificationSettings({}).quoteMaxTradeAgeMs).toBe(120000);
    expect(notificationSettings({ ...base }).quoteMaxTradeAgeMs).toBe(600000);
  });

  it('accepts an older last trade only inside the configured window', () => {
    const now = new Date();
    const raw = {
      mint: mintA,
      price: 100,
      providerFetchedAt: now.getTime() - 1000,
      lastTradeAt: now.getTime() - 300000,
    };
    expect(providerQuote(raw as never, now)).toBeNull();
    expect(providerQuote(raw as never, now, 600000)?.price).toBe(100);
    expect(
      providerQuote(
        { ...raw, lastTradeAt: now.getTime() - 900000 },
        now,
        600000,
      ),
    ).toBeNull();
  });
});
