import { createHash } from 'node:crypto';
import type { MarketCandle } from '../../types/market';
import {
  PAPER_MODEL,
  type PaperBar,
  type PaperResearch,
  type PaperQuoteTerms,
} from '../../types/paper';
import { usMarketSession } from '../market/us-market-session';
import {
  DAY,
  HOUR,
  IncompleteHistory,
  exitLevels,
  history,
  settle,
} from './strategy';
import {
  SWING_POLICY,
  analyze,
  entryBudget,
  entrySignal,
  marketContext,
  regimeOn,
  aboveAverage,
  rankSetups,
  reviewable,
  rulesChoice,
  setupEvidence,
  signalBars,
  type EntryRule,
  type SetupEvidence,
  type RegimeSwitch,
  type SwingAnalysis,
  type SwingPolicy,
} from './swing';

/**
 * Historical replay of the hourly swing trader over stock-market candles.
 *
 * Each step is the end of an hourly candle. The trader sees only candles that
 * completed by then, decides, and fills at the open of the next candle, with
 * the same `settle` cost model as the live cohort. The token spread is the
 * round trip measured from live Jupiter quotes for each asset, half on each
 * side. Stops and targets are checked on each completed hourly close, like the
 * live hourly guard. Entries happen only in the NYSE regular session.
 */

export interface BacktestAsset {
  asset: string;
  ticker: string;
  /** Measured round-trip cost of a $1,000 swap, in basis points. Half is charged on each side. */
  roundTripBps: number;
  /** NYSE-session hourly stock candles, oldest first. */
  hourly: MarketCandle[];
  /** NYSE trading-day daily stock candles, oldest first. */
  daily: MarketCandle[];
}

export type BacktestArm = 'rules' | 'ai';

export interface PendingReview {
  key: string;
  asset: string;
  at: number;
  evidence: SetupEvidence;
}

export interface BacktestOptions {
  from: number;
  to: number;
  arm: BacktestArm;
  policy?: SwingPolicy;
  /** Daily candles of the market index (QQQ) on NYSE trading days, for the AI's market backdrop. */
  index?: MarketCandle[];
  /** AI arm: a cached review for this setup, or undefined when it has not been requested yet. */
  lookup?: (review: PendingReview) => PaperResearch | undefined;
}

export type ExitReason = 'riskExit' | 'stop' | 'target' | 'end';

export interface BacktestTrade {
  asset: string;
  ticker: string;
  rule: EntryRule;
  entryAt: string;
  entryPrice: number;
  costUsdc: number;
  exitAt: string;
  exitPrice: number;
  proceedsUsdc: number;
  reason: ExitReason;
  pnlUsdc: number;
  returnPct: number;
  /** Spread, allowance and fees paid on both fills, against frictionless fills at the same prices. */
  frictionUsdc: number;
  holdHours: number;
  rationale?: string;
}

export interface EquityPoint {
  at: number;
  equityUsdc: number;
  positions: number;
}

export interface BacktestRun {
  arm: BacktestArm;
  equity: EquityPoint[];
  trades: BacktestTrade[];
  reviews: {
    considered: number;
    entered: number;
    skipped: number;
    failed: number;
  };
  /** Regular-session hours in which the market switch blocked entries. */
  switchedOff: number;
  /** AI arm: setups whose review is not cached yet. The run treated them as skips. */
  pending: PendingReview[];
}

interface Holding {
  asset: string;
  quantity: bigint;
  rule: EntryRule;
  costRaw: bigint;
  entryAt: number;
  entryPrice: number;
  stop: number;
  target?: number;
  /** Daily candle behind the last fresh decision (daily timeframe). */
  decidedDaily?: number;
  rationale?: string;
}

const START = BigInt(PAPER_MODEL.startingUsdcRaw);
const FEE = BigInt(PAPER_MODEL.fixedCostUsdcRaw);
const usdc = (raw: bigint) => Number(raw) / 1e6;

/** A modeled route: price-based output less half the measured round trip. Units: micro-USDC and microshares. */
export function modeledTerms(
  side: 'buy' | 'sell',
  input: bigint,
  price: number,
  roundTripBps: number,
): PaperQuoteTerms {
  const half = roundTripBps / 2 / 10000;
  const gross = Number(input) * (side === 'buy' ? 1 / price : price);
  const output = Math.floor(gross * (1 - half));
  if (!Number.isSafeInteger(output) || output <= 0)
    throw new Error('unrepresentable_output');
  return {
    inputMint: side === 'buy' ? 'USDC' : 'share',
    outputMint: side === 'buy' ? 'share' : 'USDC',
    input: input.toString(),
    quotedOutput: String(output),
    minimumOutput: String(output),
    slot: null,
  };
}

