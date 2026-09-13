import { rowToSignals, type StockSignalRow } from './signals.repository';

describe('signals.repository mapping', () => {
  it('maps numeric strings to numbers', () => {
    const row = {
      id: '1',
      assetId: 'aapl',
      ticker: 'AAPL',
      momentum7d: '1.5',
      momentum30d: '3.25',
      volatility30d: '2.1',
      volumeTrend: '1.2',
      rsi14: '55.5',
      sma20: '190',
      sma50: '185',
      liquidityScore: '70',
      activityScore: '65',
      opportunityScore: '72.5',
      calculatedAt: new Date('2026-01-01T00:00:00Z'),
    } as StockSignalRow;

    const signals = rowToSignals(row);
    expect(signals.momentum7d).toBe(1.5);
    expect(signals.opportunityScore).toBe(72.5);
    expect(signals.ticker).toBe('AAPL');
  });
});
