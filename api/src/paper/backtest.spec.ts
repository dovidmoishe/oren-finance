import type { MarketCandle } from '../../types/market';
import { PAPER_MODEL } from '../../types/paper';
import {
  buyAndHold,
  decisionTimes,
  metrics,
  modeledTerms,
  momentumTargets,
  setupOutcome,
  simulate,
  simulateWeights,
  switchedTargets,
  trendHoldTargets,
  type BacktestAsset,
} from './backtest';
import { isStockSessionHour } from './market-data';
import { usMarketSession } from '../market/us-market-session';
import { HOUR } from './strategy';
import { DAILY_BREAKOUT_POLICY, HOURLY_POLICY, MARKET_SWITCH } from './swing';

const START = Date.parse('2026-08-03T00:00:00Z');
const END = Date.parse('2026-10-31T00:00:00Z');

/** Session-hour stock candles from a price path, plus daily candles aggregated per UTC date. */
function asset(
  id: string,
  price: (i: number) => number,
  roundTripBps = 20,
): BacktestAsset {
  const hourly: MarketCandle[] = [];
  for (let t = START, i = 0; t < END; t += HOUR) {
    if (!isStockSessionHour(t)) continue;
    const open = price(i);
    const close = price(i + 1);
    hourly.push({
      timestamp: new Date(t),
      open,
      close,
      high: Math.max(open, close) + 0.05,
      low: Math.min(open, close) - 0.05,
      volume: 1,
    });
    i++;
  }
  const days = new Map<string, MarketCandle[]>();
  for (const c of hourly) {
    const key = c.timestamp.toISOString().slice(0, 10);
    days.set(key, [...(days.get(key) ?? []), c]);
  }
  const daily = [...days].map(([day, rows]) => ({
    timestamp: new Date(day + 'T00:00:00Z'),
    open: rows[0].open,
    close: rows.at(-1)!.close,
    high: Math.max(...rows.map((r) => r.high)),
    low: Math.min(...rows.map((r) => r.low)),
    volume: 1,
  }));
  return { asset: id, ticker: id.toUpperCase(), roundTripBps, hourly, daily };
}

// Rises for about six weeks, then falls: breakouts first, then forced exits.
const trend = (i: number) =>
  i < 480 ? 100 + i * 0.05 : 124 - (i - 480) * 0.06;
const wave = (i: number) => 100 + 3 * Math.sin(i / 25);
const universe = () => [asset('trend', trend), asset('wave', wave, 40)];
const from = Date.parse('2026-09-08T00:00:00Z');
const to = Date.parse('2026-10-30T00:00:00Z');