/** Index cursor over a sorted candle series: candles completed by `at`, and the next one to open. */
class Series {
  private done = 0;
  constructor(
    readonly bars: MarketCandle[],
    private readonly span: number,
  ) {}
  advance(at: number) {
    while (
      this.done < this.bars.length &&
      +this.bars[this.done].timestamp + this.span <= at
    )
      this.done++;
  }
  /** The last `n` completed candles, enough for `history` to pick its window. */
  recent(n = 40) {
    return this.bars.slice(Math.max(0, this.done - n), this.done);
  }
  latest() {
    return this.done ? this.bars[this.done - 1] : undefined;
  }
  next() {
    return this.bars[this.done];
  }
}

function windows(
  hourly: Series,
  daily: Series,
  at: number,
): { daily: PaperBar[]; hourly: PaperBar[] } | null {
  try {
    return {
      daily: history(daily.recent(), at),
      hourly: history(hourly.recent(), at, 'hourly'),
    };
  } catch (err) {
    if (err instanceof IncompleteHistory) return null;
    if (
      err instanceof Error &&
      /^invalid_(hourly|daily)_bars$/.test(err.message)
    )
      return null;
    throw err;
  }
}

type Exit = { at: number; price: number; reason: ExitReason };
type Guarded = Pick<Holding, 'rule' | 'stop' | 'target' | 'decidedDaily'>;

/**
 * One hourly review of a holding at `at`: a fresh decision on new candles in
 * the regular session (mandatory exit, else re-anchored stop and target),
 * otherwise the stop and target checked against the latest hourly close.
 * Exits fill at the next candle's open. Shared by the portfolio replay and
 * single-setup scoring so both exit the same way.
 */
function holdingStep(
  h: Guarded,
  s: { hourly: Series; daily: Series },
  at: number,
  regular: boolean,
  policy: SwingPolicy,
): Exit | null {
  const latest = s.hourly.latest();
  const next = s.hourly.next();
  if (!latest || !next) return null;
  const fresh = +latest.timestamp + HOUR === at;
  const bars = regular && fresh ? windows(s.hourly, s.daily, at) : null;
  const dailyBar = bars?.daily.at(-1)!.time;
  if (bars && (policy.timeframe === 'hourly' || dailyBar !== h.decidedDaily)) {
    const signal = signalBars(policy, bars);
    const analysis = analyze(bars.daily, signal, { entryRule: h.rule });
    if (analysis.riskExit)
      return { at: +next.timestamp, price: next.open, reason: 'riskExit' };
    const levels = exitLevels(bars.daily, signal, h.rule);
    h.stop = levels.stop;
    h.target = levels.target;
    h.decidedDaily = dailyBar;
  } else if (fresh) {
    if (latest.close < h.stop)
      return { at: +next.timestamp, price: next.open, reason: 'stop' };
    if (h.target !== undefined && latest.close >= h.target)
      return { at: +next.timestamp, price: next.open, reason: 'target' };
  }
  return null;
}

/** Cache key for one AI review: the model and the exact evidence it saw. */
export function reviewKey(model: string, evidence: SetupEvidence) {
  return createHash('sha256')
    .update(model + '\n' + JSON.stringify(evidence))
    .digest('hex');
}

/** Decision times: the end of every hourly candle in the window, across all assets. */
export function decisionTimes(
  assets: BacktestAsset[],
  from: number,
  to: number,
) {
  const times = new Set<number>();
  for (const a of assets)
    for (const bar of a.hourly) {
      const end = +bar.timestamp + HOUR;
      if (end >= from && end <= to) times.add(end);
    }
  return [...times].sort((a, b) => a - b);
}

