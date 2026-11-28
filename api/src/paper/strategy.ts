import type { MarketCandle } from '../../types/market';
import {
  PAPER_MODEL,
  PAPER_STRATEGIES,
  type PaperBar,
  type PaperBook,
  type PaperSignal,
  type PaperQuoteTerms,
  type PaperValuation,
  type PaperStrategy,
} from '../../types/paper';
import type { PaperBarSource, PaperExitGuard } from '../../types/paper-market';
import { USDC_MINT } from '../config/constants';
import type { JupiterQuoteRaw } from '../execution/jupiter/jupiter.types';

export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const STRATEGIES = PAPER_STRATEGIES;
export type Strategy = PaperStrategy;
export const START_CASH = BigInt(PAPER_MODEL.startingUsdcRaw);
export const INITIAL: PaperBook = {
  cash: PAPER_MODEL.startingUsdcRaw,
  position: '0',
};
export type Book = PaperBook;
type Observation = PaperBar;

/** A later observation may restore enough coverage to evaluate this strategy. */
export class IncompleteHistory extends Error {
  constructor(interval: 'daily' | 'hourly' = 'daily') {
    super('insufficient_recent_' + interval + '_bars');
  }
}

export function history(
  bars: MarketCandle[],
  now: number,
  interval: 'daily' | 'hourly' = 'daily',
): Observation[] {
  const hourly = interval === 'hourly';
  const duration = hourly ? HOUR : DAY;
  const rows = bars
    .map((b) => ({
      time: b.timestamp.getTime(),
      high: b.high,
      low: b.low,
      close: b.close,
      ...(Number.isFinite(b.volume) ? { volume: b.volume } : {}),
    }))
    .filter((b) => b.time + duration <= now)
    .sort((a, b) => a.time - b.time)
    .slice(-21);
  if (rows.length < 21 || now - rows[20].time > (hourly ? 2 * HOUR : 5 * DAY))
    throw new IncompleteHistory(interval);
  if (
    hourly &&
    !rows.some((row, i) => i > 0 && row.time - rows[i - 1].time === HOUR)
  )
    throw new IncompleteHistory(interval);
  for (const [index, row] of rows.entries()) {
    const gap = index ? row.time - rows[index - 1].time : duration;
    if (gap > 5 * DAY) throw new IncompleteHistory(interval);
    if (
      gap < (hourly ? HOUR : DAY - HOUR) ||
      ![row.close, row.high, row.low].every(Number.isFinite) ||
      row.low <= 0 ||
      row.close < row.low ||
      row.close > row.high
    )
      throw new Error('invalid_' + interval + '_bars');
  }
  return rows;
}

export function decide(
  strategy: Strategy,
  rows: Observation[],
  book: Book,
): PaperSignal {
  const prior = rows.slice(0, -1);
  const close = rows[rows.length - 1].close;
  const mean = prior.reduce((s, r) => s + r.close, 0) / prior.length;
  const recent = prior.slice(-5);
  const holding = book.position !== '0';
  switch (strategy) {
    case 'buy-hold-v1':
      return holding ? 'hold' : 'buy';
    case 'breakout-v1':
      if (holding)
        return close < Math.min(...recent.map((r) => r.low)) ? 'sell' : 'hold';
      return close > Math.max(...prior.map((r) => r.high)) ? 'buy' : 'hold';
    case 'pullback-v1': {
      const recentMean =
        recent.reduce((sum, bar) => sum + bar.close, 0) / recent.length;
      if (holding) return close >= recentMean || close < mean ? 'sell' : 'hold';
      const yesterday = recent[recent.length - 1].close;
      return close > mean &&
        close < yesterday &&
        yesterday < recent[recent.length - 2].close
        ? 'buy'
        : 'hold';
    }
  }
  throw new Error('unknown_strategy_version');
}

export type Signal = ReturnType<typeof decide>;

/**
 * Exit prices for a long holding: the price at which `decide` would sell if it
 * were the next close after these 21-bar windows. Breakout exits on either
 * timeframe set the stop. A pullback entry also exits below the hourly 20-bar
 * mean and takes profit at the hourly five-bar mean.
 */
export function exitLevels(
  daily: Observation[],
  hourly: Observation[],
  entryRule?: 'breakout-v1' | 'pullback-v1',
): { stop: number; target?: number } {
  const recentLow = (rows: Observation[]) =>
    Math.min(...rows.slice(-5).map((r) => r.low));
  const meanClose = (rows: Observation[]) =>
    rows.reduce((sum, r) => sum + r.close, 0) / rows.length;
  const stop = Math.max(recentLow(hourly), recentLow(daily));
  if (entryRule !== 'pullback-v1') return { stop };
  return {
    stop: Math.max(stop, meanClose(hourly.slice(-20))),
    target: meanClose(hourly.slice(-5)),
  };
}

const GUARD_SCALE = 1_000_000_000;

