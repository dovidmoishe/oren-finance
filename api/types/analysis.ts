import type { MarketNewsItem } from './news';
import type { StockSignals } from './signals';

/**
 * Structured quantitative analysis for a canonical equity.
 * Signals are computed deterministically; narrative explains them.
 */
export interface StockAnalysis {
  assetId: string;
  ticker: string;
  name?: string;
  opportunityScore: number;
  signals: StockSignals;
  /** Short human-readable drivers behind the score. */
  highlights: string[];
  summary?: string;
  riskLabel?: 'low' | 'moderate' | 'elevated' | 'high';
  news?: MarketNewsItem[];
  analyzedAt: Date;
}

/** Ranked opportunity row for markets discovery. */
export interface StockOpportunity {
  assetId: string;
  ticker: string;
  name: string;
  logo?: string;
  opportunityScore: number;
  price: number;
  priceChange24h: number;
  highlights: string[];
  signals: Pick<
    StockSignals,
    | 'momentum7d'
    | 'momentum30d'
    | 'volatility30d'
    | 'rsi14'
    | 'volumeTrend'
    | 'liquidityScore'
    | 'activityScore'
  >;
}
