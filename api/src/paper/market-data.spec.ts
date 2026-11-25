import type { MarketCandle } from '../../types/market';
import {
  isNyseTradingDay,
  isStockSessionHour,
  stockSessionBars,
} from './market-data';
import { DAY, HOUR } from './strategy';

const candle = (ms: number, close = 100): MarketCandle => ({
  timestamp: new Date(ms),
  open: close,
  high: close + 1,
  low: close - 1,
  close,
});
const at = (iso: string) => Date.parse(iso);

/** Hourly stock candles for November 2026 weekdays: 04:00-19:00 ET is 09:00Z through 00:00Z. */
function sessionHours(days: string[]): MarketCandle[] {
  return days.flatMap((day) =>
    Array.from({ length: 16 }, (_, i) =>
      candle(at(`${day}T09:00:00Z`) + i * HOUR, 100 + i / 10),
    ),
  );
}
const weekdays = [
  '2026-11-16',
  '2026-11-17',
  '2026-11-18',
  '2026-11-19',
  '2026-11-20',
  '2026-11-23',
  '2026-11-24',
];

describe('NYSE session filter for stock-market candles', () => {
  it('places hourly candle starts inside the extended NYSE day in New York time', () => {
    expect(isStockSessionHour(at('2026-11-25T09:00:00Z'))).toBe(true); // 04:00 ET
    expect(isStockSessionHour(at('2026-11-25T14:00:00Z'))).toBe(true); // 09:00 ET
    expect(isStockSessionHour(at('2026-11-26T00:00:00Z'))).toBe(true); // 19:00 ET Wednesday
    expect(isStockSessionHour(at('2026-11-25T08:00:00Z'))).toBe(false); // 03:00 ET
    expect(isStockSessionHour(at('2026-11-26T01:00:00Z'))).toBe(false); // 20:00 ET
    expect(isStockSessionHour(at('2026-11-26T15:00:00Z'))).toBe(false); // Thanksgiving
    expect(isStockSessionHour(at('2026-11-27T19:00:00Z'))).toBe(true); // after the 13:00 early close
    expect(isStockSessionHour(at('2026-11-21T14:00:00Z'))).toBe(false); // Saturday
  });

  it('dates daily candles by their UTC calendar day', () => {
    expect(isNyseTradingDay(at('2026-11-25T00:00:00Z'))).toBe(true);
    expect(isNyseTradingDay(at('2026-11-26T00:00:00Z'))).toBe(false);
    expect(isNyseTradingDay(at('2026-11-27T00:00:00Z'))).toBe(true);
    expect(isNyseTradingDay(at('2026-11-28T00:00:00Z'))).toBe(false);
  });

  it('keeps a session-shaped hourly series and drops a Saturday closing print', () => {
    const series = [
      ...sessionHours(weekdays),
      candle(at('2026-11-21T14:00:00Z'), 125.61),
    ].sort((a, b) => +a.timestamp - +b.timestamp);
    const kept = stockSessionBars(series, 'hourly');
    expect(kept?.dropped).toBe(1);
    expect(kept?.bars).toHaveLength(series.length - 1);
    expect(kept?.bars.some((b) => b.close === 125.61)).toBe(false);
  });

  it('rejects round-the-clock and empty hourly series', () => {
    const start = at('2026-11-15T00:00:00Z');
    const allDay = Array.from({ length: 240 }, (_, i) =>
      candle(start + i * HOUR),
    );
    expect(stockSessionBars(allDay, 'hourly')).toBeNull();
    expect(stockSessionBars([], 'hourly')).toBeNull();
  });

  it('keeps trading-day daily candles, drops weekend and holiday prints, and rejects a 24/7 series', () => {
    const start = at('2026-09-21T00:00:00Z');
    const everyDay = Array.from({ length: 67 }, (_, i) =>
      candle(start + i * DAY),
    );
    const tradingDays = everyDay.filter((c) => {
      const weekday = c.timestamp.getUTCDay();
      return (
        weekday !== 0 &&
        weekday !== 6 &&
        c.timestamp.toISOString() !== '2026-11-26T00:00:00.000Z'
      );
    });
    const prints = [
      candle(at('2026-11-21T00:00:00Z'), 125.61),
      candle(at('2026-11-26T00:00:00Z'), 149.08),
    ];
    const kept = stockSessionBars([...tradingDays, ...prints], 'daily');
    expect(kept?.dropped).toBe(2);
    expect(kept?.bars).toHaveLength(tradingDays.length);
    expect(stockSessionBars(everyDay, 'daily')).toBeNull();
  });
});
