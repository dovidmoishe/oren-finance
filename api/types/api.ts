import type { ActivityFeed } from './activity';
import type { AgentChatRequest, AgentChatResponse } from './agent';
import type { StockAnalysis, StockOpportunity } from './analysis';
import type { Equity, EquitySummary } from './equity';
import type {
  Basket,
  PreparedTransaction,
  QuoteRequest,
  TradeIntent,
} from './execution';
import type { ChartRange, ChartSeries, MarketMover, MarketsOverview } from './market';
import type { MarketNewsItem, NewsFeed } from './news';
import type { Portfolio, PortfolioHistory } from './portfolio';
import type { Quote } from './quote';
import type { StockSignals } from './signals';
import type {
  LockIntent,
  PreparedVaultTransaction,
  UnlockIntent,
  VaultSummary,
} from './vault';

/** GET /portfolio/:wallet */
export type GetPortfolioResponse = Portfolio;

/** GET /portfolio/:wallet/history */
export type GetPortfolioHistoryResponse = PortfolioHistory;

/** GET /portfolio/:wallet/activity */
export type GetPortfolioActivityResponse = ActivityFeed;

/** GET /stocks */
export type GetStocksResponse = EquitySummary[];

/** GET /stocks/search?q= */
export interface SearchStocksQuery {
  q: string;
}

export type SearchStocksResponse = EquitySummary[];

/** GET /stocks/:assetId */
export type GetStockResponse = Equity;

/** GET /stocks/:assetId/chart?range= */
export interface GetStockChartQuery {
  range?: ChartRange;
}

export type GetStockChartResponse = ChartSeries;

/** GET /stocks/:assetId/news */
export type GetStockNewsResponse = NewsFeed | MarketNewsItem[];

/** GET /stocks/:assetId/analysis */
export type GetStockAnalysisResponse = StockAnalysis;

/** GET /markets/trending */
export type GetMarketTrendingResponse = MarketMover[];

/** GET /markets/opportunities */
export type GetMarketOpportunitiesResponse = StockOpportunity[];

/** Optional aggregate */
export type GetMarketsOverviewResponse = MarketsOverview;

/** GET /signals/:assetId (internal / agent) */
export type GetSignalsResponse = StockSignals;

/** POST /execution/quote */
export type PostExecutionQuoteRequest = TradeIntent | QuoteRequest;

export type PostExecutionQuoteResponse = Quote;

/** POST /execution/prepare */
export interface PostExecutionPrepareRequest {
  quoteId: string;
  wallet: string;
}

export type PostExecutionPrepareResponse = PreparedTransaction;

/** POST /execution/basket (P1) */
export interface PostBasketRequest {
  amountUsd: number;
  prompt: string;
  wallet?: string;
}

export type PostBasketResponse = Basket;

/** GET /vaults/:wallet */
export type GetVaultsResponse = VaultSummary;

/** POST /vaults/prepare-lock */
export type PostPrepareLockRequest = LockIntent;

export type PostPrepareLockResponse = PreparedVaultTransaction;

/** POST /vaults/prepare-unlock */
export type PostPrepareUnlockRequest = UnlockIntent;

export type PostPrepareUnlockResponse = PreparedVaultTransaction;

/** POST /agent/message */
export type PostAgentMessageRequest = AgentChatRequest;

export type PostAgentMessageResponse = AgentChatResponse;
