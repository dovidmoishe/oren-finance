import { LandingMarketService } from './landing-market.service';

describe('landing market snapshots', () => {
  it('shares one provider refresh across visitors and keeps all market scenes in one snapshot', async () => {
    const tokens = {
      getStock: jest.fn((id: string) =>
        Promise.resolve({
          id,
          ticker: id,
          name: id,
          price: 200,
          priceChange24h: -3,
        }),
      ),
      getPriceChart: jest
        .fn()
        .mockResolvedValue([{ close: 205 }, { close: 200 }]),
    };
    const intelligence = {
      getAnalysis: jest.fn().mockResolvedValue({
        opportunityScore: 40,
        signals: { momentum7d: -2 },
      }),
    };
    const service = new LandingMarketService(
      tokens as never,
      intelligence as never,
    );
    const [one, two] = await Promise.all([
      service.getSnapshot(),
      service.getSnapshot(),
    ]);
    expect(tokens.getStock).toHaveBeenCalledTimes(4);
    expect(tokens.getPriceChart).toHaveBeenCalledTimes(1);
    expect(intelligence.getAnalysis).toHaveBeenCalledTimes(1);
    expect(one).toEqual(two);
    expect(one.data.stocks[0].priceChange24h).toBe(-3);
  });
  it('rejects incomplete data instead of presenting sample values as current data', async () => {
    const tokens = {
      getStock: jest.fn().mockResolvedValue({ price: 0 }),
      getPriceChart: jest.fn().mockResolvedValue([]),
    };
    const service = new LandingMarketService(
      tokens as never,
      { getAnalysis: jest.fn().mockResolvedValue({}) } as never,
    );
    await expect(service.getSnapshot()).rejects.toThrow('Incomplete');
  });
});
