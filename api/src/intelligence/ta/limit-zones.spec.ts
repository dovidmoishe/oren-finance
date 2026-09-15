import { buildLimitZones } from './limit-zones';

describe('buildLimitZones', () => {
  it('prefers swing support/resistance for buy and sell zones', () => {
    const zones = buildLimitZones({
      price: 100,
      levels: [
        { price: 92, label: 'support', distancePct: -8 },
        { price: 110, label: 'resistance', distancePct: 10 },
      ],
      bollinger: { upper: 108, middle: 100, lower: 90, bandwidth: 18 },
      atr14: 4,
    });

    expect(zones).toHaveLength(2);
    expect(zones[0]).toMatchObject({
      side: 'buy',
      preferredUsd: 92,
      basis: 'swing_support',
    });
    expect(zones[1]).toMatchObject({
      side: 'sell',
      preferredUsd: 110,
      basis: 'swing_resistance',
    });
  });

  it('falls back to Bollinger bands when swings are missing', () => {
    const zones = buildLimitZones({
      price: 100,
      levels: [],
      bollinger: { upper: 112, middle: 100, lower: 88, bandwidth: 24 },
      atr14: 2,
    });

    expect(zones.find((zone) => zone.side === 'buy')?.basis).toBe(
      'bollinger_lower',
    );
    expect(zones.find((zone) => zone.side === 'sell')?.basis).toBe(
      'bollinger_upper',
    );
  });

  it('omits invalid sides when no level exists', () => {
    const zones = buildLimitZones({
      price: 100,
      levels: [{ price: 105, label: 'resistance', distancePct: 5 }],
      bollinger: { upper: 0, middle: 0, lower: 0, bandwidth: 0 },
    });

    expect(zones.map((zone) => zone.side)).toEqual(['sell']);
  });
});