/**
 * Restate exit prices as the holding's quoted sale value. `referencePrice` is
 * the candle series' latest price and `referenceValueUsdcRaw` the position's
 * quoted USDC output, both observed in the same review, so the guard carries
 * the token's price relative to its candles without needing token decimals.
 */
export function exitGuard(
  levels: { stop: number; target?: number },
  referencePrice: number,
  referenceValueUsdcRaw: string,
  source: PaperBarSource,
  at: Date,
): PaperExitGuard | null {
  const value = BigInt(referenceValueUsdcRaw);
  const valid = (price?: number): price is number =>
    price !== undefined && Number.isFinite(price) && price > 0;
  if (!valid(referencePrice) || value <= 0n || !valid(levels.stop)) return null;
  const scaled = (price: number) =>
    (
      (value * BigInt(Math.round((price / referencePrice) * GUARD_SCALE))) /
      BigInt(GUARD_SCALE)
    ).toString();
  return {
    stopUsdcRaw: scaled(levels.stop),
    ...(valid(levels.target) ? { targetUsdcRaw: scaled(levels.target) } : {}),
    source,
    referencePrice,
    referenceValueUsdcRaw,
    setAt: at.toISOString(),
  };
}

/** Compare the holding's live quoted sale value with its guard. */
export function guardExit(
  guard: PaperExitGuard | undefined,
  liveValueUsdcRaw: string,
): 'stop' | 'target' | null {
  if (!guard) return null;
  const live = BigInt(liveValueUsdcRaw);
  if (live < BigInt(guard.stopUsdcRaw)) return 'stop';
  if (guard.targetUsdcRaw !== undefined && live >= BigInt(guard.targetUsdcRaw))
    return 'target';
  return null;
}

export function orderInput(signal: Signal, book: Book) {
  if (signal === 'buy')
    return (BigInt(book.cash) * BigInt(PAPER_MODEL.entryCashBps)) / 10000n;
  return BigInt(book.position); // full exit or liquidation mark
}

export function quoteTerms(
  raw: JupiterQuoteRaw,
  mint: string,
  signal: Signal,
  amount: bigint,
): PaperQuoteTerms {
  const buy = signal === 'buy';
  if (
    raw.inputMint !== (buy ? USDC_MINT : mint) ||
    raw.outputMint !== (buy ? mint : USDC_MINT) ||
    raw.swapMode !== 'ExactIn' ||
    raw.inAmount !== amount.toString() ||
    raw.slippageBps !== PAPER_MODEL.slippageBps ||
    !raw.routePlan?.length ||
    !/^\d{1,30}$/.test(raw.otherAmountThreshold ?? '') ||
    !/^\d{1,30}$/.test(raw.outAmount)
  )
    throw new Error('invalid_route_terms');
  const floor = BigInt(raw.otherAmountThreshold!);
  const expected = BigInt(raw.outAmount);
  if (
    floor <= 0n ||
    floor > expected ||
    floor < (expected * BigInt(10000 - PAPER_MODEL.slippageBps)) / 10000n
  )
    throw new Error('invalid_route_output');
  return {
    inputMint: raw.inputMint,
    outputMint: raw.outputMint,
    input: raw.inAmount,
    quotedOutput: raw.outAmount,
    minimumOutput: floor.toString(),
    slot: raw.contextSlot ?? null,
  };
}
export type Terms = PaperQuoteTerms;

/** A fill's net output: the route's expected output less the cost allowance. */
export function netOutput(terms: Pick<Terms, 'quotedOutput'>): bigint {
  return (
    (BigInt(terms.quotedOutput) *
      BigInt(10000 - PAPER_MODEL.costAllowanceBps)) /
    10000n
  );
}

// Fill at the route's expected output less a 1 bp allowance and 0.01 USDC per fill.
export function settle(
  book: Book,
  signal: Signal,
  terms: Terms | null,
  input: bigint = orderInput(signal, book),
): PaperValuation {
  let cash = BigInt(book.cash);
  let position = BigInt(book.position);
  let equity = cash;
  if (signal !== 'hold' || position > 0n) {
    if (!terms || BigInt(terms.input) !== input)
      throw new Error('missing_matching_quote');
    const net = netOutput(terms);
    if (net <= 0n) throw new Error('output_below_precision');
    if (signal === 'buy') {
      cash -= BigInt(terms.input) + BigInt(PAPER_MODEL.fixedCostUsdcRaw);
      position = net;
      if (cash < 0n) throw new Error('insufficient_paper_cash');
      return {
        book: { cash: String(cash), position: String(position) },
        liquidationEquityUsdcRaw: null,
      };
    }
    equity = cash + net - BigInt(PAPER_MODEL.fixedCostUsdcRaw);
    if (equity < 0n) throw new Error('insufficient_paper_cash');
    if (signal === 'sell') {
      cash = equity;
      position = 0n;
    }
  }
  return {
    book: { cash: String(cash), position: String(position) },
    liquidationEquityUsdcRaw: String(equity),
  };
}
