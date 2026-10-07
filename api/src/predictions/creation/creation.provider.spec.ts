import { CreationProvider } from './creation.provider';
describe('Panta creation writes', () => {
  const env = {
    PANTA_ENABLED: true,
    PANTA_CREATION_ENABLED: true,
    PANTA_API_BASE_URL: 'https://provider.example',
    PANTA_API_KEY: 'secret-test-key',
  };
  const quote = {
    createId: 'session',
    expectedEventPda: 'event',
    paymentUsdc: '9007199254740993001',
    liquidityInjectionUsdc: '9007199254740993000',
    platformRevenueUsdc: '1',
    marketType: 'standard',
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  afterEach(() => jest.restoreAllMocks());
  it('never calls a disabled provider and preserves base-unit precision', async () => {
    const fetcher = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(quote)));
    await expect(
      new CreationProvider({
        ...env,
        PANTA_CREATION_ENABLED: false,
      } as never).quote({} as never),
    ).rejects.toMatchObject({ code: 'PANTA_CREATE_DISABLED' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      (await new CreationProvider(env as never).quote({} as never)).paymentUsdc,
    ).toBe(quote.paymentUsdc);
    expect(fetcher).toHaveBeenCalledWith(
      'https://provider.example/markets/create/quote/',
      expect.objectContaining({ redirect: 'error' }),
    );
  });
  it.each([401, 429, 500])(
    'sanitizes status %s without echoing credentials or upstream text',
    async (status) => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(
          new Response('secret-test-key private error', { status }),
        );
      await expect(
        new CreationProvider(env as never).quote({} as never),
      ).rejects.toMatchObject({
        message: 'Panta creation request failed',
        code:
          status === 401
            ? 'PANTA_CREATE_UNAUTHORIZED'
            : status === 429
              ? 'PANTA_CREATE_RATE_LIMITED'
              : 'PANTA_CREATE_UNAVAILABLE',
      });
    },
  );
  it('rejects decimal fees, inconsistent sums, expiry and malicious upload URLs', async () => {
    const fetcher = jest.spyOn(global, 'fetch');
    const provider = new CreationProvider(env as never);
    for (const patch of [
      { paymentUsdc: '1.23' },
      { platformRevenueUsdc: '2' },
      { expiresAt: '2000-01-01T00:00:00Z' },
    ]) {
      fetcher.mockResolvedValueOnce(
        new Response(JSON.stringify({ ...quote, ...patch })),
      );
      await expect(provider.quote({} as never)).rejects.toThrow();
    }
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          uploadUrl: 'https://127.0.0.1/upload',
          expiresAt: quote.expiresAt,
          fields: {},
        }),
      ),
    );
    await expect(provider.upload(Buffer.from('png'))).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('only treats matching idempotent registration as success', async () => {
    const fetcher = jest.spyOn(global, 'fetch');
    const provider = new CreationProvider(env as never);
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'registered',
          marketId: 'event',
          signature: 'sig',
          createId: 'session',
        }),
      ),
    );
    expect(await provider.register('session', 'sig', 'event')).toBe('event');
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'registered',
          marketId: 'other',
          signature: 'sig',
          createId: 'session',
        }),
      ),
    );
    await expect(
      provider.register('session', 'sig', 'event'),
    ).rejects.toThrow();
  });
});
