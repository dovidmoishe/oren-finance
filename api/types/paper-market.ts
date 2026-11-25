import type {
  ObservedPaperQuote,
  PaperBar,
  PaperResearch,
  PaperSignal,
} from './paper';
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
    }
  >;
}
export interface MarketObservation {
  asset: string;
  mint?: string;
  rows?: PaperBar[];
  hourlyRows?: PaperBar[];
  repeatedBar?: boolean;
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
  method?: 'daily-v1' | 'hourly-swing-v1';
  screenEpoch?: number;
  at: string;
  universeSize: number;
  candidates: string[];
  screenError?: string;
  observations: MarketObservation[];
  equityRaw: string | null;
  cashRaw: string;
}
