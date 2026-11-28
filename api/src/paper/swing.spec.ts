import type { PaperBar } from '../../types/paper';
import { DAY, HOUR } from './strategy';
import {
  aboveAverage,
  regimeOn,
  MARKET_SWITCH,
  DAILY_BREAKOUT_POLICY,
  DAILY_BREAKOUT_SWITCH_POLICY,
  ENTRY_RULES,
  HOURLY_POLICY,
  SWING_POLICY,
  analyze,
  entryBudget,
  entrySignal,
  indexTrend,
  marketContext,
  rankSetups,
  reviewable,
  roundTripBps,
  rulesChoice,
  setupEvidence,
  setupFeatures,
  signalBars,
} from './swing';

const bars = (closes: number[], step = DAY): PaperBar[] =>
  closes.map((close, i) => ({
    time: 1_790_000_000_000 + i * step,
    high: close + 0.5,
    low: close - 0.5,
    close,
  }));
const flat = (close = 100, step = DAY) =>
  bars(Array<number>(21).fill(close), step);
/** The last close clears the prior 20 highs. */
const breakout = (step = HOUR) =>
  bars([...Array<number>(20).fill(100), 102], step);

describe('swing analysis', () => {
  it('runs the live cohort on daily breakout behind the market switch', () => {
    expect(SWING_POLICY).toBe(DAILY_BREAKOUT_SWITCH_POLICY);
    expect(SWING_POLICY).toMatchObject({
      version: 'daily-breakout-switch-v1',
      timeframe: 'daily',
      rules: ['breakout-v1'],
      regime: MARKET_SWITCH,
    });
    const daily = flat();
    const hourly = breakout();
    expect(signalBars(DAILY_BREAKOUT_POLICY, { daily, hourly })).toBe(daily);
    expect(signalBars(HOURLY_POLICY, { daily, hourly })).toBe(hourly);
  });

  it('finds an entry only when an allowed rule buys and the daily trend permits it', () => {
    const daily = flat();
    const analysis = analyze(daily, breakout(), undefined, ENTRY_RULES);
    expect(analysis.signals['breakout-v1']).toBe('buy');
    expect(analysis.entryRules).toEqual(['breakout-v1']);
    expect(analysis.trendAllowsEntry).toBe(true);

    // The pullback rule may be signalling, but a breakout-only policy never enters on it.
    const pullback = bars(
      [...Array<number>(18).fill(100), 104, 103, 102],
      HOUR,
    );
    const rising = bars([...Array<number>(20).fill(100), 101]);
    expect(
      analyze(rising, pullback, undefined, ENTRY_RULES).entryRules,
    ).toEqual(['pullback-v1']);
    expect(
      analyze(rising, pullback, undefined, ['breakout-v1']).entryRules,
    ).toEqual([]);

    // A latest daily close below the prior 20-day mean masks every buy.
    const weak = bars([...Array<number>(20).fill(100), 99]);
    const blocked = analyze(weak, breakout(), undefined, ENTRY_RULES);
    expect(blocked.trendAllowsEntry).toBe(false);
    expect(blocked.signals['breakout-v1']).toBe('hold');
    expect(blocked.entryRules).toEqual([]);
  });

  it('never offers an entry on a holding and flags its mandatory exit', () => {
    const held = analyze(flat(), breakout(), { entryRule: 'breakout-v1' });
    expect(held.entryRules).toEqual([]);
    expect(held.riskExit).toBe(false);
    const broken = bars([...Array<number>(20).fill(100), 98], HOUR);
    expect(analyze(flat(), broken, { entryRule: 'breakout-v1' }).riskExit).toBe(
      true,
    );
  });

  it('reports the asset decline and momentum separately from any account figure', () => {
    const daily = bars([
      ...Array<number>(10).fill(120),
      ...Array<number>(11).fill(90),
    ]);
    const analysis = analyze(daily, flat(90, HOUR));
    expect(analysis.assetDeclineFromHighPct).toBeCloseTo(25);
    expect(analysis.momentumPct).toBeCloseTo(-25);
  });
});

describe('swing selection and sizing', () => {
  const setup = (asset: string, momentumPct: number, entry = true) => ({
    asset,
    analysis: {
      ...analyze(flat(), breakout(), undefined, ENTRY_RULES),
      momentumPct,
      ...(entry ? {} : { entryRules: [] }),
    },
  });

  it('ranks setups by momentum and limits reviews to free position slots', () => {
    const ranked = rankSetups([
      setup('a', 1),
      setup('b', 5),
      setup('c', 3),
      setup('none', 9, false),
      setup('d', 3),
    ]);
    expect(ranked.map((s) => s.asset)).toEqual(['b', 'c', 'd', 'a']);
    expect(reviewable(ranked, new Set(), 0).map((s) => s.asset)).toEqual([
      'b',
      'c',
      'd',
    ]);
    expect(reviewable(ranked, new Set(['b']), 1).map((s) => s.asset)).toEqual([
      'c',
      'd',
      'a',
    ]);
    expect(
      reviewable(ranked, new Set(), SWING_POLICY.maxPositions - 1),
    ).toHaveLength(1);
    expect(reviewable(ranked, new Set(), SWING_POLICY.maxPositions)).toEqual(
      [],
    );
  });

  it('sizes entries from marked equity and never spends the fill fee', () => {
    expect(entryBudget(10_000n, 20_000n, 10n)).toBe(2_000n);
    expect(entryBudget(1_500n, 20_000n, 10n)).toBe(1_490n);
    expect(entryBudget(5n, 20_000n, 10n)).toBe(0n);
  });

  it('measures a quote round trip in basis points', () => {
    expect(roundTripBps(1_000_000_000n, 990_000_000n)).toBe(100);
    expect(roundTripBps(1_000_000_000n, 999_750_000n)).toBe(2.5);
    expect(roundTripBps(0n, 0n)).toBe(Infinity);
  });

  it('enters only on a chosen rule that is itself signalling a buy', () => {
    const analysis = analyze(flat(), breakout(), undefined, ENTRY_RULES);
    expect(rulesChoice(analysis)).toBe('breakout-v1');
    expect(entrySignal(analysis, 'breakout-v1')).toBe('buy');
    expect(entrySignal(analysis, 'pullback-v1')).toBe('hold');
    expect(entrySignal(analysis, 'cash')).toBe('hold');
  });
});

