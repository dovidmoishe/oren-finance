import type { ActivityFeed } from './activity';
import type { StockAnalysis, StockOpportunity } from './analysis';
import type { Equity, EquitySummary } from './equity';
import type { Basket, PreparedTransaction } from './execution';
import type { ChartSeries } from './market';
import type { MarketNewsItem } from './news';
import type { Portfolio } from './portfolio';
import type { Quote } from './quote';
import type { StockSignals } from './signals';
import type { PreparedVaultTransaction, VaultSummary } from './vault';

export type AgentMessageRole = 'user' | 'assistant' | 'tool' | 'system';

export interface AgentThread {
  id: string;
  walletAddress: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentMessage {
  id: string;
  threadId: string;
  role: AgentMessageRole;
  content: string;
  toolName?: string;
  toolPayload?: unknown;
  createdAt: Date;
}

export interface AgentChatRequest {
  walletAddress: string;
  threadId?: string;
  message: string;
}

export interface AgentChatResponse {
  threadId: string;
  message: AgentMessage;
  artifacts?: AgentArtifact[];
}

export type AgentArtifact =
  | { type: 'basket'; data: Basket }
  | { type: 'quote'; data: Quote }
  | { type: 'analysis'; data: StockAnalysis }
  | { type: 'prepared_swap'; data: PreparedTransaction }
  | { type: 'prepared_lock'; data: PreparedVaultTransaction }
  | { type: 'prepared_unlock'; data: PreparedVaultTransaction }
  | { type: 'opportunities'; data: StockOpportunity[] };

/**
 * Agent tool contracts — results must be grounded in Oren services.
 */
export interface AgentTools {
  getPortfolio(wallet: string): Promise<Portfolio>;

  getPortfolioActivity(wallet: string): Promise<ActivityFeed>;

  getStock(assetIdOrTicker: string): Promise<Equity>;

  getStockChart(
    assetIdOrTicker: string,
    range?: string,
  ): Promise<ChartSeries>;

  getStockNews(assetIdOrTicker: string): Promise<MarketNewsItem[]>;

  analyzeStock(assetIdOrTicker: string): Promise<StockAnalysis>;

  searchStocks(query: string): Promise<EquitySummary[]>;

  findOpportunities(input?: {
    category?: string;
    sector?: string;
    minScore?: number;
    limit?: number;
  }): Promise<StockOpportunity[]>;

  createBasket(input: {
    amountUsd: number;
    prompt: string;
    wallet?: string;
  }): Promise<Basket>;

  getSwapQuote(input: {
    side: 'buy' | 'sell';
    ticker: string;
    amountUsd?: number;
    amount?: number;
  }): Promise<Quote>;

  prepareSwap(quoteId: string, wallet: string): Promise<PreparedTransaction>;

  prepareBasketPurchase(
    basketId: string,
    wallet: string,
  ): Promise<PreparedTransaction[]>;

  getVaults(wallet: string): Promise<VaultSummary>;

  prepareLock(input: {
    wallet: string;
    asset: string;
    amount: number;
    unlockAt: Date;
  }): Promise<PreparedVaultTransaction>;

  prepareUnlock(input: {
    wallet: string;
    lockAddress: string;
  }): Promise<PreparedVaultTransaction>;

  getSignals(assetIdOrTicker: string): Promise<StockSignals>;
}
