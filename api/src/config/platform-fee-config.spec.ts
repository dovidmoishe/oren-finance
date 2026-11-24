import { PublicKey } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { USDC_MINT } from './constants';
import { validateEnv } from './env.schema';
import { platformFeeConfig } from './platform-fee-config';

const required = {
  POSTGRES_URL: 'postgres://test',
  TOKENS_API_KEY: 'test',
  ALCHEMY_API_KEY: 'test',
};
const account = '11111111111111111111111111111111';
describe('platform fee configuration', () => {
  let warning: jest.SpyInstance;
  beforeEach(() => {
    warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warning.mockRestore());
  it('defaults to zero and keeps Titan fee support off', () => {
    const env = validateEnv(required);
    expect(env.PLATFORM_FEE_BPS).toBe(0);
    expect(env.PLATFORM_FEE_CONFIG).toBeUndefined();
    expect(env.TITAN_PLATFORM_FEE_ENABLED).toBe(false);
    expect(warning).not.toHaveBeenCalled();
  });
  it('ignores invalid unused destinations when switched off', () => {
    expect(
      platformFeeConfig({
        PLATFORM_FEE_BPS: '0',
        PLATFORM_FEE_OWNER: 'invalid',
      }),
    ).toBeUndefined();
    expect(warning).not.toHaveBeenCalled();
  });
  it.each(['1', '50', '255'])('accepts an integer in bounds: %s', (bps) => {
    expect(
      platformFeeConfig({
        PLATFORM_FEE_BPS: bps,
        PLATFORM_FEE_USDC_ACCOUNT: account,
      }),
    ).toEqual({ bps: Number(bps), account });
  });
  it.each(['-1', '256', '1.5', 'NaN', 'false', '1e2'])(
    'disables invalid bps and flags a startup warning: %s',
    (bps) => {
      const env = validateEnv({
        ...required,
        PLATFORM_FEE_BPS: bps,
        PLATFORM_FEE_USDC_ACCOUNT: account,
      });
      expect(env.PLATFORM_FEE_BPS).toBe(0);
      expect(warning).not.toHaveBeenCalled();
      expect(env.PLATFORM_FEE_CONFIG_INVALID).toBe(true);
    },
  );
  it.each([undefined, '', 'bad', '111'])(
    'disables missing or invalid accounts: %s',
    (value) => {
      expect(
        platformFeeConfig({
          PLATFORM_FEE_BPS: '50',
          PLATFORM_FEE_USDC_ACCOUNT: value,
        }),
      ).toBeUndefined();
      expect(warning).not.toHaveBeenCalled();
    },
  );
  it('derives the owner classic USDC ATA and requires both settings to agree', () => {
    const derived = getAssociatedTokenAddressSync(
      new PublicKey(USDC_MINT),
      new PublicKey(account),
      false,
      TOKEN_PROGRAM_ID,
    ).toBase58();
    const env = { PLATFORM_FEE_BPS: '50', PLATFORM_FEE_OWNER: account };
    expect(platformFeeConfig(env)).toEqual({ bps: 50, account: derived });
    // Real Solana derivation is also exercised by the transaction-guard spec.
    expect(
      platformFeeConfig({ ...env, PLATFORM_FEE_USDC_ACCOUNT: account }),
    ).toBeUndefined();
  });
});

describe('platform fee configuration across Nest validation passes', () => {
  it('preserves destination settings and disabled warnings through repeated validation', () => {
    const first = validateEnv({
      ...required,
      PLATFORM_FEE_BPS: '50',
      PLATFORM_FEE_USDC_ACCOUNT: account,
    });
    const second = validateEnv({ ...required, ...first });
    expect(second.PLATFORM_FEE_CONFIG).toEqual(first.PLATFORM_FEE_CONFIG);
    const invalid = validateEnv({ ...required, PLATFORM_FEE_BPS: '50' });
    expect(invalid.PLATFORM_FEE_BPS).toBe(0);
    expect(
      validateEnv({ ...required, ...invalid }).PLATFORM_FEE_CONFIG_INVALID,
    ).toBe(true);
  });
});
