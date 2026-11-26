import type {
  PaperBenchmarkReport,
  PaperLabAccount,
  PaperLabObservation,
  PaperLabRound,
} from "../types/paper-lab";

/** The paper trading benchmark runs only in this pull request's preview. */
export const PAPER_LAB_PR = "142";

export function paperLabEnabled() {
  return (
    process.env.NEXT_PUBLIC_DEPLOYMENT_ENV === "preview" &&
    process.env.NEXT_PUBLIC_PREVIEW_PR_NUMBER === PAPER_LAB_PR
  );
}

/** USDC amounts arrive as integer strings with six decimals. */
export function usdc(raw: string | null | undefined): number | null {
  if (raw == null || !/^-?\d+$/.test(raw)) return null;
  return Number(raw) / 1e6;
}

export function formatUsdc(value: number | null, locale: string) {
  if (value === null) return "Unknown";
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} USDC`;
}

/** Cash plus marked holdings after the latest review, or null when a holding had no exit quote. */
export function accountValue(account: PaperLabAccount): number | null {
  return usdc(account.rounds.at(-1)?.equityRaw ?? null);
}

export function combinedValue(report: PaperBenchmarkReport) {
  const values = report.accounts.map(accountValue);
  const known = values.filter((v): v is number => v !== null);
  return {
    value: known.length === values.length ? known.reduce((sum, v) => sum + v, 0) : null,
    change: known.length === values.length ? known.reduce((sum, v) => sum + v, 0) - report.totalStartingUsdc : null,
    unknownAccounts: values.length - known.length,
  };
}

export interface PaperFill {
  accountId: string;
  asset: string;
  side: "buy" | "sell";
  at: string;
  usdc: number | null;
  guardExit?: "stop" | "target";
}

/** Simulated fills, newest first. A buy reports the USDC spent; a sell reports its minimum USDC received. */
export function paperFills(accounts: PaperLabAccount[]): PaperFill[] {
  const fills: PaperFill[] = [];
  for (const account of accounts) {
    for (const round of account.rounds) {
      for (const obs of round.observations ?? []) {
        if (!obs.filled || (obs.signal !== "buy" && obs.signal !== "sell")) continue;
        fills.push({
          accountId: account.accountId,
          asset: obs.asset,
          side: obs.signal,
          at: obs.terms?.receivedAt ? new Date(obs.terms.receivedAt).toISOString() : round.at,
          usdc: obs.signal === "buy" ? usdc(obs.terms?.input) : usdc(obs.terms?.minimumOutput),
          ...(obs.guardExit ? { guardExit: obs.guardExit } : {}),
        });
      }
    }
  }
  return fills.sort((a, b) => b.at.localeCompare(a.at));
}

export type ObservationTone = "positive" | "negative" | "warning" | "muted" | "neutral";

const ERROR_LABELS: Record<string, string> = {
  insufficient_recent_hourly_bars: "Missing recent hourly candles",
  insufficient_recent_daily_bars: "Missing recent daily candles",
  invalid_hourly_bars: "Invalid hourly candles",
  invalid_daily_bars: "Invalid daily candles",
  market_data_unavailable: "Market data unavailable",
  no_tradable_variant: "No tradable token",
  stale_quote: "Quote too old to fill",
  observation_unavailable: "Review unavailable",
};

export function errorLabel(code: string) {
  return ERROR_LABELS[code] ?? code.replaceAll("_", " ");
}

const RULE_LABELS: Record<string, string> = {
  "breakout-v1": "breakout",
  "pullback-v1": "pullback",
  cash: "cash",
};

/** One short outcome label per reviewed asset, most decisive first. */
export function observationOutcome(obs: PaperLabObservation): { label: string; tone: ObservationTone } {
  if (obs.filled && obs.signal === "buy") return { label: "Bought", tone: "positive" };
  if (obs.filled && obs.signal === "sell") {
    if (obs.guardExit === "stop") return { label: "Sold · stop hit", tone: "negative" };
    if (obs.guardExit === "target") return { label: "Sold · target hit", tone: "positive" };
    return { label: "Sold", tone: "negative" };
  }
  if (obs.error) return { label: errorLabel(obs.error), tone: "warning" };
  if (obs.marketClosed) return { label: "US market closed", tone: "muted" };
  if (obs.repeatedBar) return { label: "No new candle", tone: "muted" };
  if (obs.research?.error) return { label: "Research unavailable", tone: "warning" };
  const rule = obs.research?.selected;
  if (rule) return { label: rule === "cash" ? "Chose cash" : `Chose ${RULE_LABELS[rule] ?? rule} · held`, tone: "neutral" };
  return { label: "Held", tone: "neutral" };
}

/** A review with nothing to read: no fills, no model research and no error worth checking. */
export function isQuietRound(round: PaperLabRound) {
  const observations = round.observations ?? [];
  return (
    !round.screenError &&
    observations.every((obs) => !obs.filled && !obs.research?.rationale && (obs.marketClosed || obs.repeatedBar))
  );
}

export function sourceLabel(source: PaperLabObservation["source"]) {
  if (source === "stock") return "Stock data";
  if (source === "token") return "Token data";
  return null;
}
