import type { UsMarketSessionState } from './market-session';
import type {
  ObservedPaperQuote,
  PaperBar,
  PaperResearch,
  PaperSignal,
} from './paper';

/**
 * Where an observation's candles came from. `stock`: Tokens.xyz stock-market
 * candles for a mapped stock, kept to NYSE sessions. `token`: on-chain candles
 * for the held or traded mint.
 */
export type PaperBarSource = 'stock' | 'token';

/**
 * Exit levels for one holding, stated as the position's own quoted sale value
 * (USDC smallest units). Derived from the strategy's exit prices and refreshed
 * whenever fresh, valid candles are available, so the live token quote can be
 * checked against them in every review, including while US markets are closed.
 */
export interface PaperExitGuard {
  stopUsdcRaw: string;
  targetUsdcRaw?: string;
  source: PaperBarSource;
  /** Latest price of the candle series and the position's quoted value when the levels were set. */
  referencePrice: number;
  referenceValueUsdcRaw: string;
  setAt: string;
}
/** The first cohort (`five-ai-v1`, hourly-swing-v1/v2). Kept in the table and reported as an archive. */
export const legacyAiAccountIds = [
  'trader-1',
  'trader-2',
  'trader-3',
  'trader-4',
  'trader-5',
] as const;
/** The `five-ai-v2` cohort: five AI-reviewed traders and one rules-only baseline on the same scan. */
export const aiAccountIds = [
  'v2-trader-1',
  'v2-trader-2',
  'v2-trader-3',
  'v2-trader-4',
  'v2-trader-5',
  'v2-rules',
] as const;
export type AiAccountId =
  (typeof aiAccountIds)[number] | (typeof legacyAiAccountIds)[number];
export const accountPolicy = (id: AiAccountId): 'ai' | 'rules' =>
  id === 'v2-rules' ? 'rules' : 'ai';

/** The deterministic signals behind a review, as the journal records them. */
export interface ObservedAnalysis {
  close: number;
  trendMean: number;
  trendAllowsEntry: boolean;
  signals: Record<'breakout-v1' | 'pullback-v1', PaperSignal>;
  entryRules: ('breakout-v1' | 'pullback-v1')[];
  riskExit: boolean;
  momentumPct: number;
  assetDeclineFromHighPct: number;
}

/** One ranked entry setup from an hourly market scan. */
export interface ScanSetup {
  mint: string;
  source: PaperBarSource;
  /** Latest hourly print at scan time, including the in-progress candle. Anchors an entry's exit guard. */
  price: number;
  analysis: ObservedAnalysis;
  rows: PaperBar[];
  hourlyRows: PaperBar[];
  /** The scan's market backdrop (QQQ trend, breadth, setup count) for the AI review. */
  market?: {
    index: {
      aboveTrend: boolean;
      change20dPct: number;
      change5dPct: number;
    } | null;
    breadthPct: number | null;
    setups: number;
  };
}

export interface ScreenRow {
  id: string;
  ticker: string;
  change: number | null;
  volume: number | null;
  liquidity: number | null;
  price: number | null;
  /** v2 scans: why a scanned asset produced no setup. */
  skipped?: string;
  /** v2 scans: the setup this asset produced. */
  setup?: ScanSetup;
}
export interface MarketBook {
  cash: string;
  positions: Record<
    string,
    {
      mint: string;
      quantity: string;
      entryRule?: 'breakout-v1' | 'pullback-v1';
      guard?: PaperExitGuard;
      /** Signal-timeframe candle behind the last fresh decision (v2). */
      decidedBar?: number;
    }
  >;
}
export interface MarketObservation {
  asset: string;
  mint?: string;
  /** Candle source the review used. Absent on rounds recorded before v2. */
  source?: PaperBarSource;
  /** NYSE session state at the review, recorded for stock-sourced assets. */
  session?: UsMarketSessionState;
  /** A stock-sourced asset outside the regular session: no entry, not a data error. */
  marketClosed?: boolean;
  /** Off-session stock candles removed before evaluation, such as weekend closing prints. */
  droppedBars?: number;
  rows?: PaperBar[];
  hourlyRows?: PaperBar[];
  /** v2: the deterministic signals behind this review. */
  analysis?: ObservedAnalysis;
  /** v2 entries: loss of the buy quote followed by the exit quote, in basis points. */
  roundTripBps?: number;
  repeatedBar?: boolean;
  signal?: PaperSignal;
  /** Set when the live token quote crossed the holding's exit guard. */
  guardExit?: 'stop' | 'target';
  filled?: boolean;
  error?: string;
  research?: PaperResearch;
  terms?: ObservedPaperQuote;
  exit?: ObservedPaperQuote;
  mark?: string;
}
export interface MarketRound {
  epoch: number;
  /** The policy version: daily-v1, hourly-swing-v1/v2, then the v2 cohort's swing policy. */
  method?: string;
  screenEpoch?: number;
  at: string;
  universeSize: number;
  candidates: string[];
  screenError?: string;
  observations: MarketObservation[];
  equityRaw: string | null;
  cashRaw: string;
}
