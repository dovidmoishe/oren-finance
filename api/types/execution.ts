import type { TokenizedEquity } from './equity';
import type { Quote, TradeSide } from './quote';
import type { StockOpportunity } from './analysis';

export type ExecutionType =
  | 'stock_purchase'
  | 'stock_sale'
  | 'basket_purchase'
  | 'lock'
  | 'unlock'
  | 'limit_buy'
  | 'limit_sell'
  | 'limit_cancel';

export type ExecutionStatus =
  | 'preparing'
  | 'awaiting_signature'
  | 'submitted'
  | 'confirming'
  | 'confirmed'
  | 'failed';

export type ExecutionFeature =
  | 'direct'
  | 'agent'
  | 'basket'
  | 'copy_trade'
  | 'limit_order';

/** Intent in canonical-equity terms (before mint / Jupiter resolution). */
export interface TradeIntent {
  side: TradeSide;
  assetId?: string;
  ticker: string;
  amountUsd?: number;
  amount?: number;
  preferredMint?: string;
  slippageBps?: number;
}

export interface QuoteRequest {
  side: TradeSide;
  inputMint: string;
  outputMint: string;
  /** Amount in input token UI units. */
  amount: number;
  slippageBps?: number;
  wallet?: string;
  assetId?: string;
  ticker?: string;
}

export interface PreparedTransaction {
  executionId: string;
  quoteId: string;
  wallet: string;
  /** Base64-serialized transaction for wallet signing. */
  transaction: string;
  provider: string;
  expiresAt: Date;
}

export interface BasketAllocation {
  assetId: string;
  ticker: string;
  name?: string;
  amountUsd: number;
  weightPercent: number;
  opportunityScore?: number;
  rationale?: string;
}

export interface Basket {
  id: string;
  totalAmountUsd: number;
  allocations: BasketAllocation[];
  thesis?: string;
  riskLabel?: string;
  featureSource?: Extract<ExecutionFeature, 'basket' | 'copy_trade'>;
  createdAt: Date;
}

export interface BasketCandidate {
  assetId: string;
  ticker: string;
  name?: string;
  opportunityScore: number;
  logo?: string;
  signals?: StockOpportunity['signals'];
}

export type BasketLegStatus =
  | 'waiting'
  | 'quoting'
  | 'awaiting_signature'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'skipped';

export interface BasketLegProgress {
  assetId: string;
  ticker: string;
  status: BasketLegStatus;
  quote?: Quote;
  variant?: TokenizedEquity;
  preparedTransaction?: PreparedTransaction;
  error?: string;
}

export interface BasketExecutionProgress {
  basketId: string;
  wallet?: string;
  legs: BasketLegProgress[];
}

export interface PreparedBasketPurchase {
  basketId: string;
  wallet: string;
  transactions: PreparedTransaction[];
  progress: BasketExecutionProgress;
}
