export type ChartRange = "1D" | "1W" | "1M" | "3M" | "1Y" | "ALL";

export interface TokenizedEquityVariant {
  mint: string;
  symbol: string;
  name: string;
  issuer?: string;
  decimals?: number;
  liquidity?: number;
  liquidityTier?: string;
  trustTier?: string;
  tradable: boolean;
}

export interface StockSummary {
  assetId: string;
  ticker: string;
  name: string;
  logoUrl?: string;
  category?: "equity" | "etf" | "index";
  priceUsd?: number;
  change24hPct?: number;
  volume24hUsd?: number;
  liquidityUsd?: number;
  opportunityScore?: number;
}

export interface StocksPage {
  items: StockSummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export interface StockDetail extends StockSummary {
  sector?: string;
  variants: TokenizedEquityVariant[];
}

export interface MarketCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface StockSignals {
  assetId: string;
  ticker: string;
  momentum7d?: number;
  momentum30d?: number;
  volatility30d?: number;
  volumeTrend?: number;
  rsi14?: number;
  sma20?: number;
  sma50?: number;
  liquidityScore?: number;
  activityScore?: number;
  opportunityScore: number;
  calculatedAt: string;
}

export interface StockAnalysis {
  assetId: string;
  ticker: string;
  name?: string;
  opportunityScore: number;
  summary?: string;
  signals: StockSignals;
  highlights: string[];
  riskLabel?: "low" | "moderate" | "elevated" | "high";
  analyzedAt: string;
}

export interface NewsItem {
  id: string;
  assetId?: string;
  ticker?: string;
  headline: string;
  source?: string;
  url?: string;
  summary?: string;
  publishedAt: string;
  imageUrl?: string;
}