export function simulate(
  assets: BacktestAsset[],
  options: BacktestOptions,
  model = 'rules',
): BacktestRun {
  const policy = options.policy ?? SWING_POLICY;
  const series = new Map(
    assets.map((a) => [
      a.asset,
      {
        meta: a,
        hourly: new Series(a.hourly, HOUR),
        daily: new Series(a.daily, DAY),
      },
    ]),
  );
  const indexSeries = new Series(options.index ?? [], DAY);
  let cash = START;
  const holdings = new Map<string, Holding>();
  const run: BacktestRun = {
    arm: options.arm,
    equity: [],
    trades: [],
    reviews: { considered: 0, entered: 0, skipped: 0, failed: 0 },
    switchedOff: 0,
    pending: [],
  };
  const pendingKeys = new Set<string>();

  const close = (h: Holding, at: number, price: number, reason: ExitReason) => {
    const meta = series.get(h.asset)!.meta;
    const terms = modeledTerms('sell', h.quantity, price, meta.roundTripBps);
    const fill = settle(
      { cash: cash.toString(), position: h.quantity.toString() },
      'sell',
      terms,
    );
    const proceeds = BigInt(fill.book.cash) - cash;
    cash = BigInt(fill.book.cash);
    holdings.delete(h.asset);
    run.trades.push({
      asset: h.asset,
      ticker: meta.ticker,
      rule: h.rule,
      entryAt: new Date(h.entryAt).toISOString(),
      entryPrice: h.entryPrice,
      costUsdc: usdc(h.costRaw),
      exitAt: new Date(at).toISOString(),
      exitPrice: price,
      proceedsUsdc: usdc(proceeds),
      reason,
      pnlUsdc: usdc(proceeds - h.costRaw),
      returnPct: 100 * (Number(proceeds) / Number(h.costRaw) - 1),
      // Frictionless fills: the same cost at the entry price, sold at the exit price.
      frictionUsdc:
        ((Number(h.costRaw) / h.entryPrice) * price - Number(proceeds)) / 1e6,
      holdHours: (at - h.entryAt) / HOUR,
      ...(h.rationale ? { rationale: h.rationale } : {}),
    });
  };

  const markRaw = (h: Holding) => {
    const s = series.get(h.asset)!;
    const price = s.hourly.latest()?.close ?? h.entryPrice;
    const fill = settle(
      { cash: '0', position: h.quantity.toString() },
      'hold',
      modeledTerms('sell', h.quantity, price, s.meta.roundTripBps),
    );
    return BigInt(fill.liquidationEquityUsdcRaw!);
  };

  const times = decisionTimes(assets, options.from, options.to);
  for (const at of times) {
    for (const s of series.values()) {
      s.hourly.advance(at);
      s.daily.advance(at);
    }
    const regular = usMarketSession(new Date(at)).regular;

    // Holdings first: deterministic exits, then the hourly stop and target guard.
    for (const h of [...holdings.values()]) {
      const exit = holdingStep(h, series.get(h.asset)!, at, regular, policy);
      if (exit) close(h, exit.at, exit.price, exit.reason);
    }

    let equity = cash;
    for (const h of holdings.values()) equity += markRaw(h);

    if (regular && holdings.size < policy.maxPositions) {
      const setups: {
        asset: string;
        analysis: SwingAnalysis;
        bars: { daily: PaperBar[]; hourly: PaperBar[] };
      }[] = [];
      // Every asset with complete history counts toward breadth; only unheld ones can be setups.
      const scanned: SwingAnalysis[] = [];
      for (const [asset, s] of series) {
        const latest = s.hourly.latest();
        if (!latest || +latest.timestamp + HOUR !== at || !s.hourly.next())
          continue;
        const bars = windows(s.hourly, s.daily, at);
        if (!bars) continue;
        const held = holdings.get(asset);
        const analysis = analyze(
          bars.daily,
          signalBars(policy, bars),
          held ? { entryRule: held.rule } : undefined,
          policy.rules,
        );
        scanned.push(analysis);
        if (!held) setups.push({ asset, analysis, bars });
      }
      const ranked = rankSetups(setups);
      indexSeries.advance(at);
      let indexDaily: PaperBar[] | null = null;
      try {
        indexDaily = history(indexSeries.recent(), at);
      } catch {
        indexDaily = null;
      }
      const market = marketContext(indexDaily, scanned, ranked.length);
      const blocked =
        policy.regime &&
        !regimeOn(
          indexSeries.recent(120).map((c) => c.close),
          market.breadthPct,
          policy.regime,
        );
      if (blocked) run.switchedOff++;
      const candidates = blocked
        ? []
        : reviewable(ranked, new Set(holdings.keys()), holdings.size, policy);
      for (const setup of candidates) {
        run.reviews.considered++;
        let choice: EntryRule | 'cash' = rulesChoice(setup.analysis);
        let rationale: string | undefined;
        if (options.arm === 'ai') {
          const evidence = setupEvidence(
            setup.bars.daily,
            setup.bars.hourly,
            setup.analysis,
            policy,
            market,
          );
          const pending: PendingReview = {
            key: reviewKey(model, evidence),
            asset: setup.asset,
            at,
            evidence,
          };
          const research = options.lookup?.(pending);
          if (!research) {
            if (!pendingKeys.has(pending.key)) {
              pendingKeys.add(pending.key);
              run.pending.push(pending);
            }
            choice = 'cash';
          } else {
            if (research.error === 'research_unavailable') run.reviews.failed++;
            choice = research.selected ?? 'cash';
            rationale = research.rationale;
          }
        }
        if (
          entrySignal(setup.analysis, choice) !== 'buy' ||
          choice === 'cash'
        ) {
          run.reviews.skipped++;
          continue;
        }
        const s = series.get(setup.asset)!;
        const next = s.hourly.next();
        const budget = entryBudget(cash, equity, FEE, policy);
        if (budget < 1_000_000n) {
          run.reviews.skipped++;
          continue;
        }
        const terms = modeledTerms(
          'buy',
          budget,
          next.open,
          s.meta.roundTripBps,
        );
        const fill = settle(
          { cash: cash.toString(), position: '0' },
          'buy',
          terms,
          budget,
        );
        const levels = exitLevels(
          setup.bars.daily,
          signalBars(policy, setup.bars),
          choice,
        );
        holdings.set(setup.asset, {
          asset: setup.asset,
          quantity: BigInt(fill.book.position),
          rule: choice,
          costRaw: cash - BigInt(fill.book.cash),
          entryAt: +next.timestamp,
          entryPrice: next.open,
          stop: levels.stop,
          target: levels.target,
          decidedDaily: setup.bars.daily.at(-1)!.time,
          ...(rationale ? { rationale } : {}),
        });
        cash = BigInt(fill.book.cash);
        run.reviews.entered++;
      }
    }

    let marked = cash;
    for (const h of holdings.values()) marked += markRaw(h);
    run.equity.push({ at, equityUsdc: usdc(marked), positions: holdings.size });
  }

  const end = times.at(-1) ?? options.to;
  for (const h of [...holdings.values()]) {
    const price = series.get(h.asset)!.hourly.latest()?.close ?? h.entryPrice;
    close(h, end, price, 'end');
  }
  if (run.equity.length)
    run.equity[run.equity.length - 1] = {
      at: end,
      equityUsdc: usdc(cash),
      positions: 0,
    };
  return run;
}

