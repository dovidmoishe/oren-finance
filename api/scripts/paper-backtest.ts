/** Daily OHLC replay. Prices are USD per share and paper quantities are microshares. */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { MarketCandle } from '../types/market';
import {
  PAPER_MODEL,
  type PaperSignal,
  type PaperBook,
  type PaperStrategy,
} from '../types/paper';
import {
  DAY,
  decide,
  history,
  IncompleteHistory,
  INITIAL,
  orderInput,
  settle,
  START_CASH,
  STRATEGIES,
  type Terms,
} from '../src/paper/strategy';

function modeledQuote(
  input: bigint,
  side: 'buy' | 'sell',
  price: number,
): Terms {
  const output = Math.floor(
    Number(input) * (side === 'buy' ? 1 / price : price),
  );
  if (!Number.isSafeInteger(output) || output <= 0)
    throw new Error('Unrepresentable simulated output');
  return {
    input: input.toString(),
    quotedOutput: String(output),
    minimumOutput: String(
      (BigInt(output) * BigInt(10000 - PAPER_MODEL.slippageBps)) / 10000n,
    ),
    inputMint: side === 'buy' ? 'USD' : 'share',
    outputMint: side === 'buy' ? 'share' : 'USD',
    slot: null,
  };
}

function fill(book: PaperBook, side: 'buy' | 'sell', price: number) {
  return settle(book, side, modeledQuote(orderInput(side, book), side, price))
    .book;
}

function liquidationUsd(book: PaperBook, close: number) {
  if (book.position === '0') return Number(book.cash) / 1e6;
  return Number(fill(book, 'sell', close).cash) / 1e6;
}

interface ReplayDay {
  at: string;
  signal: PaperSignal | 'defer';
  reason?: string;
  equityUsd: number;
  benchmarkEquityUsd: number;
}

export function backtest(strategy: PaperStrategy, bars: MarketCandle[]) {
  if (bars.length < 22 || bars.length > 20000)
    throw new Error('Expected 22 to 20000 chronological daily bars');
  for (const [index, bar] of bars.entries()) {
    if (
      !Number.isFinite(+bar.timestamp) ||
      +bar.timestamp + DAY > Date.now() ||
      (index > 0 && +bar.timestamp <= +bars[index - 1].timestamp) ||
      ![bar.open, bar.high, bar.low, bar.close].every(
        (v) => Number.isFinite(v) && v > 0,
      ) ||
      Math.max(bar.open, bar.close) > bar.high ||
      Math.min(bar.open, bar.close) < bar.low
    )
      throw new Error('Invalid or unfinished OHLC data');
  }
  let book = INITIAL;
  let benchmark = INITIAL;
  const startingUsd = Number(START_CASH) / 1e6;
  let peak = startingUsd;
  let maxDrawdown = 0;
  const decisions: ReplayDay[] = [];

  for (let i = 21; i < bars.length; i++) {
    const next = bars[i];
    let signal: ReplayDay['signal'];
    try {
      const rows = history(bars.slice(i - 21, i), +next.timestamp);
      signal = decide(strategy, rows, book);
    } catch (error) {
      if (!(error instanceof IncompleteHistory)) throw error;
      signal = 'defer';
    }
    // Both portfolios can first enter at the open after a complete signal window.
    if (benchmark.position === '0' && signal !== 'defer')
      benchmark = fill(benchmark, 'buy', next.open);
    if (signal === 'buy' || signal === 'sell')
      book = fill(book, signal, next.open);
    const equityUsd = liquidationUsd(book, next.close);
    peak = Math.max(peak, equityUsd);
    maxDrawdown = Math.max(maxDrawdown, 1 - equityUsd / peak);
    decisions.push({
      at: next.timestamp.toISOString(),
      signal,
      ...(signal === 'defer'
        ? { reason: 'insufficient_recent_daily_bars' }
        : {}),
      equityUsd,
      benchmarkEquityUsd: liquidationUsd(benchmark, next.close),
    });
  }

  const last = decisions[decisions.length - 1];
  return {
    strategy,
    model: PAPER_MODEL,
    executionModel:
      'next open with modeled costs; daily liquidation at close with modeled exit costs',
    benchmark:
      'buy and hold the same stock using the same entry budget at the first eligible open',
    finalBook: book,
    returnPct: 100 * (last.equityUsd / startingUsd - 1),
    benchmarkReturnPct: 100 * (last.benchmarkEquityUsd / startingUsd - 1),
    maxDrawdownPct: 100 * maxDrawdown,
    fills: decisions.filter((d) => d.signal === 'buy' || d.signal === 'sell')
      .length,
    deferredBars: decisions.filter((d) => d.signal === 'defer').length,
    decisions,
  };
}

if (require.main === module) {
  const [name, file] = process.argv.slice(2);
  const strategy = z.enum(STRATEGIES).safeParse(name);
  if (!strategy.success || !file)
    throw new Error('Usage: paper:backtest <strategy> <bars.json>');
  const bar = z.object({
    timestamp: z.union([z.string(), z.number()]),
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
  });
  const input = z
    .array(bar)
    .min(22)
    .max(20000)
    .parse(JSON.parse(readFileSync(file, 'utf8')));
  const bars = input.map((b) => ({ ...b, timestamp: new Date(b.timestamp) }));
  console.log(JSON.stringify(backtest(strategy.data, bars), null, 2));
}
