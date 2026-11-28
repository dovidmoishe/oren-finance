import type { PaperBar, PaperBook, PaperSignal } from '../../types/paper';
import { decide } from './strategy';

/**
 * The swing trader shared by the live paper cohort and the historical
 * backtest. Everything here is pure: callers supply completed candles and the
 * book, and get back the same signals, ranking, sizing and AI evidence in both
 * environments. A change to any rule or limit needs a new version.
 */
export type EntryRule = 'breakout-v1' | 'pullback-v1';
export const ENTRY_RULES: readonly EntryRule[] = ['breakout-v1', 'pullback-v1'];

export interface SwingPolicy {
  version: string;
  /** Candles the entry and exit rules read. The daily trend filter always uses daily candles. */
  timeframe: 'hourly' | 'daily';
  rules: readonly EntryRule[];
  /** Most liquid stock-feed assets scanned for setups each review. */
  scanLimit: number;
  /** Minimum quoted token liquidity, in USD, for an asset to be scanned. */
  minLiquidityUsd: number;
  /** Skip an entry whose buy-and-sell-back quote at entry size loses more than this. */
  maxRoundTripBps: number;
  /** Ranked setups the reviewer may consider in one review. */
  maxReviews: number;
  maxPositions: number;
  /** Each entry spends this share of marked equity, capped by available cash. */
  entryEquityBps: number;
  /** When set, new entries are allowed only while the market switch is on. Exits are unaffected. */
  regime?: RegimeSwitch;
}

/**
 * The market switch. On while the index's latest daily close is at or above
 * the mean of the `indexAverageDays` closes before it and at least
 * `minBreadthPct` of scanned stocks are above their own 20-day mean. Off when
 * either is unknown. The values were fixed before testing: a 50-day average
 * and half the market.
 */
export interface RegimeSwitch {
  indexAverageDays: number;
  minBreadthPct: number;
}
export const MARKET_SWITCH: RegimeSwitch = {
  indexAverageDays: 50,
  minBreadthPct: 50,
};

/** Whether the latest close is at or above the mean of the `days` closes before it. Null with too little history. */
export function aboveAverage(closes: number[], days: number): boolean | null {
  if (closes.length < days + 1) return null;
  const prior = closes.slice(-days - 1, -1);
  return (
    closes[closes.length - 1] >=
    prior.reduce((sum, c) => sum + c, 0) / prior.length
  );
}

export function regimeOn(
  indexCloses: number[],
  breadthPct: number | null,
  regime: RegimeSwitch,
): boolean {
  return (
    aboveAverage(indexCloses, regime.indexAverageDays) === true &&
    breadthPct !== null &&
    breadthPct >= regime.minBreadthPct
  );
}

export const HOURLY_POLICY: SwingPolicy = {
  version: 'hourly-swing-v3',
  timeframe: 'hourly',
  rules: ENTRY_RULES,
  scanLimit: 60,
  minLiquidityUsd: 25_000,
  maxRoundTripBps: 100,
  maxReviews: 3,
  maxPositions: 6,
  entryEquityBps: 1000,
};

/**
 * Breakout on daily candles: enter on a close above the prior 20 daily highs
 * with the trend filter, exit on a daily close below the prior five daily lows
 * or when an hourly print breaks that stop. In the 2026-04 to 2026-11 backtest
 * it beat the hourly policy in both the in-sample and out-of-sample windows
 * with about an eighth of the trades. It did not beat buy and hold in either.
 */
export const DAILY_BREAKOUT_POLICY: SwingPolicy = {
  ...HOURLY_POLICY,
  version: 'daily-breakout-v1',
  timeframe: 'daily',
  rules: ['breakout-v1'],
};

/**
 * Daily breakout behind the market switch. In the 2026-04 to 2026-11
 * backtest it cut the worst drop from 20.8% to 15.3% and turned the
 * out-of-sample loss of 4.5% into -0.2%, with about half the trades.
 */
export const DAILY_BREAKOUT_SWITCH_POLICY: SwingPolicy = {
  ...DAILY_BREAKOUT_POLICY,
  version: 'daily-breakout-switch-v1',
  regime: MARKET_SWITCH,
};

/** The policy the live paper cohort runs. */
export const SWING_POLICY: SwingPolicy = DAILY_BREAKOUT_SWITCH_POLICY;
export const SWING_VERSION = SWING_POLICY.version;

/** The candles a policy's entry and exit rules read. */
export const signalBars = (
  policy: SwingPolicy,
  bars: { daily: PaperBar[]; hourly: PaperBar[] },
) => (policy.timeframe === 'daily' ? bars.daily : bars.hourly);

