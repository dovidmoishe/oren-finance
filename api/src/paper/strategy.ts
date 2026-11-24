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
import { USDC_MINT } from '../config/constants';
import type { JupiterQuoteRaw } from '../execution/jupiter/jupiter.types';

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
  constructor() {
    super('insufficient_recent_daily_bars');
  }
}

export function history(bars: MarketCandle[], now: number): Observation[] {
  const rows = bars
    .map((b) => ({
      time: b.timestamp.getTime(),
      high: b.high,
      low: b.low,
      close: b.close,
    }))
    .filter((b) => b.time + DAY <= now)
    .sort((a, b) => a.time - b.time)
    .slice(-21);
  if (rows.length < 21 || now - rows[20].time > 5 * DAY)
    throw new IncompleteHistory();
  for (const [index, row] of rows.entries()) {
    const gap = index ? row.time - rows[index - 1].time : DAY;
    if (gap > 5 * DAY) throw new IncompleteHistory();
    if (
      gap < DAY - 3600000 ||
      ![row.close, row.high, row.low].every(Number.isFinite) ||
      row.low <= 0 ||
      row.close < row.low ||
      row.close > row.high
    )
      throw new Error('invalid_daily_bars');
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

// Use the route floor plus a fixed 20 bps cost allowance and 0.01 USDC per fill.
export function settle(
  book: Book,
  signal: Signal,
  terms: Terms | null,
): PaperValuation {
  let cash = BigInt(book.cash);
  let position = BigInt(book.position);
  let equity = cash;
  if (signal !== 'hold' || position > 0n) {
    if (!terms || BigInt(terms.input) !== orderInput(signal, book))
      throw new Error('missing_matching_quote');
    const net =
      (BigInt(terms.minimumOutput) *
        BigInt(10000 - PAPER_MODEL.costAllowanceBps)) /
      10000n;
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
