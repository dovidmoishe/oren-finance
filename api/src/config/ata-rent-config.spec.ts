import { ataRentConfig } from './ata-rent-config';
import { validateEnv } from './env.schema';

const required = {
  POSTGRES_URL: 'postgres://test',
  TOKENS_API_KEY: 'test',
  ALCHEMY_API_KEY: 'test',
};
const enabled = {
  ATA_RENT_SPONSORSHIP: 'true',
  ATA_RENT_SPONSOR_SIGNER: 'privy',
  ATA_RENT_SPONSOR_PRIVY_WALLET_ID: 'server-wallet',
  ATA_RENT_SPONSOR_ADDRESS: '11111111111111111111111111111111',
  PRIVY_APP_ID: 'test',
  PRIVY_APP_SECRET: 'test',
};
describe('ATA rent configuration', () => {
  it('defaults off and does not validate unused signer configuration', () => {
    expect(validateEnv(required).ATA_RENT_SPONSORSHIP).toBe(false);
    expect(
      ataRentConfig({
        ...enabled,
        ATA_RENT_SPONSORSHIP: 'false',
        ATA_RENT_PER_USER_CAP: 'bad',
      }),
    ).toBeUndefined();
  });
  it('uses conservative defaults with exact atomic units', () => {
    expect(ataRentConfig(enabled)).toEqual(
      expect.objectContaining({
        minTradeRaw: 5000000n,
        perUserCap: 5,
        dailyBudgetLamports: 100000000n,
        minBalanceLamports: 20000000n,
        timeoutMs: 8000,
      }),
    );
  });
  it.each([
    ['ATA_RENT_SPONSOR_SIGNER', 'local'],
    ['ATA_RENT_SPONSOR_PRIVY_WALLET_ID', ''],
    ['ATA_RENT_SPONSOR_ADDRESS', 'bad'],
    ['PRIVY_APP_SECRET', ''],
    ['ATA_RENT_MIN_TRADE_USDC', '-1'],
    ['ATA_RENT_MIN_TRADE_USDC', '0.0000001'],
    ['ATA_RENT_PER_USER_CAP', '1.5'],
    ['ATA_RENT_DAILY_BUDGET_SOL', 'NaN'],
    ['ATA_RENT_SPONSOR_MIN_BALANCE_SOL', '-1'],
    ['ATA_RENT_CONFIRM_TIMEOUT_MS', '30001'],
  ])('fails closed without logging values: %s', (key, value) => {
    expect(ataRentConfig({ ...enabled, [key]: value })).toBeUndefined();
    expect(() =>
      validateEnv({ ...required, ...enabled, [key]: value }),
    ).not.toThrow();
  });
  it('keeps preview unavailable', () => {
    expect(
      ataRentConfig({ ...enabled, DEPLOYMENT_ENV: 'preview' }),
    ).toBeUndefined();
  });
});
