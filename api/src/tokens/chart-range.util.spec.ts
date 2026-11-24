import { chartRangeToWindow } from './chart-range.util';
import type { ChartInterval } from '../../types/market';

describe('chart windows', () => {
  it.each<[ChartInterval, number]>([
    ['1m', 60],
    ['5m', 300],
    ['15m', 900],
    ['1H', 3600],
    ['4H', 14400],
    ['1D', 86400],
  ])(
    'bounds explicit %s interval reads to 200 candles',
    (interval, seconds) => {
      const result = chartRangeToWindow('1Y', interval);
      expect(result.interval).toBe(interval);
      expect(result.to - result.from).toBe(200 * seconds);
    },
  );

  it('keeps range-only callers on the original candle windows', () => {
    const result = chartRangeToWindow('1W');
    expect(result.interval).toBe('4H');
    expect(result.to - result.from).toBe(7 * 86400);
  });
});
