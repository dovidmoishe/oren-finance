import { migrateJupiterUrl, validateEnv } from './env.schema';

const required = {
  POSTGRES_URL: 'postgres://test',
  TOKENS_API_KEY: 'tokens-test',
  ALCHEMY_API_KEY: 'alchemy-test',
};

describe('validateEnv — Jupiter', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('defaults to api.jup.ag with the keyless 0.5 rps budget', () => {
    const env = validateEnv(required);
    expect(env.JUPITER_API_URL).toBe('https://api.jup.ag/swap/v1');
    expect(env.JUPITER_TRIGGER_API_URL).toBeUndefined();
    expect(env.JUPITER_API_KEY).toBeUndefined();
    expect(env.JUPITER_MAX_RPS).toBe(0.5);
  });

  it('raises the Jupiter default budget to 1 rps when a key is set', () => {
    expect(
      validateEnv({ ...required, JUPITER_API_KEY: 'k' }).JUPITER_MAX_RPS,
    ).toBe(1);
    expect(
      validateEnv({ ...required, JUPITER_API_KEY: 'k', JUPITER_MAX_RPS: '10' })
        .JUPITER_MAX_RPS,
    ).toBe(10);
  });

  it('rewrites a stale lite-api.jup.ag override to api.jup.ag', () => {
    const env = validateEnv({
      ...required,
      JUPITER_API_URL: 'https://lite-api.jup.ag/swap/v1/',
      JUPITER_TRIGGER_API_URL: 'https://lite-api.jup.ag/trigger/v1',
    });
    expect(env.JUPITER_API_URL).toBe('https://api.jup.ag/swap/v1');
    expect(env.JUPITER_TRIGGER_API_URL).toBe('https://api.jup.ag/trigger/v1');
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(migrateJupiterUrl('https://jupiter.example/swap/v1')).toBe(
      'https://jupiter.example/swap/v1',
    );
  });

  it('rejects a non-positive JUPITER_MAX_RPS', () => {
    expect(() => validateEnv({ ...required, JUPITER_MAX_RPS: '0' })).toThrow(
      /JUPITER_MAX_RPS/,
    );
  });
});

describe('validateEnv — swap routing (Titan)', () => {
  it('defaults to Titan disabled and jupiter-only routing', () => {
    const env = validateEnv(required);
    expect(env.TITAN_API_KEY).toBeUndefined();
    expect(env.TITAN_API_URL).toBe('https://portal.api.titan.exchange');
    expect(env.TITAN_MAX_RPS).toBe(1);
    expect(env.TITAN_EXTRA_PROGRAM_IDS).toEqual([]);
    expect(env.TITAN_MAX_PRICE_DEVIATION_BPS).toBe(100);
    expect(env.SWAP_ROUTER_MODE).toBe('jupiter');
  });

  it('reads TITAN_MAX_PRICE_DEVIATION_BPS as integer bps in 1..10000', () => {
    expect(
      validateEnv({ ...required, TITAN_MAX_PRICE_DEVIATION_BPS: '250' })
        .TITAN_MAX_PRICE_DEVIATION_BPS,
    ).toBe(250);
    for (const bad of ['0', '10001', '1.5', 'abc']) {
      expect(() =>
        validateEnv({ ...required, TITAN_MAX_PRICE_DEVIATION_BPS: bad }),
      ).toThrow(/TITAN_MAX_PRICE_DEVIATION_BPS/);
    }
  });

  it('validates SWAP_ROUTER_MODE, rps values and program lists', () => {
    expect(
      validateEnv({ ...required, SWAP_ROUTER_MODE: 'SHADOW' }).SWAP_ROUTER_MODE,
    ).toBe('shadow');
    expect(() =>
      validateEnv({ ...required, SWAP_ROUTER_MODE: 'titan' }),
    ).toThrow(/SWAP_ROUTER_MODE/);
    expect(() => validateEnv({ ...required, TITAN_MAX_RPS: '0' })).toThrow(
      /TITAN_MAX_RPS/,
    );
    expect(
      validateEnv({ ...required, TITAN_EXTRA_PROGRAM_IDS: ' a , b ,' })
        .TITAN_EXTRA_PROGRAM_IDS,
    ).toEqual(['a', 'b']);
  });
});
