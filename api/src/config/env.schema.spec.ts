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
