import { PriceAlerts } from './alerts';
import type { NotificationJobs } from './jobs';
import type { TokensService } from '../tokens/tokens.service';

const mint = 'So11111111111111111111111111111111111111112';
const env = {
  NOTIFICATION_APP_ORIGIN: 'https://oren.test',
  NOTIFICATION_UNSUBSCRIBE_SECRET: 'x'.repeat(32),
  NOTIFICATION_ALERT_MINTS: mint,
  NOTIFICATION_TOKENS_PER_MINUTE: '10',
  NOTIFICATION_EMAIL_PER_MINUTE: '10',
  NOTIFICATION_PILOT_USERS: 'u1',
  PRICE_ALERTS_ENABLED: 'true',
  TOKENS_ALERT_TIMESTAMPS_VERIFIED: 'true',
};

function service(price: number) {
  const now = Date.now();
  const transaction = jest.fn().mockRejectedValue(new Error('reached db'));
  const alerts = new PriceAlerts(
    { transaction } as never,
    {
      budget: jest.fn().mockResolvedValue(true),
    } as unknown as NotificationJobs,
    {
      getMarketSnapshots: jest.fn().mockResolvedValue([
        {
          mint,
          price,
          providerFetchedAt: now - 1000,
          lastTradeAt: now - 2000,
        },
      ]),
    } as unknown as TokensService,
  );
  return { alerts, transaction };
}

describe('PriceAlerts.create target already met', () => {
  const saved = { ...process.env };
  beforeEach(() => Object.assign(process.env, env));
  afterEach(() => {
    process.env = { ...saved };
  });
  const body = (direction: string, target: string) => ({
    assetId: 'nvda',
    mint,
    direction,
    target,
  });

  it.each([
    ['above', '100', 105],
    ['above', '100', 100],
    ['below', '100', 95],
  ])('rejects %s %s when price is %d', async (d, t, price) => {
    const { alerts, transaction } = service(price);
    await expect(alerts.create('u1', true, body(d, t))).rejects.toMatchObject({
      status: 400,
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['above', '100', 95],
    ['below', '100', 105],
  ])('accepts %s %s when price is %d', async (d, t, price) => {
    const { alerts, transaction } = service(price);
    await expect(alerts.create('u1', true, body(d, t))).rejects.toThrow(
      'reached db',
    );
    expect(transaction).toHaveBeenCalled();
  });
});
