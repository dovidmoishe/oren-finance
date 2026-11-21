import { MarketReadCache } from './market-read-cache';
import { MarketService } from './market.service';
import type { TokensService } from '../tokens/tokens.service';
import type { StockCatalogRepository } from '../tokens/stock-catalog.repository';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('bounded display chart cache', () => {
  it('coalesces requests, separates ranges, expires and evicts results', async () => {
    let now = 1_000;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const cache = new MarketReadCache<number>(30, 1);
      const result = deferred<number>();
      const load = jest.fn(() => result.promise);
      const first = cache.get('a:1D', load);
      const second = cache.get('a:1D', load);
      await tick();
      expect(load).toHaveBeenCalledTimes(1);
      result.resolve(1);
      await Promise.all([first, second]);
      expect(await cache.get('a:1D', () => Promise.resolve(2))).toBe(1);
      now += 31;
      expect(await cache.get('a:1D', () => Promise.resolve(2))).toBe(2);
      await cache.get('a:1M', () => Promise.resolve(3));
      expect(await cache.get('a:1D', () => Promise.resolve(4))).toBe(4);
    } finally {
      clock.mockRestore();
    }
  });

  it('bounds concurrent provider work and rejects excess queued keys', async () => {
    const cache = new MarketReadCache<string>(30_000, 4, 1, 2);
    const blocked = deferred<string>();
    const calls: string[] = [];
    const first = cache.get('a', () => {
      calls.push('a');
      return blocked.promise;
    });
    const second = cache.get('b', () => {
      calls.push('b');
      return Promise.resolve('b');
    });
    await expect(
      cache.get('c', () => Promise.resolve('c')),
    ).rejects.toMatchObject({
      status: 503,
    });
    await tick();
    expect(calls).toEqual(['a']);
    blocked.resolve('a');
    await Promise.all([first, second]);
    expect(calls).toEqual(['a', 'b']);
  });

  it('does not cache errors and permits an immediate retry', async () => {
    const cache = new MarketReadCache<string>();
    await expect(
      cache.get('a', () => Promise.reject(new Error('offline'))),
    ).rejects.toThrow('offline');
    await expect(
      cache.get('a', () => Promise.resolve('recovered')),
    ).resolves.toBe('recovered');
  });

  it('reuses catalog ticker metadata and shares candles without a provider detail read', async () => {
    const getStock = jest.fn();
    const getPriceChart = jest.fn().mockResolvedValue([]);
    const findByAssetIds = jest
      .fn()
      .mockResolvedValue([{ id: 'nvidia', ticker: 'NVDA' }]);
    const service = new MarketService(
      { getStock, getPriceChart } as unknown as TokensService,
      { findByAssetIds } as unknown as StockCatalogRepository,
    );
    const [first, second] = await Promise.all([
      service.getChart('nvidia', '1D'),
      service.getChart('nvidia', '1D'),
    ]);
    expect(first).toEqual({
      assetId: 'nvidia',
      ticker: 'NVDA',
      range: '1D',
      candles: [],
    });
    expect(second).toEqual(first);
    expect(getPriceChart).toHaveBeenCalledTimes(1);
    expect(getStock).not.toHaveBeenCalled();
    await service.getChart('nvidia', '1M');
    expect(getPriceChart).toHaveBeenCalledTimes(2);
  });
});