export interface SetupOutcome {
  asset: string;
  /** Decision time of the review. */
  at: number;
  rule: EntryRule;
  entryAt: number;
  entryPrice: number;
  exitAt: number;
  exitPrice: number;
  reason: ExitReason;
  /** Net of the measured spread, the allowance and both fees, on a 1,000 USDC entry. */
  returnPct: number;
  holdHours: number;
}

/**
 * What one setup would have earned on its own: a 1,000 USDC entry at the
 * open after the decision, managed by the same exits as the portfolio
 * replay, closed at the last candle before `to` if no exit came. Null when
 * the asset was not signalling an entry at `at`. Used to score every setup
 * an AI reviewed, independent of which other trades a portfolio held.
 */
export function setupOutcome(
  asset: BacktestAsset,
  at: number,
  policy: SwingPolicy = SWING_POLICY,
  to = Infinity,
): SetupOutcome | null {
  const s = {
    hourly: new Series(asset.hourly, HOUR),
    daily: new Series(asset.daily, DAY),
  };
  s.hourly.advance(at);
  s.daily.advance(at);
  const bars = windows(s.hourly, s.daily, at);
  const next = s.hourly.next();
  if (!bars || !next) return null;
  const signal = signalBars(policy, bars);
  const rule = analyze(bars.daily, signal, undefined, policy.rules)
    .entryRules[0];
  if (!rule) return null;
  const levels = exitLevels(bars.daily, signal, rule);
  const budget = 1_000_000_000n;
  const bought = settle(
    { cash: START.toString(), position: '0' },
    'buy',
    modeledTerms('buy', budget, next.open, asset.roundTripBps),
    budget,
  );
  const quantity = BigInt(bought.book.position);
  const cost = budget + FEE;
  const h: Guarded = {
    rule,
    stop: levels.stop,
    target: levels.target,
    decidedDaily: bars.daily.at(-1)!.time,
  };
  let exit: Exit | null = null;
  for (const bar of asset.hourly) {
    const t = +bar.timestamp + HOUR;
    if (t <= at) continue;
    if (t > to) break;
    s.hourly.advance(t);
    s.daily.advance(t);
    exit = holdingStep(h, s, t, usMarketSession(new Date(t)).regular, policy);
    if (exit) break;
  }
  if (!exit) {
    const last = s.hourly.latest()!;
    exit = { at: +last.timestamp + HOUR, price: last.close, reason: 'end' };
  }
  const sold = settle(
    { cash: '0', position: quantity.toString() },
    'sell',
    modeledTerms('sell', quantity, exit.price, asset.roundTripBps),
  );
  return {
    asset: asset.asset,
    at,
    rule,
    entryAt: +next.timestamp,
    entryPrice: next.open,
    exitAt: exit.at,
    exitPrice: exit.price,
    reason: exit.reason,
    returnPct: 100 * (Number(sold.book.cash) / Number(cost) - 1),
    holdHours: (exit.at - +next.timestamp) / HOUR,
  };
}

