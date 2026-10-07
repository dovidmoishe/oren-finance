import type { AppEnv } from '../config/env.schema';
import { PantaService } from './panta.service';

const ID = '11111111111111111111111111111111';
const item = { marketId: ID, title: 'NVDA vs AMD', phase: 'primary' };
const env = {
  PANTA_ENABLED: true,
  PANTA_API_BASE_URL: 'https://example.test/api/v1',
  PANTA_API_KEY: 'secret-never-print',
  PANTA_REQUEST_TIMEOUT_MS: 8000,
} as AppEnv;

describe('Panta read provider', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let service: PantaService;
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-07T10:00:00Z') });
    fetchMock = jest.spyOn(global, 'fetch');
    service = new PantaService(env);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function response(body: unknown, status = 200, headers?: HeadersInit) {
    return new Response(JSON.stringify(body), { status, headers });
  }

  it('requires enabled configuration without making requests', async () => {
    await expect(
      new PantaService({ ...env, PANTA_ENABLED: false }).getCategories(),
    ).rejects.toMatchObject({ code: 'PANTA_DISABLED' });
    await expect(
      new PantaService({ ...env, PANTA_API_KEY: undefined }).getCategories(),
    ).rejects.toMatchObject({ code: 'PANTA_NOT_CONFIGURED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('encodes documented filters and cursor, caches and deduplicates reads', async () => {
    fetchMock.mockResolvedValue(
      response({ items: [item], nextCursor: 'next' }),
    );
    const query = {
      category: 'finance',
      status: 'primary' as const,
      cursor: 'a+b',
      limit: 10,
      createdBy: 'me' as const,
    };
    const [first, second] = await Promise.all([
      service.listMarkets(query),
      service.listMarkets(query),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://example.test/api/v1/markets/?category=finance&status=primary&createdBy=me&cursor=a%2Bb&limit=10',
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      headers: { 'X-Api-Key': env.PANTA_API_KEY },
      redirect: 'error',
    });
    first.items[0].title = 'mutated';
    expect(second.items[0].title).toBe(item.title);
    expect((await service.listMarkets(query)).items[0].title).toBe(item.title);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads categories and detail without confusing their envelopes', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ categories: ['finance'] }))
      .mockResolvedValueOnce(response(item));
    expect((await service.getCategories()).categories).toEqual(['finance']);
    expect((await service.getMarket(ID)).marketId).toBe(ID);
  });

  it.each([
    [401, 'PANTA_UNAUTHORIZED'],
    [403, 'PANTA_FORBIDDEN'],
    [404, 'PANTA_NOT_FOUND'],
    [429, 'PANTA_RATE_LIMITED'],
    [503, 'PANTA_UNAVAILABLE'],
  ])('sanitizes HTTP %s errors', async (status, code) => {
    fetchMock.mockResolvedValue(
      response({ message: env.PANTA_API_KEY }, status),
    );
    await expect(service.getCategories()).rejects.toMatchObject({
      code,
      message: 'Panta request failed',
      cause: undefined,
    });
  });

  it('honors Retry-After without making another request', async () => {
    fetchMock.mockResolvedValue(response({}, 429, { 'Retry-After': '60' }));
    await expect(service.getCategories()).rejects.toMatchObject({
      code: 'PANTA_RATE_LIMITED',
    });
    await expect(service.listMarkets()).rejects.toMatchObject({
      code: 'PANTA_RATE_LIMITED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(60_000);
    fetchMock.mockResolvedValue(response({ categories: [] }));
    await expect(service.getCategories()).resolves.toMatchObject({
      categories: [],
    });
  });

  it('returns explicitly stale data only within five minutes of the original read', async () => {
    fetchMock.mockResolvedValueOnce(response({ items: [item] }));
    const first = await service.listMarkets();
    jest.advanceTimersByTime(30_000);
    fetchMock.mockRejectedValue(
      new Error('network details containing credentials'),
    );
    const stale = await service.listMarkets();
    expect(stale.source).toEqual({ ...first.source, stale: true });
    expect(stale.items[0].source.stale).toBe(true);
    jest.advanceTimersByTime(270_000);
    await expect(service.listMarkets()).rejects.toMatchObject({
      code: 'PANTA_UNAVAILABLE',
    });
  });

  it('never masks revoked credentials with stale data', async () => {
    fetchMock.mockResolvedValueOnce(response({ categories: [] }));
    await service.getCategories();
    jest.advanceTimersByTime(30_000);
    fetchMock.mockResolvedValue(response({}, 401));
    await expect(service.getCategories()).rejects.toMatchObject({
      code: 'PANTA_UNAUTHORIZED',
    });
  });

  it('rejects malformed JSON, envelopes and detail mismatches', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('not-json'))
      .mockResolvedValueOnce(response({ items: 'bad' }))
      .mockResolvedValueOnce(response({ ...item, marketId: 'different' }));
    await expect(service.getCategories()).rejects.toMatchObject({
      code: 'PANTA_INVALID_RESPONSE',
    });
    await expect(service.listMarkets()).rejects.toMatchObject({
      code: 'PANTA_INVALID_RESPONSE',
    });
    await expect(service.getMarket(ID)).rejects.toMatchObject({
      code: 'PANTA_INVALID_RESPONSE',
    });
  });

  it('validates IDs and limits locally', () => {
    expect(() => service.getMarket('../categories')).toThrow(
      'Invalid market ID',
    );
    expect(() => service.listMarkets({ limit: 51 })).toThrow(
      'Invalid Panta filter',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bounds the cache to 200 entries', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(response({ items: [] })),
    );
    for (let i = 0; i <= 200; i++)
      await service.listMarkets({ cursor: String(i) });
    await service.listMarkets({ cursor: '0' });
    expect(fetchMock).toHaveBeenCalledTimes(202);
  });

  it('cancels timed-out reads and clears inflight state', async () => {
    jest.useRealTimers();
    service = new PantaService({ ...env, PANTA_REQUEST_TIMEOUT_MS: 10 });
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true },
          );
        }),
    );
    await expect(service.getCategories()).rejects.toMatchObject({
      code: 'PANTA_TIMEOUT',
    });
    fetchMock.mockResolvedValue(response({ categories: [] }));
    await expect(service.getCategories()).resolves.toMatchObject({
      categories: [],
    });
  });
});
