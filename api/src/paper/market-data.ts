import type { MarketCandle } from '../../types/market';
import type { UsMarketSessionState } from '../../types/market-session';
import { usMarketSession } from '../market/us-market-session';

/**
 * Tokens.xyz `canonicalMarket.source` for stocks and ETFs mapped to a
 * one-share-per-token stock-market feed. `/price-chart` serves that feed first
 * for these assets, but it silently falls back to other sources when the feed
 * has no data, so the series shape is still checked below.
 */
export const STOCK_FEED_SOURCE = 'clickhouse_stock';

/** Hourly stock candles start between 04:00 and 20:00 New York time on NYSE trading days. */
const SESSION_STATES = new Set<UsMarketSessionState>([
  'pre_market',
  'regular',
  'after_hours',
  'early_close',
]);

/**
 * Highest share of off-session candles a stock-market series may contain. The
 * feed occasionally stamps a closing print on a Saturday; a round-the-clock
 * provider or on-chain series has roughly half its hourly candles and two
 * sevenths of its daily candles off-session.
 */
const MAX_OFF_SESSION_SHARE = { hourly: 0.05, daily: 0.15 } as const;

const NOON_UTC_OFFSET = 15 * 3_600_000;

/** True when an hourly candle starting at `ms` falls inside an NYSE trading day's 04:00-20:00 ET window. */
export function isStockSessionHour(ms: number): boolean {
  return SESSION_STATES.has(usMarketSession(new Date(ms)).state);
}

/** True when the UTC calendar date of a daily candle is an NYSE trading day. */
export function isNyseTradingDay(ms: number): boolean {
  const day = new Date(ms);
  const midday =
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) +
    NOON_UTC_OFFSET;
  return usMarketSession(new Date(midday)).state !== 'closed';
}

/**
 * Keep a `/price-chart` series only if it is stock-market data: candles inside
 * NYSE sessions, with at most a few stray off-session prints, which are
 * dropped. Returns null for an empty or round-the-clock series.
 */
export function stockSessionBars(
  candles: MarketCandle[],
  interval: 'hourly' | 'daily',
): { bars: MarketCandle[]; dropped: number } | null {
  if (!candles.length) return null;
  const inSession =
    interval === 'hourly' ? isStockSessionHour : isNyseTradingDay;
  const bars = candles.filter((c) => inSession(+c.timestamp));
  const dropped = candles.length - bars.length;
  if (
    !bars.length ||
    dropped > candles.length * MAX_OFF_SESSION_SHARE[interval]
  )
    return null;
  return { bars, dropped };
}