describe('backtest replay', () => {
  for (const policy of [DAILY_BREAKOUT_POLICY, HOURLY_POLICY]) {
    it(`fills ${policy.version} decisions at the next candle's open, in the regular session`, () => {
      const assets = universe();
      const run = simulate(assets, { from, to, arm: 'rules', policy });
      expect(run.trades.length).toBeGreaterThan(0);
      for (const trade of run.trades) {
        const bars = assets.find((a) => a.asset === trade.asset)!.hourly;
        const entry = bars.find(
          (b) => b.timestamp.toISOString() === trade.entryAt,
        );
        expect(entry?.open).toBe(trade.entryPrice);
        // The decision is the end of the previous candle, which is in the regular session.
        expect(
          usMarketSession(new Date(Date.parse(trade.entryAt))).regular,
        ).toBe(true);
        expect(Date.parse(trade.exitAt)).toBeGreaterThan(
          Date.parse(trade.entryAt),
        );
      }
    });
  }

  it('never looks ahead: changing later candles leaves earlier decisions unchanged', () => {
    const cut = Date.parse('2026-10-08T00:00:00Z');
    const base = simulate(universe(), { from, to, arm: 'rules' });
    const shocked = universe().map((a) => ({
      ...a,
      hourly: a.hourly.map((c) =>
        +c.timestamp >= cut
          ? {
              ...c,
              open: c.open * 3,
              close: c.close * 3,
              high: c.high * 3,
              low: c.low * 3,
            }
          : c,
      ),
      daily: a.daily.map((c) =>
        +c.timestamp >= cut
          ? {
              ...c,
              open: c.open * 3,
              close: c.close * 3,
              high: c.high * 3,
              low: c.low * 3,
            }
          : c,
      ),
    }));
    const changed = simulate(shocked, { from, to, arm: 'rules' });
    const before = (run: typeof base) => run.equity.filter((p) => p.at < cut);
    expect(before(changed)).toEqual(before(base));
    expect(changed.equity).not.toEqual(base.equity);
  });

  it('charges half the measured round trip on each fill plus the shared allowance and fee', () => {
    const terms = modeledTerms('sell', 1_000_000n, 100, 40);
    expect(terms.quotedOutput).toBe(String(Math.floor(100_000_000 * 0.998)));
    const flatPrice = asset('flat', () => 100, 0);
    const curve = buyAndHold([flatPrice], from, to);
    const allowance = 1 - PAPER_MODEL.costAllowanceBps / 10000;
    const fees = (2 * Number(PAPER_MODEL.fixedCostUsdcRaw)) / 1e6;
    // Equity stays within a cent of the frictionless value less the allowance on both legs and two fees.
    expect(curve.at(-1)!.equityUsdc).toBeCloseTo(
      (10000 - fees / 2) * allowance * allowance - fees / 2,
      1,
    );
  });

  it('gives the AI the market backdrop from index candles completed by the decision', () => {
    const index = asset('qqq', trend).daily;
    const withIndex = simulate(universe(), {
      from,
      to,
      arm: 'ai',
      index,
      lookup: () => undefined,
    });
    const first = withIndex.pending[0].evidence.market!;
    expect(first.index).not.toBeNull();
    expect(first.breadthPct).toBeGreaterThanOrEqual(0);
    expect(first.setups).toBeGreaterThan(0);
    const without = simulate(universe(), {
      from,
      to,
      arm: 'ai',
      lookup: () => undefined,
    });
    expect(without.pending[0].evidence.market!.index).toBeNull();
    expect(without.pending[0].evidence.features.relativeMomentumPct).toBeNull();
  });

  it('treats an unreviewed AI setup as a skip and replays the rules when the AI agrees', () => {
    const assets = universe();
    const rules = simulate(assets, { from, to, arm: 'rules' });
    const unreviewed = simulate(assets, {
      from,
      to,
      arm: 'ai',
      lookup: () => undefined,
    });
    expect(unreviewed.trades).toEqual([]);
    expect(unreviewed.pending.length).toBeGreaterThan(0);
    expect(new Set(unreviewed.pending.map((p) => p.key)).size).toBe(
      unreviewed.pending.length,
    );
    const agrees = simulate(assets, {
      from,
      to,
      arm: 'ai',
      lookup: (p) => ({
        version: 'test',
        model: 'test',
        rationale: 'agree',
        selected: p.evidence.entryRules[0],
      }),
    });
    expect(agrees.trades.map((t) => ({ ...t, rationale: undefined }))).toEqual(
      rules.trades,
    );
    expect(agrees.pending).toEqual([]);
  });

  it('scores a single setup exactly as the portfolio replay trades it', () => {
    const one = [asset('trend', trend)];
    const run = simulate(one, { from, to, arm: 'rules' });
    const first = run.trades[0];
    const outcome = setupOutcome(
      one[0],
      Date.parse(first.entryAt),
      undefined,
      to,
    )!;
    expect(outcome).toMatchObject({
      entryAt: Date.parse(first.entryAt),
      entryPrice: first.entryPrice,
      exitAt: Date.parse(first.exitAt),
      exitPrice: first.exitPrice,
      reason: first.reason,
      rule: first.rule,
    });
    expect(outcome.returnPct).toBeCloseTo(first.returnPct, 6);
    // No setup when the asset is not signalling an entry.
    const quiet = asset('flat', () => 100);
    expect(setupOutcome(quiet, Date.parse('2026-10-01T15:00:00Z'))).toBeNull();
  });

  it('summarizes returns, drawdown, win rate and exits', () => {
    const run = simulate(universe(), { from, to, arm: 'rules' });
    const m = metrics(run.equity, run.trades);
    expect(m.trades).toBe(run.trades.length);
    expect(m.finalUsdc).toBe(run.equity.at(-1)!.equityUsdc);
    expect(m.maxDrawdownPct).toBeGreaterThanOrEqual(0);
    expect(Object.values(m.byExit).reduce((a, b) => a + b, 0)).toBe(m.trades);
    expect(m.frictionUsdc).toBeGreaterThan(0);
    expect(
      decisionTimes(universe(), from, to).every((t) => t >= from && t <= to),
    ).toBe(true);
  });
});

