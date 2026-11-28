import { TokensService } from './tokens.service';

describe('TokensService candle fetching', () => {
  it('falls back to OHLCV with the best tradable mint when price-chart is empty', async () => {
    const client = {
      get: jest
        .fn()
        .mockResolvedValueOnce({ candles: [] })
        .mockResolvedValueOnce({
          assetId: 'cost',
          ticker: 'COST',
          category: 'equity',
          variants: [
            {
              mint: 'mint-cost',
              symbol: 'COST',
              tradable: true,
              liquidity: 100000,
            },
          ],
        })
        .mockResolvedValueOnce({
          candles: [
            {
              timestamp: 1_700_000_000,
              open: 900,
              high: 905,
              low: 895,
              close: 902,
              volume: 1000,
            },
          ],
        }),
    };

    const service = new TokensService(client as never);
    const candles = await service.getCandlesForWindow('cost', {
      interval: '1D',
      from: 1_600_000_000,
      to: 1_700_000_000,
    });

    expect(candles).toHaveLength(1);
    expect(client.get).toHaveBeenCalledTimes(3);
    expect(client.get).toHaveBeenNthCalledWith(
      3,
      '/assets/cost/ohlcv',
      expect.objectContaining({
        interval: '1D',
        mint: 'mint-cost',
      }),
    );
  });

  it('reads the canonical chart for a pinned mint without falling back and sorts it', async () => {
    const client = {
      get: jest.fn().mockResolvedValueOnce({
        candles: [
          { time: 1_700_003_600, open: 2, high: 2, low: 2, close: 2 },
          { time: 1_700_000_000, open: 1, high: 1, low: 1, close: 1 },
        ],
      }),
    };
    const service = new TokensService(client as never);
    const window = {
      interval: '1H' as const,
      from: 1_699_990_000,
      to: 1_700_010_000,
    };
    const candles = await service.getCanonicalCandles(
      'nvidia',
      window,
      'mint-nvda',
    );
    expect(candles.map((c) => c.close)).toEqual([1, 2]);
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.get).toHaveBeenCalledWith('/assets/nvidia/price-chart', {
      ...window,
      mint: 'mint-nvda',
    });
    client.get.mockResolvedValueOnce({ candles: [] });
    await expect(
      service.getCanonicalCandles('nvidia', window),
    ).resolves.toEqual([]);
    expect(client.get).toHaveBeenCalledTimes(2);
  });
});
