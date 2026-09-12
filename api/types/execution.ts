import type { TokenizedEquity } from './equity';
import type { Quote, TradeSide } from './quote';

export type ExecutionType =
  | 'stock_purchase'
  | 'stock_sale'
  | 'basket_purchase'
  | 'lock'
  | 'unlock';

export type ExecutionStatus =
  | 'preparing'
  | 'awaiting_signature'
  | 'submitted'
  | 'confirming'
  | 'confirmed'
  | 'failed';

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
  createdAt: Date;
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
  error?: string;
}

export interface BasketExecutionProgress {
  basketId: string;
  legs: BasketLegProgress[];
}