export interface SwingAnalysis {
  /** Latest completed close on the signal timeframe. */
  close: number;
  /** Mean of the 20 daily closes before the latest one. */
  trendMean: number;
  trendAllowsEntry: boolean;
  /** Per-rule signals. A buy is masked to hold when the daily trend blocks entries. */
  signals: Record<EntryRule, PaperSignal>;
  /** Allowed rules that would enter now. Always empty for a holding. */
  entryRules: EntryRule[];
  /** A holding must be sold: breakout exit on either timeframe, or its pullback exit. */
  riskExit: boolean;
  /** Change of the latest daily close over the 20 daily closes before it. The ranking score. */
  momentumPct: number;
  /** The asset's latest daily close below its highest close in the window. Not an account figure. */
  assetDeclineFromHighPct: number;
}

const FLAT: PaperBook = { cash: '0', position: '0' };
const HELD: PaperBook = { cash: '0', position: '1' };

/** Signals for one asset from 21 completed daily bars and 21 completed signal-timeframe bars. */
export function analyze(
  daily: PaperBar[],
  bars: PaperBar[],
  holding?: { entryRule?: EntryRule },
  rules: readonly EntryRule[] = SWING_POLICY.rules,
): SwingAnalysis {
  const book = holding ? HELD : FLAT;
  const prior = daily.slice(0, -1);
  const lastDaily = daily[daily.length - 1].close;
  const trendMean =
    prior.reduce((sum, bar) => sum + bar.close, 0) / prior.length;
  const trendAllowsEntry = lastDaily >= trendMean;
  const eligible = (rule: EntryRule): PaperSignal => {
    const signal = decide(rule, bars, book);
    return signal === 'buy' && !trendAllowsEntry ? 'hold' : signal;
  };
  const signals = {
    'breakout-v1': eligible('breakout-v1'),
    'pullback-v1': eligible('pullback-v1'),
  };
  const riskExit =
    !!holding &&
    (signals['breakout-v1'] === 'sell' ||
      decide('breakout-v1', daily, book) === 'sell' ||
      (holding.entryRule === 'pullback-v1' &&
        signals['pullback-v1'] === 'sell'));
  return {
    close: bars[bars.length - 1].close,
    trendMean,
    trendAllowsEntry,
    signals,
    entryRules: holding ? [] : rules.filter((r) => signals[r] === 'buy'),
    riskExit,
    momentumPct: 100 * (lastDaily / prior[0].close - 1),
    assetDeclineFromHighPct:
      100 * (1 - lastDaily / Math.max(...daily.map((bar) => bar.close))),
  };
}

export interface Setup {
  asset: string;
  analysis: SwingAnalysis;
}

/** Entry setups, strongest daily momentum first. Ties keep a stable asset order. */
export function rankSetups<T extends Setup>(setups: T[]): T[] {
  return setups
    .filter((s) => s.analysis.entryRules.length > 0)
    .sort(
      (a, b) =>
        b.analysis.momentumPct - a.analysis.momentumPct ||
        a.asset.localeCompare(b.asset),
    );
}

/** The setups one review may consider, given current holdings. */
export function reviewable<T extends Setup>(
  ranked: T[],
  held: ReadonlySet<string>,
  openPositions: number,
  policy: SwingPolicy = SWING_POLICY,
): T[] {
  const room = Math.max(0, policy.maxPositions - openPositions);
  return ranked
    .filter((s) => !held.has(s.asset))
    .slice(0, Math.min(policy.maxReviews, room));
}

/** Entry budget: a share of marked equity, never more than the cash left after the fill fee. */
export function entryBudget(
  cash: bigint,
  equity: bigint,
  fee: bigint,
  policy: SwingPolicy = SWING_POLICY,
): bigint {
  const target = (equity * BigInt(policy.entryEquityBps)) / 10000n;
  const available = cash - fee;
  const budget = target < available ? target : available;
  return budget > 0n ? budget : 0n;
}

/** Loss of a buy quote followed by a sell-back quote, in basis points of the input. */
export function roundTripBps(input: bigint, backOutput: bigint): number {
  if (input <= 0n) return Infinity;
  return Number(((input - backOutput) * 1_000_000n) / input) / 100;
}

/** The rule a rules-only trader takes: the first rule that would enter. */
export function rulesChoice(analysis: SwingAnalysis): EntryRule | 'cash' {
  return analysis.entryRules[0] ?? 'cash';
}

/** What a reviewer's choice means for an entry: the chosen rule must itself be signalling a buy. */
export function entrySignal(
  analysis: SwingAnalysis,
  choice: EntryRule | 'cash',
): PaperSignal {
  return choice !== 'cash' && analysis.entryRules.includes(choice)
    ? 'buy'
    : 'hold';
}

/**
 * The market backdrop of one scan. The index is QQQ, the Nasdaq 100 tracker:
 * the catalog has no S&P 500 tracker with usable history.
 */
export interface MarketContext {
  /** QQQ's latest daily close against its prior 20-close mean, and its 20- and 5-session change. */
  index: {
    aboveTrend: boolean;
    change20dPct: number;
    change5dPct: number;
  } | null;
  /** Share of scanned assets whose latest daily close is at or above their prior 20-day mean. */
  breadthPct: number | null;
  /** Entry setups the scan found. Many at once usually means a broad rally. */
  setups: number;
}

