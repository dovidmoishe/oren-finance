import type {
  ObservedPaperQuote,
  PaperBar,
  PaperResearch,
  PaperSignal,
} from './paper';
export const marketPolicies = [
  'breakout',
  'pullback',
  'momentum',
  'buy-hold',
  'guided',
] as const;
export type MarketPolicy = (typeof marketPolicies)[number];
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
  positions: Record<string, { mint: string; quantity: string }>;
}
export interface MarketObservation {
  asset: string;
  mint?: string;
  rows?: PaperBar[];
  signal?: PaperSignal;
  filled?: boolean;
  error?: string;
  research?: PaperResearch;
  terms?: ObservedPaperQuote;
  exit?: ObservedPaperQuote;
  mark?: string;
}
export interface MarketRound {
  epoch: number;
  at: string;
  universeSize: number;
  candidates: string[];
  screenError?: string;
  observations: MarketObservation[];
  equityRaw: string | null;
  cashRaw: string;
}
