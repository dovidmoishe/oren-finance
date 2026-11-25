import {
  DAY,
  HOUR,
  decide,
  exitGuard,
  exitLevels,
  guardExit,
  history,
  INITIAL,
  quoteTerms,
  settle,
} from './strategy';
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
    expect(decide('buy-hold-v1', rows, INITIAL)).toBe('buy');
    expect(
      decide('buy-hold-v1', rows, { cash: '9000000000', position: '1' }),
    ).toBe('hold');
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
  it('uses only closed hourly candles and rejects stale or daily-resolution hourly data', () => {
    const hourly = bars(Array<number>(22).fill(100)).map((bar, i) => ({
      ...bar,
      timestamp: new Date(i * HOUR),
    }));
    expect(history(hourly, 21.5 * HOUR, 'hourly').at(-1)?.time).toBe(20 * HOUR);
    expect(() => history(hourly, 25 * HOUR, 'hourly')).toThrow(
      'insufficient_recent_hourly_bars',
    );
    expect(() =>
      history(bars(Array<number>(21).fill(100)), 20 * DAY + HOUR, 'hourly'),
    ).toThrow('insufficient_recent_hourly_bars');
  });
  it('derives exit prices that match the rules decide applies to the next close', () => {
    const rows = (lows: number[], closes: number[]) =>
      closes.map((close, i) => ({
        time: i * HOUR,
        high: close + 1,
        low: lows[i],
        close,
      }));
    const closes = [...Array<number>(16).fill(100), 104, 106, 108, 110, 112];
    const hourly = rows(
      closes.map((c) => c - 2),
      closes,
    );
    const daily = rows(Array<number>(21).fill(95), Array<number>(21).fill(100));
    const breakout = exitLevels(daily, hourly);
    expect(breakout).toEqual({ stop: 102 }); // lowest of the last five hourly lows
    const held = { cash: '9000000000', position: '1' };
    const next = (close: number) => [
      ...hourly.slice(1),
      { time: 21 * HOUR, high: close, low: close, close },
    ];
    expect(decide('breakout-v1', next(101.99), held)).toBe('sell');
    expect(decide('breakout-v1', next(102), held)).toBe('hold');
    const pullback = exitLevels(daily, hourly, 'pullback-v1');
    expect(pullback.stop).toBeCloseTo(
      (15 * 100 + 104 + 106 + 108 + 110 + 112) / 20,
    );
    expect(pullback.target).toBeCloseTo(108);
    expect(decide('pullback-v1', next(108), held)).toBe('sell');
    expect(decide('pullback-v1', next(107.9), held)).toBe('hold');
  });

  it('states exit prices as the position quote and checks live quotes against them', () => {
    const at = new Date('2026-11-25T15:30:00Z');
    const guard = exitGuard(
      { stop: 95, target: 110 },
      100,
      '1000000000',
      'stock',
      at,
    )!;
    expect(guard).toEqual({
      stopUsdcRaw: '950000000',
      targetUsdcRaw: '1100000000',
      source: 'stock',
      referencePrice: 100,
      referenceValueUsdcRaw: '1000000000',
      setAt: at.toISOString(),
    });
    expect(guardExit(guard, '949999999')).toBe('stop');
    expect(guardExit(guard, '950000000')).toBeNull();
    expect(guardExit(guard, '1100000000')).toBe('target');
    expect(guardExit(undefined, '1')).toBeNull();
    expect(
      exitGuard({ stop: Number.NaN }, 100, '1000', 'token', at),
    ).toBeNull();
    expect(exitGuard({ stop: 95 }, 0, '1000', 'token', at)).toBeNull();
    expect(exitGuard({ stop: 95 }, 100, '0', 'token', at)).toBeNull();
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
