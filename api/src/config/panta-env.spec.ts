import { validateEnv } from './env.schema';

const required = {
  POSTGRES_URL: 'test',
  TOKENS_API_KEY: 'test',
  ALCHEMY_API_KEY: 'test',
};
describe('Panta configuration', () => {
  it('is optional and disabled by default', () => {
    expect(validateEnv(required)).toMatchObject({
      PANTA_ENABLED: false,
      PANTA_REQUEST_TIMEOUT_MS: 8000,
    });
  });
  it('requires explicit URL and key when enabled', () => {
    expect(() => validateEnv({ ...required, PANTA_ENABLED: 'true' })).toThrow(
      'required when PANTA_ENABLED',
    );
  });
  it('normalizes URL and validates the timeout', () => {
    const input = {
      ...required,
      PANTA_ENABLED: 'true',
      PANTA_API_BASE_URL: 'https://example.test/api/v1/',
      PANTA_API_KEY: 'test',
    };
    expect(validateEnv(input).PANTA_API_BASE_URL).toBe(
      'https://example.test/api/v1',
    );
    expect(() =>
      validateEnv({ ...input, PANTA_REQUEST_TIMEOUT_MS: '0' }),
    ).toThrow('positive integer');
  });
  it.each([
    'bad',
    'ftp://example.test',
    'https://user:secret@example.test',
    'https://example.test?key=secret',
  ])('rejects unsafe URL %s without echoing it', (url) => {
    expect(() => validateEnv({ ...required, PANTA_API_BASE_URL: url })).toThrow(
      'Invalid PANTA_API_BASE_URL',
    );
  });
});
