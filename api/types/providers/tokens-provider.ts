import type { Equity, TokenizedEquity } from '../equity';
import type { ChartRange, MarketCandle, OhlcvBar } from '../market';
import type { MarketNewsItem, EquityRisk } from '../news';

/**
 * Tokens API service surface (Nest TokensService).
 * Rest of Oren consumes normalized domain objects — not raw Tokens responses.
 */
export interface TokensService {
  getStocks(): Promise<Equity[]>;

  searchStocks(query: string): Promise<Equity[]>;

  getStock(assetId: string): Promise<Equity>;

  getVariants(assetId: string): Promise<TokenizedEquity[]>;

  resolveMint(mint: string): Promise<Equity | null>;

  getCurrentMarketData(assetId: string): Promise<Equity>;

  getPriceChart(assetId: string, range: ChartRange): Promise<MarketCandle[]>;

  getOHLCV(
    assetId: string,
    params?: { start?: Date; end?: Date; timeframe?: string },
  ): Promise<OhlcvBar[]>;

  getTrendingStocks(): Promise<Equity[]>;

  getRisk(assetId: string): Promise<EquityRisk>;

  getNews(assetId?: string): Promise<MarketNewsItem[]>;
}