describe('market switch and portfolio benchmarks', () => {
  const falling = (i: number) => 150 - i * 0.05;
  const rising = (i: number) => 100 + i * 0.05;

  it('blocks breakout entries while the index is below its 50-day average', () => {
    const switched = { ...DAILY_BREAKOUT_POLICY, regime: MARKET_SWITCH };
    const fallingIndex = asset('qqq', falling).daily;
    const blocked = simulate(universe(), {
      from,
      to,
      arm: 'rules',
      policy: switched,
      index: fallingIndex,
    });
    expect(blocked.trades).toEqual([]);
    expect(blocked.switchedOff).toBeGreaterThan(0);
    // With no index at all the switch is off, never on by default.
    expect(
      simulate(universe(), { from, to, arm: 'rules', policy: switched }).trades,
    ).toEqual([]);
    const open = simulate(universe(), {
      from,
      to,
      arm: 'rules',
      policy: switched,
      index: asset('qqq', rising).daily,
    });
    expect(open.switchedOff).toBeLessThan(blocked.switchedOff);
  });

  it('rotates into the strongest assets and never looks ahead', () => {
    const assets = [
      asset('up', rising, 0),
      asset('down', falling, 0),
      asset('wave', wave, 0),
    ];
    const run = simulateWeights(assets, {
      from,
      to,
      schedule: 'weekly',
      targets: momentumTargets(1, 20),
    });
    expect(run.fills).toBeGreaterThan(0);
    expect(run.equity.at(-1)!.equityUsdc).toBeGreaterThan(10000);
    const cut = Date.parse('2026-10-08T00:00:00Z');
    const shocked = assets.map((a) => ({
      ...a,
      hourly: a.hourly.map((c) =>
        +c.timestamp >= cut
          ? {
              ...c,
              open: c.open * 3,
              close: c.close * 3,
              high: c.high * 3,
              low: c.low * 3,
            }
          : c,
      ),
      daily: a.daily.map((c) =>
        +c.timestamp >= cut
          ? {
              ...c,
              open: c.open * 3,
              close: c.close * 3,
              high: c.high * 3,
              low: c.low * 3,
            }
          : c,
      ),
    }));
    const changed = simulateWeights(shocked, {
      from,
      to,
      schedule: 'weekly',
      targets: momentumTargets(1, 20),
    });
    const before = (r: typeof run) => r.equity.filter((p) => p.at < cut);
    expect(before(changed)).toEqual(before(run));
  });

  it('holds everything only while the index trends up, and switches to cash otherwise', () => {
    const ctx = (indexCloses: number[], breadthPct: number | null) => ({
      at: 0,
      closes: new Map([
        ['a', [1]],
        ['b', [1]],
      ]),
      indexCloses,
      breadthPct,
    });
    const up = Array.from({ length: 51 }, (_, i) => 100 + i);
    const down = [...up].reverse();
    expect([...trendHoldTargets(50)(ctx(up, 60))]).toEqual([
      ['a', 0.5],
      ['b', 0.5],
    ]);
    expect(trendHoldTargets(50)(ctx(down, 60)).size).toBe(0);
    expect(trendHoldTargets(50)(ctx(up.slice(-10), 60)).size).toBe(0);
    const inner = () => new Map([['a', 1]]);
    expect(switchedTargets(MARKET_SWITCH, inner)(ctx(up, 60)).size).toBe(1);
    expect(switchedTargets(MARKET_SWITCH, inner)(ctx(up, 40)).size).toBe(0);
    expect(switchedTargets(MARKET_SWITCH, inner)(ctx(up, null)).size).toBe(0);
  });
});
