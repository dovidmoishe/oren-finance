export const PAPER_STRATEGIES = [
  'breakout-v1',
  'pullback-v1',
  'buy-hold-v1',
] as const;
export type PaperStrategy = (typeof PAPER_STRATEGIES)[number];
export type PaperSignal = 'buy' | 'hold' | 'sell';

/** Monetary and token amounts use integer strings in the mint's smallest units. */
export interface PaperBook {
  cash: string;
  position: string;
}

/**
 * Paper fills use the route's expected output (Jupiter `outAmount`, which
 * already reflects the pool spread and price impact), less a 1 bp allowance
 * and a flat 0.01 USDC per fill. `slippageBps` is only the tolerance requested
 * with each quote. v1 filled at the worst-case floor less 20 bps, which cost
 * about 1.4% per round trip before any price move.
 */
export const PAPER_MODEL = {
  version: 'long-only-v2',
  startingUsdcRaw: '10000000000',
  entryCashBps: 1000,
  slippageBps: 50,
  costAllowanceBps: 1,
  fixedCostUsdcRaw: '10000',
} as const;

export interface PaperBar {
  time: number;
  high: number;
  low: number;
  close: number;
  /** Candle volume when the source reports it. */
  volume?: number;
}

export interface PaperQuoteTerms {
  inputMint: string;
  outputMint: string;
  input: string;
  quotedOutput: string;
  minimumOutput: string;
  slot: number | null;
}
export interface ObservedPaperQuote extends PaperQuoteTerms {
  requestedAt: number;
  receivedAt: number;
}
export interface PaperValuation {
  book: PaperBook;
  liquidationEquityUsdcRaw: string | null;
}
export interface PaperJournalEntry {
  mode: 'paper';
  modelVersion: string;
  source: string;
  strategy: PaperStrategy;
  mint: string;
  asOf: string;
  rows: PaperBar[];
  before: PaperBook;
  signal: PaperSignal;
  terms: ObservedPaperQuote | null;
  exitMark: ObservedPaperQuote | null;
  result: PaperValuation | null;
  error: string | null;
}

export interface PaperResearch {
  version: string;
  model: string;
  /** Evidence tools the v1 agent called. v3 reviews send the evidence in one request. */
  tools?: string[];
  rationale: string;
  selected: 'breakout-v1' | 'pullback-v1' | 'cash' | null;
  error?: string;
}
