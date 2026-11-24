import { DAY, decide, history, INITIAL, quoteTerms, settle } from './strategy';
import { backtest } from '../../scripts/paper-backtest';
import type { MarketCandle } from '../../types/market';
import type { JupiterQuoteRaw } from '../execution/jupiter/jupiter.types';

function bars(closes: number[]): MarketCandle[] {
  return closes.map((close, i) => ({
    timestamp: new Date(i * DAY),
    open: close,
    high: close,
    low: close,
    close,
  }));
}
describe('daily paper strategies', () => {
  it('uses completed bars and enters and exits only at the following open', () => {
    const candles = bars([...Array<number>(20).fill(100), 110, 150, 80, 70]);
    const { decisions, finalBook } = backtest('breakout-v1', candles);
    expect(decisions.map((d) => d.signal)).toEqual(['buy', 'hold', 'sell']);
    expect(finalBook.position).toBe('0');
    expect(Number(finalBook.cash) / 1e6).toBeCloseTo(9460.13, 0);
    expect(history(candles, 21 * DAY).at(-1)?.close).toBe(110);
  });
  it('distinguishes a two-day pullback above trend from a breakout', () => {
    const rows = history(
      bars([...Array<number>(18).fill(90), 110, 108, 106]),
      21 * DAY,
    );
    expect(decide('pullback-v1', rows, INITIAL)).toBe('buy');
    expect(decide('breakout-v1', rows, INITIAL)).toBe('hold');
  });
  it('records a long gap and resumes when the signal window recovers', () => {
    const sample = bars([...Array<number>(45).fill(100), 110, 105]);
    sample
      .slice(18)
      .forEach((b) => (b.timestamp = new Date(+b.timestamp + 10 * DAY)));
    const report = backtest('breakout-v1', sample);
    expect(report.deferredBars).toBeGreaterThan(0);
    expect(report.decisions[0]).toMatchObject({
      signal: 'defer',
      equityUsd: 10000,
    });
    expect(report.decisions.at(-1)?.signal).toBe('buy');
    expect(report.benchmarkReturnPct).toBeGreaterThan(0);
  });
  it('rejects stale, incomplete and duplicate evidence', () => {
    const candles = bars(Array<number>(21).fill(10));
    expect(() => history(candles, 30 * DAY)).toThrow();
    expect(() => history(candles, 20 * DAY)).toThrow();
    candles[1] = candles[0];
    expect(() => history(candles, 21 * DAY)).toThrow();
  });
  it('rejects unmatched routes and missing exit marks', () => {
    expect(() =>
      quoteTerms(
        { inputMint: 'unexpected' } as JupiterQuoteRaw,
        'mint',
        'buy',
        100n,
      ),
    ).toThrow();
    expect(() =>
      settle({ cash: '100', position: '1' }, 'hold', null),
    ).toThrow();
  });
});
