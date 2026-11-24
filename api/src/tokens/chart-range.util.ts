import type { ChartInterval, ChartRange } from '../../types/market';

export interface ChartWindow {
  interval: '1m' | '5m' | '15m' | '1H' | '4H' | '1D' | '1W';
  from: number;
  to: number;
}

const DAY = 24 * 60 * 60;

export function chartRangeToWindow(
  range: ChartRange,
  interval?: ChartInterval,
): ChartWindow {
  const to = Math.floor(Date.now() / 1000);
  if (interval) {
    const seconds: Record<ChartInterval, number> = {
      '1m': 60,
      '5m': 300,
      '15m': 900,
      '1H': 3600,
      '4H': 14400,
      '1D': DAY,
    };
    // Explicit interval requests use a bounded window independent of lookback tabs.
    return { interval, from: to - 200 * seconds[interval], to };
  }

  switch (range) {
    case '1D':
      return { interval: '1H', from: to - DAY, to };
    case '1W':
      return { interval: '4H', from: to - 7 * DAY, to };
    case '1M':
      return { interval: '1D', from: to - 30 * DAY, to };
    case '3M':
      return { interval: '1D', from: to - 90 * DAY, to };
    case '1Y':
      return { interval: '1D', from: to - 365 * DAY, to };
    case 'ALL':
      return { interval: '1W', from: to - 5 * 365 * DAY, to };
    default:
      return { interval: '1D', from: to - 30 * DAY, to };
  }
}