describe('AI setup evidence', () => {
  it('rebases prices and carries no ticker, mint or timestamp', () => {
    const daily = bars([...Array<number>(20).fill(200), 204]);
    const hourly = bars([...Array<number>(20).fill(200), 204], HOUR);
    const analysis = analyze(daily, hourly, undefined, ENTRY_RULES);
    const evidence = setupEvidence(daily, hourly, analysis, HOURLY_POLICY);
    expect(evidence.hourly.at(-1)).toEqual([100.25, 99.75, 100]);
    expect(evidence.daily).toHaveLength(21);
    expect(evidence.trendMean).toBe(98.04);
    const text = JSON.stringify(evidence);
    for (const leak of ['"time"', '"asset"', '"mint"', '"ticker"', '1790000'])
      expect(text).not.toContain(leak);
  });

  it('omits hourly candles for a daily policy so one review covers the session', () => {
    const daily = bars([...Array<number>(20).fill(100), 102]);
    const analysis = analyze(daily, daily);
    const first = setupEvidence(daily, flat(100, HOUR), analysis);
    const later = setupEvidence(daily, flat(101, HOUR), analysis);
    expect(first.hourly).toEqual([]);
    expect(first).toEqual(later);
    expect(first.timeframe).toBe('daily');
  });
});

describe('market backdrop and setup measures', () => {
  it('reads the index trend from its last 21 daily closes', () => {
    const rising = bars([
      ...Array<number>(15).fill(100),
      101,
      102,
      103,
      104,
      105,
      110,
    ]);
    expect(indexTrend(rising)).toEqual({
      aboveTrend: true,
      change20dPct: 10,
      change5dPct: 8.91,
    });
    expect(indexTrend(rising.slice(-20))).toBeNull();
  });

  it('measures breadth over every scanned asset and counts setups', () => {
    const context = marketContext(
      null,
      [
        { trendAllowsEntry: true },
        { trendAllowsEntry: false },
        { trendAllowsEntry: true },
      ],
      1,
    );
    expect(context).toEqual({ index: null, breadthPct: 66.67, setups: 1 });
    expect(marketContext(null, [], 0).breadthPct).toBeNull();
  });

  it('describes volume, extension, range and strength against the index', () => {
    const daily = bars([...Array<number>(20).fill(100), 102]).map((b, i) => ({
      ...b,
      volume: i === 20 ? 3000 : 1000,
    }));
    const analysis = analyze(daily, daily);
    const market = marketContext(
      bars([...Array<number>(20).fill(100), 104]),
      [analysis],
      1,
    );
    expect(setupFeatures(daily, analysis, market)).toEqual({
      volumeRatio: 3,
      avgRangePct: 0.98,
      extensionPct: 1.49,
      relativeMomentumPct: -2,
    });
    // Without volume or an index, those measures are unknown rather than zero.
    expect(setupFeatures(flat(), analyze(flat(), flat()))).toMatchObject({
      volumeRatio: null,
      relativeMomentumPct: null,
    });
    const evidence = setupEvidence(
      daily,
      daily,
      analysis,
      DAILY_BREAKOUT_POLICY,
      market,
    );
    expect(evidence.market).toBe(market);
    expect(JSON.stringify(evidence)).not.toContain('3000');
  });
});

describe('market switch', () => {
  it('compares the latest close with the mean of the closes before it', () => {
    expect(aboveAverage([1, 2, 3, 2], 3)).toBe(true);
    expect(aboveAverage([3, 2, 3, 2], 3)).toBe(false);
    expect(aboveAverage([1, 2], 3)).toBeNull();
  });

  it('is on only when the index trend and breadth agree', () => {
    const up = Array.from({ length: 51 }, (_, i) => 100 + i);
    expect(MARKET_SWITCH).toEqual({ indexAverageDays: 50, minBreadthPct: 50 });
    expect(regimeOn(up, 50, MARKET_SWITCH)).toBe(true);
    expect(regimeOn(up, 49.9, MARKET_SWITCH)).toBe(false);
    expect(regimeOn([...up].reverse(), 80, MARKET_SWITCH)).toBe(false);
    expect(regimeOn(up.slice(-20), 80, MARKET_SWITCH)).toBe(false);
    expect(regimeOn(up, null, MARKET_SWITCH)).toBe(false);
  });
});