/** Equal-weight buy and hold of every asset at the first regular-session decision, marked with the same costs. */
export function buyAndHold(
  assets: BacktestAsset[],
  from: number,
  to: number,
): EquityPoint[] {
  const times = decisionTimes(assets, from, to);
  const start = times.find((t) => usMarketSession(new Date(t)).regular);
  if (start === undefined) return [];
  const series = assets.map((a) => ({
    meta: a,
    hourly: new Series(a.hourly, HOUR),
  }));
  for (const s of series) s.hourly.advance(start);
  const tradable = series.filter((s) => s.hourly.next() && s.hourly.latest());
  if (!tradable.length) return [];
  const slice =
    (START - FEE * BigInt(tradable.length)) / BigInt(tradable.length);
  let cash = START;
  const held = tradable.map((s) => {
    const terms = modeledTerms(
      'buy',
      slice,
      s.hourly.next().open,
      s.meta.roundTripBps,
    );
    const fill = settle(
      { cash: cash.toString(), position: '0' },
      'buy',
      terms,
      slice,
    );
    cash = BigInt(fill.book.cash);
    return { s, quantity: BigInt(fill.book.position) };
  });
  const curve: EquityPoint[] = [];
  for (const at of times.filter((t) => t >= start)) {
    let equity = cash;
    for (const h of held) {
      h.s.hourly.advance(at);
      const price = h.s.hourly.latest()!.close;
      equity += BigInt(
        settle(
          { cash: '0', position: h.quantity.toString() },
          'hold',
          modeledTerms('sell', h.quantity, price, h.s.meta.roundTripBps),
        ).liquidationEquityUsdcRaw!,
      );
    }
    curve.push({ at, equityUsdc: usdc(equity), positions: held.length });
  }
  return curve;
}

export interface RebalanceContext {
  at: number;
  /** Completed daily closes per asset, oldest first, up to 150 sessions. */
  closes: Map<string, number[]>;
  /** Completed daily closes of the market index (QQQ), oldest first. */
  indexCloses: number[];
  /** Share of assets whose latest daily close is at or above their prior 20-day mean. */
  breadthPct: number | null;
}

export interface WeightsOptions {
  from: number;
  to: number;
  index?: MarketCandle[];
  /** Rebalance at the first regular-session decision of each day or each week. */
  schedule: 'daily' | 'weekly';
  /** Target weights by asset (summing to at most 1). Missing assets are sold. */
  targets: (ctx: RebalanceContext) => Map<string, number>;
  /** Skip trades smaller than this share of equity, to avoid churn. Default 2%. */
  bandPct?: number;
}

/**
 * A target-weight portfolio on the same clock, fills and costs as the swing
 * replay: on each rebalance it sells down overweight assets, then buys
 * underweight ones at the next hourly open, and marks every hour at the
 * liquidation value. Used for the simple benchmarks: momentum rotation and
 * trend-filtered hold.
 */
