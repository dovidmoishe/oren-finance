/**
 * Equity / market news from Tokens API (and optional cached_news).
 */
export interface MarketNewsItem {
  id?: string;
  assetId?: string;
  ticker?: string;
  headline: string;
  source?: string;
  summary?: string;
  url?: string;
  publishedAt: Date;
  imageUrl?: string;
}

export interface EquityRisk {
  assetId: string;
  ticker: string;
  /** Provider-defined risk metrics — keep flexible for Tokens API shape. */
  score?: number;
  label?: string;
  volatility?: number;
  metadata?: Record<string, unknown>;
}

export interface NewsFeed {
  assetId?: string;
  items: MarketNewsItem[];
}

export interface NewsContext {
  assetIds: string[];
  items: MarketNewsItem[];
  generatedAt: Date;
}

export interface NewsFeedStock {
  assetId: string;
  ticker: string;
  name: string;
}

export interface CuratedNewsStory {
  id: string;
  headline: string;
  summary?: string;
  source: string;
  url: string;
  publishedAt: string;
  stocks: NewsFeedStock[];
}

export interface CuratedNewsFeed {
  items: CuratedNewsStory[];
  selection: 'agent' | 'latest';
  state: 'ready' | 'no_holdings' | 'no_news';
  stocks: NewsFeedStock[];
  totalHoldings: number;
  partial: boolean;
  generatedAt: string;
}
