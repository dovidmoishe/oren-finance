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
export const aiAccountIds = [
  'trader-1',
  'trader-2',
  'trader-3',
  'trader-4',
  'trader-5',
] as const;
export type AiAccountId = (typeof aiAccountIds)[number];
export interface ScreenRow {
  id: string;
  ticker: string;
  change: number | null;
  volume: number | null;
  liquidity: number | null;
  price: number | null;
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
  method?: 'daily-v1' | 'hourly-swing-v1' | 'hourly-swing-v2';
  screenEpoch?: number;
  at: string;
  universeSize: number;
  candidates: string[];
  screenError?: string;
  observations: MarketObservation[];
  equityRaw: string | null;
  cashRaw: string;
}