export function simulateWeights(
  assets: BacktestAsset[],
  options: WeightsOptions,
): { equity: EquityPoint[]; fills: number } {
  const series = assets.map((a) => ({
    meta: a,
    hourly: new Series(a.hourly, HOUR),
    daily: new Series(a.daily, DAY),
    quantity: 0n,
  }));
  const index = new Series(options.index ?? [], DAY);
  const band = (options.bandPct ?? 2) / 100;
  let cash = START;
  let fills = 0;
  let lastKey = '';
  const curve: EquityPoint[] = [];
  const value = (s: (typeof series)[number], price: number) =>
    s.quantity > 0n
      ? BigInt(
          settle(
            { cash: '0', position: s.quantity.toString() },
            'hold',
            modeledTerms('sell', s.quantity, price, s.meta.roundTripBps),
          ).liquidationEquityUsdcRaw!,
        )
      : 0n;
  for (const at of decisionTimes(assets, options.from, options.to)) {
    for (const s of series) {
      s.hourly.advance(at);
      s.daily.advance(at);
    }
    index.advance(at);
    const regular = usMarketSession(new Date(at)).regular;
    const day = Math.floor(at / DAY);
    const key =
      options.schedule === 'daily'
        ? String(day)
        : String(Math.floor((day + 3) / 7));
    if (regular && key !== lastKey) {
      lastKey = key;
      const closes = new Map(
        series.map((s) => [
          s.meta.asset,
          s.daily.recent(150).map((c) => c.close),
        ]),
      );
      const trends = [...closes.values()]
        .map((c) => aboveAverage(c, 20))
        .filter((v): v is boolean => v !== null);
      const targets = options.targets({
        at,
        closes,
        indexCloses: index.recent(150).map((c) => c.close),
        breadthPct: trends.length
          ? (100 * trends.filter(Boolean).length) / trends.length
          : null,
      });
      const marks = series.map((s) => s.hourly.latest()?.close);
      let equity = cash;
      series.forEach((s, i) => {
        if (marks[i] !== undefined) equity += value(s, marks[i]);
      });
      const tradable = series.filter(
        (s) => s.hourly.next() && s.hourly.latest(),
      );
      // Sells first, so their proceeds fund the buys.
      for (const s of tradable) {
        const held = value(s, s.hourly.latest()!.close);
        const target = BigInt(
          Math.floor(Number(equity) * (targets.get(s.meta.asset) ?? 0)),
        );
        if (
          held - target <= BigInt(Math.floor(Number(equity) * band)) &&
          target > 0n
        )
          continue;
        if (s.quantity === 0n || held <= target) continue;
        const sell =
          target === 0n
            ? s.quantity
            : (s.quantity * (held - target)) / (held > 0n ? held : 1n);
        if (sell <= 0n) continue;
        const fill = settle(
          { cash: cash.toString(), position: s.quantity.toString() },
          'sell',
          modeledTerms('sell', sell, s.hourly.next().open, s.meta.roundTripBps),
          sell,
        );
        cash = BigInt(fill.book.cash);
        s.quantity -= sell;
        fills++;
      }
      for (const s of tradable) {
        const held = value(s, s.hourly.latest()!.close);
        const target = BigInt(
          Math.floor(Number(equity) * (targets.get(s.meta.asset) ?? 0)),
        );
        let budget = target - held;
        if (budget <= BigInt(Math.floor(Number(equity) * band))) continue;
        if (budget > cash - FEE) budget = cash - FEE;
        if (budget < 1_000_000n) continue;
        const fill = settle(
          { cash: cash.toString(), position: '0' },
          'buy',
          modeledTerms(
            'buy',
            budget,
            s.hourly.next().open,
            s.meta.roundTripBps,
          ),
          budget,
        );
        cash = BigInt(fill.book.cash);
        s.quantity += BigInt(fill.book.position);
        fills++;
      }
    }
    let equity = cash;
    let positions = 0;
    for (const s of series) {
      const price = s.hourly.latest()?.close;
      if (price === undefined || s.quantity === 0n) continue;
      equity += value(s, price);
      positions++;
    }
    curve.push({ at, equityUsdc: usdc(equity), positions });
  }
  return { equity: curve, fills };
}