/** Index id for the market backdrop. */
export const MARKET_INDEX_ASSET = 'invesco-qqq';

const round = (value: number, places = 2) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

/** QQQ's trend from at least 21 completed daily closes, oldest first. */
export function indexTrend(daily: PaperBar[]): MarketContext['index'] {
  if (daily.length < 21) return null;
  const rows = daily.slice(-21);
  const last = rows[20].close;
  const prior = rows.slice(0, 20);
  const mean = prior.reduce((sum, r) => sum + r.close, 0) / prior.length;
  return {
    aboveTrend: last >= mean,
    change20dPct: round(100 * (last / rows[0].close - 1)),
    change5dPct: round(100 * (last / rows[15].close - 1)),
  };
}

/** The backdrop from the index trend and every scanned asset with complete history. */
export function marketContext(
  index: PaperBar[] | null,
  scanned: Pick<SwingAnalysis, 'trendAllowsEntry'>[],
  setups: number,
): MarketContext {
  return {
    index: index ? indexTrend(index) : null,
    breadthPct: scanned.length
      ? round(
          (100 * scanned.filter((a) => a.trendAllowsEntry).length) /
            scanned.length,
        )
      : null,
    setups,
  };
}

/** Setup measures the entry rules do not use. */
export interface SetupFeatures {
  /** Latest daily volume over the mean of the 20 before it. Null without volume data. */
  volumeRatio: number | null;
  /** Mean daily high-to-low range over the last 20 sessions, as a share of the latest close. */
  avgRangePct: number;
  /** How far the latest daily close sits above the prior 20-session high. */
  extensionPct: number;
  /** The asset's 20-session change minus QQQ's. Null without index data. */
  relativeMomentumPct: number | null;
}

export function setupFeatures(
  daily: PaperBar[],
  analysis: SwingAnalysis,
  market?: MarketContext,
): SetupFeatures {
  const last = daily[daily.length - 1];
  const prior = daily.slice(0, -1);
  const volumes = prior.map((r) => r.volume ?? NaN);
  const meanVolume =
    volumes.reduce((sum, v) => sum + v, 0) / Math.max(1, volumes.length);
  const recent = daily.slice(-20);
  return {
    volumeRatio:
      Number.isFinite(meanVolume) &&
      meanVolume > 0 &&
      Number.isFinite(last.volume)
        ? round(last.volume! / meanVolume)
        : null,
    avgRangePct: round(
      (100 * recent.reduce((sum, r) => sum + (r.high - r.low), 0)) /
        recent.length /
        last.close,
    ),
    extensionPct: round(
      100 * (last.close / Math.max(...prior.map((r) => r.high)) - 1),
    ),
    relativeMomentumPct: market?.index
      ? round(analysis.momentumPct - market.index.change20dPct)
      : null,
  };
}

export interface SetupEvidence {
  version: string;
  timeframe: SwingPolicy['timeframe'];
  /** Oldest first. Each bar is [high, low, close], rebased so the latest signal close is 100. Empty for daily policies. */
  hourly: [number, number, number][];
  daily: [number, number, number][];
  trendMean: number;
  trendAllowsEntry: boolean;
  signals: Record<EntryRule, PaperSignal>;
  entryRules: EntryRule[];
  momentumPct: number;
  assetDeclineFromHighPct: number;
  features: SetupFeatures;
  market: MarketContext | null;
}

/**
 * What the AI reviewer sees for an entry setup. It carries no ticker, mint,
 * timestamp or raw volume and its prices are rebased, so the model judges the
 * chart, the setup measures and the market backdrop rather than what it may
 * remember about a company. It also carries no account figures: sizing,
 * limits and exits are deterministic, and a book-independent review can be
 * cached and replayed in a backtest.
 */
export function setupEvidence(
  daily: PaperBar[],
  hourly: PaperBar[],
  analysis: SwingAnalysis,
  policy: SwingPolicy = SWING_POLICY,
  market?: MarketContext,
): SetupEvidence {
  const scale = (price: number) => round((100 * price) / analysis.close);
  const bars = (rows: PaperBar[]) =>
    rows.map(
      (r) =>
        [scale(r.high), scale(r.low), scale(r.close)] as [
          number,
          number,
          number,
        ],
    );
  return {
    version: policy.version,
    timeframe: policy.timeframe,
    // A daily-timeframe review depends only on daily candles, so one review covers the trading day.
    hourly: policy.timeframe === 'daily' ? [] : bars(hourly),
    daily: bars(daily),
    trendMean: scale(analysis.trendMean),
    trendAllowsEntry: analysis.trendAllowsEntry,
    signals: analysis.signals,
    entryRules: analysis.entryRules,
    momentumPct: round(analysis.momentumPct),
    assetDeclineFromHighPct: round(analysis.assetDeclineFromHighPct),
    features: setupFeatures(daily, analysis, market),
    market: market ?? null,
  };
}
