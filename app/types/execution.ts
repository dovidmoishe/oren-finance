export type TradeSide = "buy" | "sell";

export interface TradeIntent {
  wallet: string;
  assetId: string;
  side: TradeSide;
  amountUsd?: number;
  quantity?: number;
  slippageBps?: number;
}

export interface QuoteResponse {
  quoteId: string;
  assetId: string;
  ticker: string;
  side: TradeSide;
  inputAmount: string;
  outputAmount: string;
  estimatedPriceUsd?: number;
  priceImpactPct?: number;
  expiresAt: string;
  routeSummary?: string;
}

export interface PreparedTransaction {
  executionId: string;
  quoteId?: string;
  transactionBase64: string;
  expiresAt?: string;
  review: {
    title: string;
    rows: Array<{ label: string; value: string }>;
    warnings?: string[];
  };
}

export interface ConfirmExecutionRequest {
  wallet: string;
  executionId: string;
  signature: string;
}

export interface ExecutionStatus {
  executionId: string;
  status: "prepared" | "submitted" | "confirmed" | "failed" | "expired";
  signature?: string;
  updatedAt: string;
}

export interface BasketIntent {
  wallet: string;
  prompt?: string;
  amountUsd: number;
  allocations?: Array<{ assetId: string; weightPct: number }>;
}

export interface BasketResponse {
  basketId: string;
  thesis: string;
  riskLabel: string;
  legs: Array<{
    assetId: string;
    ticker: string;
    weightPct: number;
    amountUsd: number;
    rationale?: string;
  }>;
}