/** Hold the `top` strongest assets by `lookbackDays` daily change, equally weighted. */
export function momentumTargets(top = 5, lookbackDays = 60) {
  return (ctx: RebalanceContext) => {
    const ranked = [...ctx.closes]
      .filter(([, c]) => c.length > lookbackDays)
      .map(([asset, c]) => ({
        asset,
        change: c[c.length - 1] / c[c.length - 1 - lookbackDays] - 1,
      }))
      .sort((a, b) => b.change - a.change || a.asset.localeCompare(b.asset))
      .slice(0, top);
    return new Map(ranked.map((r) => [r.asset, 1 / top]));
  };
}

/** Every asset equally while the index is above its `days`-day average, otherwise cash. */
export function trendHoldTargets(days = 50) {
  return (ctx: RebalanceContext) => {
    if (aboveAverage(ctx.indexCloses, days) !== true)
      return new Map<string, number>();
    const assets = [...ctx.closes].filter(([, c]) => c.length > 0);
    return new Map(assets.map(([asset]) => [asset, 1 / assets.length]));
  };
}

/** Any targets, but only while the market switch is on; cash otherwise. */
export function switchedTargets(
  regime: RegimeSwitch,
  inner: (ctx: RebalanceContext) => Map<string, number>,
) {
  return (ctx: RebalanceContext) =>
    regimeOn(ctx.indexCloses, ctx.breadthPct, regime)
      ? inner(ctx)
      : new Map<string, number>();
}

export interface BacktestMetrics {
  finalUsdc: number;
  returnPct: number;
  maxDrawdownPct: number;
  trades: number;
  winRatePct: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  profitFactor: number | null;
  avgHoldHours: number | null;
  /** Spread, allowance and fees paid across all trades. */
  frictionUsdc: number;
  /** Share of decision hours with at least one open position. */
  exposurePct: number;
  byRule: Record<EntryRule, { trades: number; pnlUsdc: number }>;
  byExit: Partial<Record<ExitReason, number>>;
  monthly: { month: string; returnPct: number }[];
}

export function metrics(
  curve: EquityPoint[],
  trades: BacktestTrade[] = [],
): BacktestMetrics {
  const start = Number(START) / 1e6;
  let peak = start;
  let drawdown = 0;
  for (const p of curve) {
    peak = Math.max(peak, p.equityUsdc);
    drawdown = Math.max(drawdown, 1 - p.equityUsdc / peak);
  }
  const final = curve.at(-1)?.equityUsdc ?? start;
  const wins = trades.filter((t) => t.pnlUsdc > 0);
  const losses = trades.filter((t) => t.pnlUsdc <= 0);
  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const grossWin = wins.reduce((a, t) => a + t.pnlUsdc, 0);
  const grossLoss = -losses.reduce((a, t) => a + t.pnlUsdc, 0);
  const monthEnds = new Map<string, number>();
  for (const p of curve)
    monthEnds.set(new Date(p.at).toISOString().slice(0, 7), p.equityUsdc);
  let previous = start;
  const monthly = [...monthEnds].map(([month, value]) => {
    const returnPct = 100 * (value / previous - 1);
    previous = value;
    return { month, returnPct };
  });
  const byRule = {
    'breakout-v1': { trades: 0, pnlUsdc: 0 },
    'pullback-v1': { trades: 0, pnlUsdc: 0 },
  };
  const byExit: Partial<Record<ExitReason, number>> = {};
  for (const t of trades) {
    byRule[t.rule].trades++;
    byRule[t.rule].pnlUsdc += t.pnlUsdc;
    byExit[t.reason] = (byExit[t.reason] ?? 0) + 1;
  }
  return {
    finalUsdc: final,
    returnPct: 100 * (final / start - 1),
    maxDrawdownPct: 100 * drawdown,
    trades: trades.length,
    winRatePct: trades.length ? (100 * wins.length) / trades.length : null,
    avgWinPct: mean(wins.map((t) => t.returnPct)),
    avgLossPct: mean(losses.map((t) => t.returnPct)),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    avgHoldHours: mean(trades.map((t) => t.holdHours)),
    frictionUsdc: trades.reduce((a, t) => a + t.frictionUsdc, 0),
    exposurePct: curve.length
      ? (100 * curve.filter((p) => p.positions > 0).length) / curve.length
      : 0,
    byRule,
    byExit,
    monthly,
  };
}

export const BACKTEST_VERSION = 'backtest-v1';
