import type { TokenizedEquity } from './equity';

export type TradeSide = 'buy' | 'sell';

/**
 * Executable swap quote (Jupiter).
 * Distinct from indicative Tokens API market prices.
 */
export interface Quote {
  id: string;
  side: TradeSide;
  assetId: string;
  ticker: string;
  variant: TokenizedEquity;

  inputMint: string;
  outputMint: string;
  inputSymbol: string;
  outputSymbol: string;

  inputAmount: number;
  outputAmount: number;
  estimatedPriceUsd: number;
  amountUsd: number;

  priceImpactPercent: number;
  networkFeeUsd?: number;
  slippageBps: number;

  /** Execution venue — typically "jupiter" for MVP. */
  provider: string;
  /** Opaque provider route payload needed to prepare the tx. */
  routePayload?: unknown;
  expiresAt: Date;
  quotedAt: Date;
}
