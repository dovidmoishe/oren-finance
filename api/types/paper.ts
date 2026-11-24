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

export const PAPER_MODEL = {
  version: 'long-only-v1',
  startingUsdcRaw: '10000000000',
  entryCashBps: 1000,
  slippageBps: 50,
  costAllowanceBps: 20,
  fixedCostUsdcRaw: '10000',
} as const;

export interface PaperBar {
  time: number;
  high: number;
  low: number;
  close: number;
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
  tools: string[];
  rationale: string;
  selected: 'breakout-v1' | 'pullback-v1' | 'cash' | null;
  error?: string;
}
