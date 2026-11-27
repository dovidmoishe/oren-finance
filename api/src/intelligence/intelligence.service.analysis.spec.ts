import { IntelligenceService } from './intelligence.service';
import type { StockSignals } from '../../types/signals';

describe('IntelligenceService analysis', () => {
  it.each([false, true])(
    'returns live summary and technicalBrief even when persistence fails (%s)',
    async (persistenceFails) => {
      const dailyBars = Array.from({ length: 220 }, (_, index) => {
        const close = 100 + Math.sin(index / 8) * 4 + index * 0.08;
        return {
          assetId: 'nvidia',
          timestamp: new Date(Date.UTC(2024, 0, 1 + index)),
          open: close - 0.5,
          high: close + 1.5,
          low: close - 1.5,
          close,
          volume: 1000,
        };
      });

      const tokens = {
        getStock: jest.fn().mockResolvedValue({
          id: 'nvidia',
          ticker: 'NVDA',
          name: 'NVIDIA',
          price: 120,
          variants: [],
        }),
        getCandlesForWindow: jest.fn().mockResolvedValue(dailyBars),
        getOHLCV: jest.fn(),
        getRisk: jest.fn().mockRejectedValue(new Error('no risk')),
      };
      const repository = {
        upsert: jest
          .fn()
          .mockImplementation((signals: StockSignals) =>
            Promise.resolve(signals),
          ),
        getByAssetId: jest.fn().mockResolvedValue(null),
        listByMinScore: jest.fn(),
      };
      if (persistenceFails) {
        repository.upsert.mockRejectedValueOnce(
          new Error('database unavailable'),
        );
      }
      const catalog = { findByAssetIds: jest.fn() };
      const news = {
        getEquityNews: jest.fn().mockResolvedValue({
          assetId: 'nvidia',
          items: [
            {
              headline: 'NVIDIA shares fall on guidance',
              publishedAt: new Date(),
            },
          ],
        }),
      };

      const service = new IntelligenceService(
        tokens as never,
        repository as never,
        catalog as never,
        news as never,
      );

      const analysis = await service.getAnalysis('nvidia');

      expect(analysis.summary).toContain('NVDA');
      expect(analysis.technicalBrief?.primaryTimeframe.timeframe).toBe('daily');
      expect(analysis.technicalBrief?.levels.length).toBeGreaterThan(0);
      expect(repository.upsert).toHaveBeenCalledWith(analysis.signals);
      expect(analysis.opportunityScore).toBe(analysis.signals.opportunityScore);
      expect(tokens.getCandlesForWindow).toHaveBeenCalled();
      expect(news.getEquityNews).toHaveBeenCalledWith('nvidia', { limit: 3 });
    },
  );

  it('still rejects when the stock provider fails', async () => {
    const failure = new Error('stock provider unavailable');
    const tokens = { getStock: jest.fn().mockRejectedValue(failure) };
    const repository = { upsert: jest.fn() };
    const service = new IntelligenceService(
      tokens as never,
      repository as never,
      {} as never,
      {} as never,
    );

    await expect(service.getAnalysis('nvidia')).rejects.toBe(failure);
    expect(repository.upsert).not.toHaveBeenCalled();
  });
});

