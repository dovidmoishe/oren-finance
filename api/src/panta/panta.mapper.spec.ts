import { linkPantaStocks, mapPantaMarket } from './panta.mapper';

describe('Panta normalization', () => {
  it('preserves decimal precision and never assumes probabilities or $1 payouts', () => {
    const market = mapPantaMarket({
      marketId: 'market',
      title: 'NVDA vs AMD',
      phase: 'secondary',
      yesPrice: '0.123456789012345678901',
      noPrice: '0.6',
      volumeUsdc: '9007199254740993.123456',
      winningPayoutUsdc: '0.8',
    });
    expect(market.outcomes[0].priceUsdc).toBe('0.123456789012345678901');
    expect(market.volumeUsdc).toBe('9007199254740993.123456');
    expect(market.outcomes[0].winningPayoutUsdc).toBeNull();
    expect(market.outcomes[0].probability).toBeNull();
    expect(market.resolutionRule).toBeNull();
  });

  it('keeps catalog-only missing prices and rules unavailable', () => {
    const market = mapPantaMarket({
      marketId: 'market',
      title: 'Question',
      phase: 'resolved',
      resolved: true,
      startTime: 1767225600,
    });
    expect(market.phase).toBe('resolved');
    expect(market.resolved).toBe(true);
    expect(market.startTime).toBe('2026-01-01T00:00:00.000Z');
    expect(market.question).toBeNull();
    expect(market.outcomes[1].priceUsdc).toBeNull();
  });

  it('handles unknown phases and invalid optional numbers without fabricating values', () => {
    const market = mapPantaMarket({
      marketId: 'market',
      title: 'Question',
      phase: 'future_phase',
      startTime: 1e20,
      yesPrice: 0.52,
    });
    expect(market.phase).toBe('unknown');
    expect(market.providerPhase).toBe('future_phase');
    expect(market.startTime).toBeNull();
    expect(market.outcomes[0].priceUsdc).toBeNull();
  });

  it.each([null, [], {}, { marketId: 'id' }])(
    'rejects malformed identity: %p',
    (value) => {
      expect(() => mapPantaMarket(value)).toThrow('Invalid Panta response');
    },
  );

  it('links exact unambiguous tickers only, without company-name inference', () => {
    const directory = [
      { assetId: 'nvidia', ticker: 'NVDA' },
      { assetId: 'amd-1', ticker: 'AMD' },
      { assetId: 'amd-2', ticker: 'AMD' },
    ];
    expect(linkPantaStocks('NVDA versus AMD', directory)).toEqual([
      directory[0],
    ]);
    expect(linkPantaStocks('Nvidia versus amd or XNVDA', directory)).toEqual(
      [],
    );
    expect(
      mapPantaMarket({ marketId: 'id', title: 'NVDA' }).stockLinks,
    ).toEqual([]);
  });
});
