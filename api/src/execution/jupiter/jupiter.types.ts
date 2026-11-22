/** Raw Jupiter Swap API v1 quote response (subset we care about). */
export interface JupiterQuoteRaw {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold?: string;
  swapMode?: string;
  slippageBps: number;
  instructionVersion?: 'V1' | 'V2';
  platformFee?: { amount: string; feeBps: number } | null;
  /** Ratio from 0 to 1. `0.01` is 1% price impact. */
  priceImpactPct?: string | number;
  routePlan?: {
    swapInfo: Record<string, unknown>;
    percent?: number | null;
    /** V2's canonical split weight, in basis points. */
    bps?: number;
  }[];
  contextSlot?: number;
  // Full payload is retained as routePayload for /swap
  [key: string]: unknown;
}

export interface JupiterSwapRaw {
  swapTransaction: string;
  lastValidBlockHeight?: number;
  prioritizationFeeLamports?: number;
}
