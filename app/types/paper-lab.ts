/** The PR 142 preview's `/api/paper/benchmark` report, as the paper traders page reads it. */

export type PaperSignal = "buy" | "hold" | "sell";

export interface PaperLabQuote {
  inputMint: string;
  outputMint: string;
  /** Integer string in the input mint's smallest units. USDC has six decimals. */
  input: string;
  quotedOutput: string;
  minimumOutput: string;
  requestedAt?: number;
  receivedAt?: number;
}

export interface PaperLabResearch {
  version?: string;
  model?: string;
  tools?: string[];
  rationale?: string;
  selected?: "breakout-v1" | "pullback-v1" | "cash" | null;
  error?: string;
}

export interface PaperLabObservation {
  asset: string;
  mint?: string;
  source?: "stock" | "token";
  session?: string;
  marketClosed?: boolean;
  droppedBars?: number;
  repeatedBar?: boolean;
  signal?: PaperSignal;
  guardExit?: "stop" | "target";
  filled?: boolean;
  error?: string;
  research?: PaperLabResearch;
  terms?: PaperLabQuote;
  exit?: PaperLabQuote;
  /** The holding's marked value after this review, in USDC smallest units. */
  mark?: string;
}

export interface PaperLabRound {
  epoch: number;
  method?: string;
  screenEpoch?: number;
  at: string;
  universeSize?: number;
  candidates?: string[];
  screenError?: string;
  observations?: PaperLabObservation[];
  /** Cash plus marked holdings after the review; null when a holding had no exit quote. */
  equityRaw: string | null;
  cashRaw?: string;
}

export interface PaperLabPosition {
  mint: string;
  quantity: string;
  entryRule?: string;
  guard?: { stopUsdcRaw: string; targetUsdcRaw?: string; source: string; setAt: string };
}

export interface PaperLabAccount {
  accountId: string;
  startedAt: string;
  endsAt: string;
  nextCheckAt: string | null;
  status: "starting" | "observing" | "ended";
  book: { cash: string; positions: Record<string, PaperLabPosition> };
  lastError: string | null;
  netPnlUsdc: number | null;
  returnPct: number | null;
  observedDrawdownPct: number | null;
  rounds: PaperLabRound[];
}

export interface PaperLabAsset {
  ticker: string;
  name: string;
  logo: string | null;
}

export interface PaperBenchmarkReport {
  experiment: string;
  status: "starting" | "observing" | "ended";
  startedAt: string | null;
  endsAt: string | null;
  deployedCommit?: string;
  lastPollAt: string | null;
  pollError: string | null;
  startingUsdcPerAccount: number;
  totalStartingUsdc: number;
  cadence: { reviewHours: number; marketScreenHours: number; durationHours: number };
  coverage: { epoch: number; at: string; count: number }[];
  /** Ticker, name and logo for every asset the report mentions. Older deployments omit it. */
  assets?: Record<string, PaperLabAsset>;
  accounts: PaperLabAccount[];
}
