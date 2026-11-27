import type { TokensService } from '../tokens/tokens.service';
import type { StockCatalogRepository } from '../tokens/stock-catalog.repository';
import { MarketService } from './market.service';

describe('MarketService', () => {
  it('returns finished charts before the client deadline and caches late charts for later reads', async () => {
    jest.useFakeTimers();
    try {
      const getPriceChart = jest.fn((id: string) => {
        if (id === 'slow') {
          return new Promise((resolve) =>
            setTimeout(() => resolve([]), 30_000),
          );
        }
        return Promise.resolve([]);
      });
      const service = new MarketService(
        { getPriceChart } as unknown as TokensService,
        {
          findByAssetIds: jest.fn(([id]: string[]) =>
            Promise.resolve([{ id, ticker: id.toUpperCase() }]),
          ),
        } as unknown as StockCatalogRepository,
      );

      const batch = service.getCharts(['slow', 'fast'], '1D');
      await jest.advanceTimersByTimeAsync(12_000);
      const results = await batch;
      expect(results).toEqual({
        fast: { assetId: 'fast', ticker: 'FAST', range: '1D', candles: [] },
      });

      await jest.advanceTimersByTimeAsync(18_000);
      expect(Object.keys(results)).toEqual(['fast']);
      await expect(service.getChart('slow', '1D')).resolves.toMatchObject({
        assetId: 'slow',
        candles: [],
      });
      expect(getPriceChart).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('distinguishes no interests, a classified catalog without matches, and an unavailable catalog', async () => {
    const findSectorCandidates = jest
      .fn()
      .mockResolvedValueOnce({ items: [], isFresh: true })
      .mockResolvedValueOnce(null);
    const tokens = {
      getStocks: jest.fn().mockResolvedValue([]),
    } as unknown as TokensService;
    const catalog = {
      findSectorCandidates,
      replaceAll: jest.fn(),
    } as unknown as StockCatalogRepository;
    const service = new MarketService(tokens, catalog);

    await expect(service.getForYou([])).resolves.toEqual({
      state: 'no_preferences',
      items: [],
    });
    expect(findSectorCandidates).not.toHaveBeenCalled();
    await expect(service.getForYou(['energy'])).resolves.toEqual({
      state: 'no_matches',
      items: [],
    });
    await expect(service.getForYou(['energy'])).rejects.toMatchObject({
      status: 503,
    });
  });

  it('requests only the selected stock page and returns pagination metadata', async () => {
    const getStocksPage = jest.fn().mockResolvedValue({
      stocks: [
        {
          id: 'nvidia',
          ticker: 'NVDA',
          name: 'NVIDIA',
          category: 'equity',
          logo: 'https://cdn.tokens.xyz/nvidia.png',
          price: 182.14,
          priceChange24h: 2.35,
          volume24h: 12_000_000,
          liquidity: 4_500_000,
          variants: [],
        },
      ],
      total: 41,
      hasMore: true,
    });
    const tokens = {
      getStocksPage,
      getStocks: jest.fn().mockResolvedValue([]),
    } as unknown as TokensService;
    const catalog = {
      listPage: jest.fn().mockResolvedValue({
        items: [],
        total: 0,
        isFresh: false,
      }),
      replaceAll: jest.fn(),
    } as unknown as StockCatalogRepository;
    const service = new MarketService(tokens, catalog);

    await expect(service.listStocks(2, 20)).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: 'nvidia',
          logo: 'https://cdn.tokens.xyz/nvidia.png',
          volume24h: 12_000_000,
          liquidity: 4_500_000,
        }),
      ],
      pagination: {
        page: 2,
        limit: 20,
        total: 41,
        totalPages: 3,
        hasMore: true,
      },
    });
    expect(getStocksPage).toHaveBeenCalledWith(20, 20);
  });

  it('serves a fresh stock page from Postgres without calling Tokens', async () => {
    const getStocksPage = jest.fn();
    const tokens = { getStocksPage } as unknown as TokensService;
    const catalog = {
      listPage: jest.fn().mockResolvedValue({
        items: [
          {
            id: 'apple',
            ticker: 'AAPL',
            name: 'Apple',
            category: 'equity',
          },
        ],
        total: 34,
        isFresh: true,
      }),
    } as unknown as StockCatalogRepository;
    const service = new MarketService(tokens, catalog);

    await expect(service.listStocks(1, 20)).resolves.toMatchObject({
      items: [{ id: 'apple', ticker: 'AAPL' }],
      pagination: { total: 34, hasMore: true },
    });
    expect(getStocksPage).not.toHaveBeenCalled();
  });
});