describe('IntelligenceService analysis cache', () => {
  const now = new Date('2026-11-27T12:00:00Z');
  const signalTtl = 15 * 60 * 1000;

  function fixture() {
    let saved: StockSignals | null = null;
    const bars = Array.from({ length: 60 }, (_, index) => ({
      timestamp: new Date(now.getTime() - index * 24 * 60 * 60 * 1000),
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      volume: 1000,
    }));
    const tokens = {
      getStock: jest.fn().mockResolvedValue({
        id: 'nvidia',
        ticker: 'NVDA',
        name: 'NVIDIA',
        price: 120,
        variants: [],
      }),
      getCandlesForWindow: jest.fn().mockResolvedValue(bars),
      getRisk: jest.fn().mockResolvedValue({ label: 'moderate' }),
    };
    const repository = {
      getByAssetId: jest.fn().mockImplementation(() => Promise.resolve(saved)),
      upsert: jest.fn().mockImplementation((signals: StockSignals) => {
        saved = signals;
        return Promise.resolve(signals);
      }),
    };
    const news = { getEquityNews: jest.fn().mockResolvedValue({ items: [] }) };
    const service = new IntelligenceService(
      tokens as never,
      repository as never,
      {} as never,
      news as never,
    );
    return { service, tokens, repository, news, bars };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('coalesces misses, reuses the assembled value for 30 seconds, and retains its timestamp', async () => {
    const { service, tokens, repository, news } = fixture();
    const [first, concurrent] = await Promise.all([
      service.getAnalysis('nvidia'),
      service.getAnalysis('nvidia'),
    ]);
    expect(concurrent).toBe(first);
    await jest.advanceTimersByTimeAsync(29_999);
    const warm = await service.getAnalysis('nvidia');
    expect(warm).toBe(first);
    expect(warm.analyzedAt).toEqual(now);
    expect(tokens.getStock).toHaveBeenCalledTimes(1);
    expect(tokens.getCandlesForWindow).toHaveBeenCalledTimes(3);
    expect(news.getEquityNews).toHaveBeenCalledTimes(1);
    expect(repository.upsert).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    const expired = await service.getAnalysis('nvidia');
    expect(expired).not.toBe(first);
    expect(expired.analyzedAt.getTime()).toBe(now.getTime() + 30_000);
    expect(expired.signals).toBe(first.signals);
    // Only the two TA windows are refreshed; the 90-day signal computation is reused.
    expect(tokens.getCandlesForWindow).toHaveBeenCalledTimes(5);
    expect(news.getEquityNews).toHaveBeenCalledTimes(2);
    expect(repository.upsert).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(signalTtl - 30_000);
    const staleSignals = await service.getAnalysis('nvidia');
    expect(staleSignals.signals).not.toBe(first.signals);
    expect(tokens.getCandlesForWindow).toHaveBeenCalledTimes(8);
    expect(repository.upsert).toHaveBeenCalledTimes(2);
  });

  it('keeps assembled entries separate per asset and retries failed reads', async () => {
    const { service, tokens } = fixture();
    tokens.getStock.mockRejectedValueOnce(new Error('offline'));
    await expect(service.getAnalysis('nvidia')).rejects.toThrow('offline');
    await service.getAnalysis('nvidia');
    await service.getAnalysis('tesla');
    expect(tokens.getStock).toHaveBeenCalledTimes(3);
  });

  it('still computes live signals when reading app memory fails', async () => {
    const { service, repository } = fixture();
    repository.getByAssetId.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    const analysis = await service.getAnalysis('nvidia');
    expect(repository.upsert).toHaveBeenCalledWith(analysis.signals);
  });

  it.each([29, 30])(
    'rebuilds dimensions using %i finite daily closes inside the cached signal window',
    async (count) => {
      const { service, repository, tokens, bars } = fixture();
      const signals: StockSignals = {
        assetId: 'nvidia',
        ticker: 'NVDA',
        calculatedAt: now,
        momentum7d: 20,
        momentum30d: 0,
        volatility30d: 2,
        volumeTrend: 1,
        rsi14: 50,
        sma20: 110,
        sma50: 100,
        liquidityScore: 50,
        activityScore: 50,
        opportunityScore: 71,
      };
      repository.getByAssetId.mockResolvedValue(signals);
      const outsideWindow = bars.map((bar) => ({
        ...bar,
        timestamp: new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000),
      }));
      tokens.getCandlesForWindow.mockResolvedValue([
        ...bars.slice(0, count),
        ...outsideWindow,
        { ...bars[0], close: NaN },
      ]);
      const analysis = await service.getAnalysis('nvidia');
      // History is reconstructed from available finite TA closes in the original
      // 90-day signal window, never inferred from a zero 30-day momentum value.
      expect(analysis.highlights.includes('Limited history')).toBe(count < 30);
      expect(analysis.highlights.includes('Momentum + trend aligned')).toBe(
        count >= 30,
      );
      expect(analysis.opportunityScore).toBe(71);
      expect(analysis.signals).toBe(signals);
      expect(repository.upsert).not.toHaveBeenCalled();
      expect(tokens.getCandlesForWindow).toHaveBeenCalledTimes(2);
    },
  );
});
