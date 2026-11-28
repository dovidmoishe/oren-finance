/**
 * Market-wide backtest of the hourly swing trader (`npm run paper:backtest:market`).
 *
 * Replays the most liquid stock-feed assets over Tokens.xyz stock-market
 * candles with the same rules, sizing and cost model as the live paper cohort.
 * Arms: `rules` (take every top-ranked setup), `ai` (the AI reviewer decides
 * each setup; opt in with --ai) and an equal-weight buy-and-hold benchmark.
 *
 *   ENV_FILE=../../oren-finance/api/.env npm run paper:backtest:market -- \
 *     [--from 2026-04-01] [--to 2026-11-27] [--universe 60] \
 *     [--ai --max-ai-calls 600 --concurrency 6] [--refresh]
 *
 * Downloads, measured spreads and AI reviews are cached under .cache/paper-backtest.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import OpenAI from 'openai';
import { USDC_MINT } from '../src/config/constants';
import {
  isNyseTradingDay,
  stockSessionBars,
  STOCK_FEED_SOURCE,
} from '../src/paper/market-data';
import {
  BACKTEST_VERSION,
  buyAndHold,
  metrics,
  simulate,
  type BacktestAsset,
  equalWeightTargets,
  momentumTargets,
  sessionCandles,
  setupOutcome,
  simulateWeights,
  switchedTargets,
  trendHoldTargets,
  type WeightsOptions,
  type BacktestRun,
  type BacktestTrade,
  type SetupOutcome,
  type EquityPoint,
  type PendingReview,
} from '../src/paper/backtest';
import {
  PaperResearchAgent,
  SETUP_REVIEW_VERSION,
} from '../src/paper/paper-research';
import {
  DAILY_BREAKOUT_POLICY,
  DAILY_BREAKOUT_SWITCH_POLICY,
  HOURLY_POLICY,
  MARKET_SWITCH,
  MARKET_INDEX_ASSET,
  SWING_POLICY,
  type SwingPolicy,
} from '../src/paper/swing';
import { DAY } from '../src/paper/strategy';
import {
  extractAssetList,
  extractCandles,
  mapCandles,
  mapEquityList,
} from '../src/tokens/tokens.mapper';
import { PAPER_MODEL, type PaperResearch } from '../types/paper';
import type { Equity } from '../types/equity';
import type { MarketCandle } from '../types/market';

config({ path: process.env.ENV_FILE ?? '.env', quiet: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes('--' + name);
const option = (name: string, fallback: string) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const CACHE = join(process.cwd(), '.cache', 'paper-backtest');
mkdirSync(CACHE, { recursive: true });
const from = Date.parse(option('from', '2026-04-01') + 'T00:00:00Z');
const to = Math.min(
  Date.now(),
  Date.parse(
    option('to', new Date().toISOString().slice(0, 10)) + 'T23:59:59Z',
  ),
);
const universeSize = Number(option('universe', String(SWING_POLICY.scanLimit)));
const refresh = flag('refresh');
const withAi = flag('ai');
const maxAiCalls = Number(option('max-ai-calls', '600'));
const concurrency = Number(option('concurrency', '6'));
const split = Date.parse(option('split', '2026-08-01') + 'T00:00:00Z');

/** A fixed, small set of variants compared on an in-sample and an out-of-sample window. */
const VARIANTS: Record<string, SwingPolicy> = {
  'hourly-both': HOURLY_POLICY,
  'hourly-breakout': {
    ...HOURLY_POLICY,
    version: 'hourly-breakout',
    rules: ['breakout-v1'],
  },
  'daily-both': {
    ...HOURLY_POLICY,
    version: 'daily-swing',
    timeframe: 'daily',
  },
  'daily-breakout': DAILY_BREAKOUT_POLICY,
  'breakout + switch': DAILY_BREAKOUT_SWITCH_POLICY,
};

/** Simple portfolio benchmarks on the same clock and costs, parameters fixed before testing. */
const PORTFOLIOS: Record<
  string,
  Pick<WeightsOptions, 'schedule' | 'targets'>
> = {
  'momentum top 5': { schedule: 'weekly', targets: momentumTargets(5, 60) },
  'momentum + switch': {
    schedule: 'weekly',
    targets: switchedTargets(MARKET_SWITCH, momentumTargets(5, 60)),
  },
  'trend-filtered hold': { schedule: 'daily', targets: trendHoldTargets(50) },
};
const LIVE_VARIANT = Object.entries(VARIANTS).find(
  ([, p]) => p === SWING_POLICY,
)![0];
if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to)
  throw new Error('Invalid --from/--to');

const TOKENS =
  (process.env.TOKENS_API_BASE_URL ?? 'https://api.tokens.xyz') + '/v1';
const TOKENS_KEY = process.env.TOKENS_API_KEY;
const JUPITER = (
  process.env.JUPITER_API_URL ?? 'https://api.jup.ag/swap/v1'
).replace(/\/$/, '');
if (!TOKENS_KEY) throw new Error('TOKENS_API_KEY is required (set ENV_FILE)');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...parts: unknown[]) => console.error(...parts);

async function getJson(
  url: string,
  headers: Record<string, string>,
  attempt = 0,
): Promise<unknown> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if ((response.status === 429 || response.status >= 500) && attempt < 4) {
    await sleep(1000 * 2 ** attempt);
    return getJson(url, headers, attempt + 1);
  }
  if (!response.ok) throw new Error(`${response.status} ${url.split('?')[0]}`);
  return response.json();
}
const tokens = (path: string, query: Record<string, string | number>) => {
  const url = new URL(TOKENS + path);
  for (const [k, v] of Object.entries(query))
    url.searchParams.set(k, String(v));
  return getJson(url.toString(), {
    Accept: 'application/json',
    'x-api-key': TOKENS_KEY,
  });
};

function cached<T>(
  name: string,
  maxAgeMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const file = join(CACHE, name);
  if (!refresh && existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as {
      savedAt: number;
      value: T;
    };
    if (Date.now() - saved.savedAt < maxAgeMs)
      return Promise.resolve(saved.value);
  }
  return load().then((value) => {
    writeFileSync(file, JSON.stringify({ savedAt: Date.now(), value }));
    return value;
  });
}

async function pool<T, R>(
  items: T[],
  size: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await work(items[i]);
      }
    }),
  );
  return out;
}

interface UniverseRow {
  asset: string;
  ticker: string;
  mint: string;
  liquidity: number;
}

/** The scan universe: stock-feed assets with a tradable token, most liquid first. */
async function loadUniverse(): Promise<UniverseRow[]> {
  const all = await cached('catalog.json', DAY, async () => {
    const stocks: Equity[] = [];
    for (let offset = 0; ; offset += 50) {
      const raw = (await tokens('/assets/curated', {
        list: 'stocks',
        groupBy: 'asset',
        offset,
        limit: 50,
      })) as { pagination?: { hasMore?: boolean } };
      const page = mapEquityList(extractAssetList(raw));
      stocks.push(...page);
      if (!page.length || raw.pagination?.hasMore === false) break;
    }
    return stocks;
  });
  return all
    .filter((s) => s.canonicalMarketSource === STOCK_FEED_SOURCE)
    .map((s) => {
      const variant = s.variants
        .filter((v) => v.tradable && v.mint && v.mint !== USDC_MINT)
        .sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0))[0];
      return {
        asset: s.id,
        ticker: s.ticker,
        mint: variant?.mint ?? '',
        liquidity: variant?.liquidity ?? s.liquidity ?? 0,
      };
    })
    .filter((r) => r.mint && r.liquidity >= SWING_POLICY.minLiquidityUsd)
    .sort((a, b) => b.liquidity - a.liquidity || a.asset.localeCompare(b.asset))
    .slice(0, universeSize);
}

const revive = (rows: MarketCandle[]) =>
  rows.map((c) => ({ ...c, timestamp: new Date(c.timestamp) }));

async function loadCandles(row: UniverseRow) {
  const window = (interval: string, start: number) => ({
    interval,
    from: Math.floor(start / 1000),
    to: Math.floor(to / 1000),
    mint: row.mint,
  });
  const read = async (interval: string, start: number) =>
    mapCandles(
      extractCandles(
        await tokens(
          `/assets/${encodeURIComponent(row.asset)}/price-chart`,
          window(interval, start),
        ),
      ),
    ).sort((a, b) => +a.timestamp - +b.timestamp);
  const key = `candles-${row.asset}-${new Date(from).toISOString().slice(0, 10)}-${new Date(to).toISOString().slice(0, 13)}.json`;
  const raw = await cached(key, 7 * DAY, async () => ({
    hourly: await read('1H', from - 10 * DAY),
    // 150 days back so 60-session momentum and the 50-day market average exist on day one.
    daily: await read('1D', from - 150 * DAY),
  }));
  const hourly = stockSessionBars(revive(raw.hourly), 'hourly');
  const daily = stockSessionBars(revive(raw.daily), 'daily');
  return hourly && daily ? { hourly: hourly.bars, daily: daily.bars } : null;
}

/** Round trip of a $1,000 swap on Jupiter right now, in basis points. */
async function measureSpread(row: UniverseRow): Promise<number | null> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.JUPITER_API_KEY)
    headers['x-api-key'] = process.env.JUPITER_API_KEY;
  const quote = async (
    inputMint: string,
    outputMint: string,
    amount: string,
  ) => {
    const url = new URL(JUPITER + '/quote');
    url.searchParams.set('inputMint', inputMint);
    url.searchParams.set('outputMint', outputMint);
    url.searchParams.set('amount', amount);
    url.searchParams.set('slippageBps', String(PAPER_MODEL.slippageBps));
    return (await getJson(url.toString(), headers)) as { outAmount?: string };
  };
  try {
    const buy = await quote(USDC_MINT, row.mint, '1000000000');
    await sleep(400);
    if (!buy.outAmount) return null;
    const sell = await quote(row.mint, USDC_MINT, buy.outAmount);
    await sleep(400);
    if (!sell.outAmount) return null;
    return Math.max(0, 10000 * (1 - Number(sell.outAmount) / 1e9));
  } catch {
    return null;
  }
}

type SavedReviews = Record<
  string,
  PaperResearch & { asset: string; at: number }
>;
const reviewFile = (model: string) =>
  join(
    CACHE,
    `reviews-${model.replace(/[^\w.-]/g, '_')}-${SETUP_REVIEW_VERSION}.json`,
  );

function reviewStore(model: string) {
  const file = reviewFile(model);
  type Saved = SavedReviews;
  const saved: Saved = existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as Saved)
    : {};
  return {
    get: (key: string) => saved[key],
    set: (p: PendingReview, research: PaperResearch) => {
      saved[p.key] = { ...research, asset: p.asset, at: p.at };
    },
    size: () => Object.keys(saved).length,
    save: () => writeFileSync(file, JSON.stringify(saved)),
  };
}

const daily = (curve: EquityPoint[]) => {
  const last = new Map<string, EquityPoint>();
  for (const p of curve) last.set(new Date(p.at).toISOString().slice(0, 10), p);
  return [...last.values()];
};

/** Seeded generator so the bootstrap intervals are reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ScoredSetup {
  asset: string;
  day: string;
  approved: boolean;
  rationale: string;
  outcome: SetupOutcome;
}

const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;

function group(rows: ScoredSetup[]) {
  const r = rows.map((x) => x.outcome.returnPct).sort((a, b) => a - b);
  return {
    n: r.length,
    meanPct: mean(r),
    medianPct: r.length ? r[Math.floor(r.length / 2)] : NaN,
    winPct: r.length ? (100 * r.filter((x) => x > 0).length) / r.length : NaN,
    /** Sum of outcomes on a 1,000 USDC entry each. */
    pnlUsdc: r.reduce((a, b) => a + b * 10, 0),
  };
}

/**
 * Mean outcome of approved setups minus skipped setups, with a 95% interval
 * from resampling whole trading days (setups on one day move together).
 */
function approvalEdge(rows: ScoredSetup[], draws = 4000) {
  const diff = (xs: ScoredSetup[]) =>
    mean(xs.filter((x) => x.approved).map((x) => x.outcome.returnPct)) -
    mean(xs.filter((x) => !x.approved).map((x) => x.outcome.returnPct));
  const days = new Map<string, ScoredSetup[]>();
  for (const row of rows)
    days.set(row.day, [...(days.get(row.day) ?? []), row]);
  const clusters = [...days.values()];
  const random = mulberry32(142);
  const samples: number[] = [];
  for (let i = 0; i < draws; i++) {
    const sample: ScoredSetup[] = [];
    for (let j = 0; j < clusters.length; j++)
      sample.push(...clusters[Math.floor(random() * clusters.length)]);
    const d = diff(sample);
    if (Number.isFinite(d)) samples.push(d);
  }
  samples.sort((a, b) => a - b);
  return {
    diffPct: diff(rows),
    low95: samples[Math.floor(0.025 * samples.length)],
    high95: samples[Math.floor(0.975 * samples.length)],
    /** Share of resamples where approved setups did better than skipped ones. */
    probPositive: samples.filter((x) => x > 0).length / samples.length,
    days: clusters.length,
  };
}

/**
 * Score every setup an AI reviewed (one decision per asset and trading day,
 * the first review of that daily candle, as the live cohort reuses it) by
 * what a lone 1,000 USDC trade from it earned under the same exits.
 */
function scoreReviews(assets: BacktestAsset[]) {
  const policy = VARIANTS[option('variant', LIVE_VARIANT)];
  const models = option('models', 'gpt-5.5,gpt-5-mini').split(',');
  const byAsset = new Map(assets.map((a) => [a.asset, a]));
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  const scored: Record<string, ScoredSetup[]> = {};
  for (const model of models) {
    const file = reviewFile(model);
    if (!existsSync(file)) {
      log(`no ${SETUP_REVIEW_VERSION} reviews cached for ${model}`);
      continue;
    }
    const saved = JSON.parse(readFileSync(file, 'utf8')) as SavedReviews;
    const seen = new Set<string>();
    const rows: ScoredSetup[] = [];
    for (const review of Object.values(saved).sort((a, b) => a.at - b.at)) {
      const key = review.asset + '|' + day(review.at);
      const asset = byAsset.get(review.asset);
      if (seen.has(key) || !asset || review.at < from || review.at > to)
        continue;
      const outcome = setupOutcome(asset, review.at, policy, to);
      if (!outcome) continue;
      seen.add(key);
      rows.push({
        asset: review.asset,
        day: day(review.at),
        approved: (review.selected ?? 'cash') !== 'cash',
        rationale: review.rationale,
        outcome,
      });
    }
    scored[model] = rows;
  }
  const pct = (v: number) =>
    Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) + '%' : '—';
  const summary: Record<string, unknown> = {};
  for (const [model, rows] of Object.entries(scored)) {
    const all = group(rows);
    const approved = group(rows.filter((r) => r.approved));
    const skipped = group(rows.filter((r) => !r.approved));
    const edge = approvalEdge(rows);
    summary[model] = { all, approved, skipped, edge };
    console.log(`\n${model} · ${all.n} setups over ${edge.days} trading days`);
    for (const [label, g] of [
      ['every setup', all],
      ['approved', approved],
      ['skipped', skipped],
    ] as const)
      console.log(
        `  ${label.padEnd(12)} n ${String(g.n).padStart(4)}  mean ${pct(g.meanPct).padStart(8)}  median ${pct(g.medianPct).padStart(8)}  win ${g.winPct.toFixed(0).padStart(3)}%  P&L ${g.pnlUsdc.toFixed(0).padStart(7)} USDC`,
      );
    console.log(
      `  approved − skipped ${pct(edge.diffPct)} per setup, 95% interval ${pct(edge.low95)} to ${pct(edge.high95)}, better in ${(100 * edge.probPositive).toFixed(0)}% of resamples`,
    );
  }
  const [a, b] = Object.keys(scored);
  let agreement: Record<string, ReturnType<typeof group>> | null = null;
  if (a && b) {
    const other = new Map(scored[b].map((r) => [r.asset + '|' + r.day, r]));
    const cells: Record<string, ScoredSetup[]> = {};
    for (const row of scored[a]) {
      const match = other.get(row.asset + '|' + row.day);
      if (!match) continue;
      const cell =
        row.approved && match.approved
          ? 'both take'
          : !row.approved && !match.approved
            ? 'both skip'
            : row.approved
              ? `${a} only`
              : `${b} only`;
      (cells[cell] ??= []).push(row);
    }
    agreement = Object.fromEntries(
      Object.entries(cells).map(([k, v]) => [k, group(v)]),
    );
    console.log(`\nsetups both models reviewed`);
    for (const [cell, g] of Object.entries(agreement))
      console.log(
        `  ${cell.padEnd(18)} n ${String(g.n).padStart(4)}  mean ${pct(g.meanPct).padStart(8)}  win ${g.winPct.toFixed(0)}%`,
      );
  }
  const out = join(CACHE, 'review-scores.json');
  writeFileSync(
    out,
    JSON.stringify(
      {
        policy: policy.version,
        reviewVersion: SETUP_REVIEW_VERSION,
        window: {
          from: new Date(from).toISOString(),
          to: new Date(to).toISOString(),
        },
        summary,
        agreement,
        setups: scored,
      },
      null,
      2,
    ),
  );
  console.log(`\nscores: ${out}`);
}

interface DailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/**
 * Tiingo split- and dividend-adjusted daily prices. The token is read from a
 * file and sent only as a request header; it is never logged or cached.
 */
function tiingo(token: string, start: string, end: string) {
  return (ticker: string) =>
    cached(`tiingo-${ticker}-${start}-${end}.json`, 7 * DAY, async () => {
      const url = new URL(
        `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(ticker)}/prices`,
      );
      url.searchParams.set('startDate', start);
      url.searchParams.set('endDate', end);
      const rows = (await getJson(url.toString(), {
        Accept: 'application/json',
        Authorization: `Token ${token}`,
      })) as {
        date: string;
        adjOpen: number;
        adjHigh: number;
        adjLow: number;
        adjClose: number;
        adjVolume: number;
      }[];
      return rows.map((r): DailyBar => ({
        date: r.date,
        open: r.adjOpen,
        high: r.adjHigh,
        low: r.adjLow,
        close: r.adjClose,
        volume: r.adjVolume,
      }));
    });
}

/**
 * Daily-candle replay over long history: each trading day is one session
 * candle, so strategies decide on the close and fill at the next open, with
 * each asset's measured Jupiter round trip. Settings are the ones fixed
 * before the eight-month test; nothing here is tuned.
 */
async function longHistory(
  universe: UniverseRow[],
  spreads: Record<string, number | null>,
) {
  const keyFile = option(
    'tiingo-key-file',
    process.env.TIINGO_TOKEN_FILE ?? '',
  );
  if (!keyFile || !existsSync(keyFile))
    throw new Error(
      'Pass --tiingo-key-file <path> (or TIINGO_TOKEN_FILE) holding a Tiingo API token',
    );
  const token = readFileSync(keyFile, 'utf8').trim();
  const start = option('history-from', '2008-01-01');
  const end = new Date(to).toISOString().slice(0, 10);
  const fetchDaily = tiingo(token, start, end);
  const assets: BacktestAsset[] = [];
  const missing: { asset: string; reason: string }[] = [];
  // --tickers swaps the hindsight-picked token list for a fixed list, such as the S&P sector funds.
  const custom = option('tickers', '')
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
  const indexTicker = option('index-ticker', 'QQQ').toUpperCase();
  const rows: (UniverseRow & { spread: number | null })[] = custom.length
    ? custom.map((t) => ({
        asset: t.toLowerCase(),
        ticker: t,
        mint: '',
        liquidity: 0,
        spread: 10,
      }))
    : universe.map((r) => ({ ...r, spread: spreads[r.asset] ?? null }));
  for (const row of rows) {
    const spread = row.spread;
    if (spread == null || spread > SWING_POLICY.maxRoundTripBps) continue;
    const ticker = row.ticker.replace(/\./g, '-');
    try {
      const bars = await fetchDaily(ticker);
      if (bars.length < 60) {
        missing.push({ asset: row.asset, reason: 'too_little_history' });
        continue;
      }
      assets.push({
        asset: row.asset,
        ticker: row.ticker,
        roundTripBps: spread,
        ...sessionCandles(bars),
      });
    } catch (err) {
      missing.push({
        asset: row.asset,
        reason: err instanceof Error ? err.message.split(' ')[0] : 'error',
      });
    }
  }
  const qqqBars = await fetchDaily(indexTicker);
  const qqq = sessionCandles(qqqBars);
  const qqqAsset: BacktestAsset = {
    asset: indexTicker.toLowerCase(),
    ticker: indexTicker,
    roundTripBps: 10,
    ...qqq,
  };
  const index = qqq.daily;
  log(
    `long history ${start} → ${end}, index ${indexTicker}: ${assets.length} assets${missing.length ? `, skipped ${missing.map((m) => `${m.asset} (${m.reason})`).join(', ')}` : ''}`,
  );
  for (const a of assets)
    log(
      `  ${a.ticker.padEnd(6)} from ${a.hourly[0].timestamp.toISOString().slice(0, 10)}`,
    );

  type Run = {
    equity: EquityPoint[];
    trades?: BacktestTrade[];
    fills?: number;
  };
  const strategies: [string, (a: number, b: number) => Run][] = [
    [
      `${indexTicker} hold`,
      (a, b) => ({ equity: buyAndHold([qqqAsset], a, b) }),
    ],
    [
      'Equal weight, weekly',
      (a, b) =>
        simulateWeights(assets, {
          from: a,
          to: b,
          index,
          schedule: 'weekly',
          targets: equalWeightTargets(),
        }),
    ],
    [
      'Daily breakout',
      (a, b) =>
        simulate(assets, {
          from: a,
          to: b,
          arm: 'rules',
          policy: DAILY_BREAKOUT_POLICY,
          index,
        }),
    ],
    [
      'Breakout + switch',
      (a, b) =>
        simulate(assets, {
          from: a,
          to: b,
          arm: 'rules',
          policy: DAILY_BREAKOUT_SWITCH_POLICY,
          index,
        }),
    ],
    [
      'Momentum top 5',
      (a, b) =>
        simulateWeights(assets, {
          from: a,
          to: b,
          index,
          schedule: 'weekly',
          targets: momentumTargets(5, 60),
        }),
    ],
    [
      'Momentum + switch',
      (a, b) =>
        simulateWeights(assets, {
          from: a,
          to: b,
          index,
          schedule: 'weekly',
          targets: switchedTargets(MARKET_SWITCH, momentumTargets(5, 60)),
        }),
    ],
    [
      'Trend-filtered hold',
      (a, b) =>
        simulateWeights(assets, {
          from: a,
          to: b,
          index,
          schedule: 'daily',
          targets: trendHoldTargets(50),
        }),
    ],
  ];
  const periods: [string, string, string][] = [
    ['2008–2012', start, '2013-01-01'],
    ['2013–2017', '2013-01-01', '2018-01-01'],
    ['2018–2022', '2018-01-01', '2023-01-01'],
    ['2023–2026', '2023-01-01', end],
    ['full', start, end],
  ];
  const at = (d: string) => Date.parse(d + 'T00:00:00Z');
  const results: Record<
    string,
    Record<string, ReturnType<typeof metrics> & { fills?: number }>
  > = {};
  const yearly: Record<string, Record<string, number>> = {};
  const curves: Record<string, [number, number][]> = {};
  for (const [name, run] of strategies) {
    results[name] = {};
    for (const [label, a, b] of periods) {
      const r = run(at(a), at(b) + DAY - 1);
      results[name][label] = {
        ...metrics(r.equity, r.trades ?? []),
        ...(r.fills !== undefined ? { fills: r.fills } : {}),
      };
      if (label === 'full') {
        const ends = new Map<string, number>();
        for (const p of r.equity)
          ends.set(new Date(p.at).toISOString().slice(0, 4), p.equityUsdc);
        let previous = 10000;
        yearly[name] = {};
        for (const [year, value] of ends) {
          yearly[name][year] = 100 * (value / previous - 1);
          previous = value;
        }
        const weekly = new Map<number, number>();
        for (const p of r.equity)
          weekly.set(Math.floor(p.at / (7 * DAY)), p.equityUsdc);
        curves[name] = [...weekly].map(([w, v]) => [
          w * 7 * DAY,
          Math.round(v),
        ]);
      }
    }
  }
  console.log(
    `\nlong history · CAGR / worst drop · ${assets.length} assets + ${indexTicker}`,
  );
  console.log('strategy'.padEnd(22), ...periods.map(([l]) => l.padStart(18)));
  for (const [name] of strategies)
    console.log(
      name.padEnd(22),
      ...periods.map(([l]) => {
        const m = results[name][l];
        return `${m.cagrPct.toFixed(1).padStart(6)}% ${m.maxDrawdownPct.toFixed(0).padStart(3)}%`.padStart(
          18,
        );
      }),
    );
  const years = Object.keys(yearly[`${indexTicker} hold`]);
  console.log(
    '\nyear     ' +
      strategies.map(([n]) => n.slice(0, 11).padStart(12)).join(''),
  );
  for (const y of years)
    console.log(
      y.padEnd(9) +
        strategies
          .map(([n]) => ((yearly[n][y] ?? 0).toFixed(1) + '%').padStart(12))
          .join(''),
    );
  const grid: {
    top: number;
    lookback: number;
    cagrPct: number;
    maxDrawdownPct: number;
  }[] = [];
  for (const top of [3, 5, 8, 12])
    for (const lookback of [20, 60, 120, 250]) {
      const m = metrics(
        simulateWeights(assets, {
          from: at(start),
          to: at(end) + DAY - 1,
          index,
          schedule: 'weekly',
          targets: momentumTargets(top, lookback),
        }).equity,
      );
      grid.push({
        top,
        lookback,
        cagrPct: m.cagrPct,
        maxDrawdownPct: m.maxDrawdownPct,
      });
    }
  console.log('\nmomentum settings, full period CAGR / worst drop');
  for (const g of grid)
    console.log(
      `  top ${String(g.top).padStart(2)} · ${String(g.lookback).padStart(3)} days  ${g.cagrPct.toFixed(1).padStart(6)}%  ${g.maxDrawdownPct.toFixed(0)}%`,
    );
  const out = join(
    CACHE,
    custom.length
      ? `long-history-${indexTicker.toLowerCase()}-custom.json`
      : 'long-history.json',
  );
  writeFileSync(
    out,
    JSON.stringify(
      {
        start,
        end,
        stocks: assets.map((a) => ({
          asset: a.asset,
          ticker: a.ticker,
          from: a.hourly[0].timestamp.toISOString().slice(0, 10),
          roundTripBps: a.roundTripBps,
        })),
        missing,
        results,
        yearly,
        grid,
        curves,
      },
      null,
      1,
    ),
  );
  console.log(`\nreport: ${out}`);
}

async function main() {
  const universe = await loadUniverse();
  log(
    `universe: ${universe.length} stock-feed assets with ≥ $${SWING_POLICY.minLiquidityUsd.toLocaleString()} liquidity`,
  );

  const spreads = await cached(
    `spreads-${universe.length}.json`,
    DAY,
    async () => {
      const out: Record<string, number | null> = {};
      for (const row of universe) out[row.asset] = await measureSpread(row);
      return out;
    },
  );

  if (flag('long-history')) {
    await longHistory(universe, spreads);
    return;
  }

  const loaded = await pool(universe, 4, async (row) => ({
    row,
    candles: await loadCandles(row),
  }));
  const assets: BacktestAsset[] = [];
  const excluded: { asset: string; reason: string }[] = [];
  for (const { row, candles } of loaded) {
    const spread = spreads[row.asset];
    if (spread == null)
      excluded.push({ asset: row.asset, reason: 'no_jupiter_route' });
    else if (spread > SWING_POLICY.maxRoundTripBps)
      excluded.push({
        asset: row.asset,
        reason: `round_trip_${Math.round(spread)}bps`,
      });
    else if (!candles)
      excluded.push({ asset: row.asset, reason: 'no_stock_session_candles' });
    else
      assets.push({
        asset: row.asset,
        ticker: row.ticker,
        roundTripBps: spread,
        ...candles,
      });
  }
  log(
    `tradable with stock candles: ${assets.length}; excluded: ${excluded.length}`,
  );
  // Market backdrop for the AI: QQQ daily closes on NYSE trading days.
  const index = await cached(
    `index-${MARKET_INDEX_ASSET}-${new Date(to).toISOString().slice(0, 13)}.json`,
    7 * DAY,
    async () =>
      mapCandles(
        extractCandles(
          await tokens(`/assets/${MARKET_INDEX_ASSET}/price-chart`, {
            interval: '1D',
            from: Math.floor((from - 150 * DAY) / 1000),
            to: Math.floor(to / 1000),
          }),
        ),
      ),
  ).then((rows) =>
    revive(rows)
      .filter((c) => isNyseTradingDay(+c.timestamp))
      .sort((a, b) => +a.timestamp - +b.timestamp),
  );
  log(`market index ${MARKET_INDEX_ASSET}: ${index.length} daily candles`);

  if (flag('score-reviews')) {
    scoreReviews(assets);
    return;
  }

  if (flag('sensitivity')) {
    // Neighbouring momentum settings, to see whether top 5 / 60 days is a lucky pick. Never used to choose.
    const windows = [
      ['in-sample', from, split],
      ['out-of-sample', split, to],
      ['full', from, to],
    ] as const;
    const hold = windows.map(
      ([, a, b]) => metrics(buyAndHold(assets, a, b)).returnPct,
    );
    console.log(
      `\nhold: ${hold.map((r) => r.toFixed(1) + '%').join(' / ')}  (in-sample / out-of-sample / full)`,
    );
    for (const top of [3, 5, 8, 12])
      for (const lookback of [20, 40, 60, 90]) {
        const cells = windows.map(([, a, b]) => {
          const m = metrics(
            simulateWeights(assets, {
              from: a,
              to: b,
              index,
              schedule: 'weekly',
              targets: momentumTargets(top, lookback),
            }).equity,
          );
          return `${m.returnPct.toFixed(1).padStart(6)}% dd ${m.maxDrawdownPct.toFixed(1).padStart(4)}%`;
        });
        console.log(
          `top ${String(top).padStart(2)} · ${String(lookback).padStart(2)} days  ${cells.join('   ')}`,
        );
      }
    return;
  }

  if (flag('variants')) {
    const windows = [
      ['in-sample', from, split],
      ['out-of-sample', split, to],
      ['full', from, to],
    ] as const;
    const table: Record<
      string,
      Record<string, ReturnType<typeof metrics>>
    > = {};
    for (const [label, start, end] of windows) {
      table['equal-weight hold'] = {
        ...table['equal-weight hold'],
        [label]: metrics(buyAndHold(assets, start, end)),
      };
      for (const [name, policy] of Object.entries(VARIANTS)) {
        const run = simulate(assets, {
          from: start,
          to: end,
          arm: 'rules',
          policy,
          index,
        });
        table[name] = {
          ...table[name],
          [label]: metrics(run.equity, run.trades),
        };
      }
      for (const [name, portfolio] of Object.entries(PORTFOLIOS)) {
        const run = simulateWeights(assets, {
          from: start,
          to: end,
          index,
          ...portfolio,
        });
        table[name] = {
          ...table[name],
          [label]: { ...metrics(run.equity), trades: run.fills },
        };
      }
    }
    console.log(
      `\nvariants · in-sample ${new Date(from).toISOString().slice(0, 10)} → ${new Date(split).toISOString().slice(0, 10)} · out-of-sample → ${new Date(to).toISOString().slice(0, 10)} · ${assets.length} assets`,
    );
    console.log('variant'.padEnd(18), ...windows.map(([w]) => w.padStart(30)));
    for (const [name, byWindow] of Object.entries(table))
      console.log(
        name.padEnd(18),
        ...windows.map(([w]) => {
          const m = byWindow[w];
          return `${m.returnPct.toFixed(1)}% dd ${m.maxDrawdownPct.toFixed(1)}% n ${m.trades} pf ${m.profitFactor?.toFixed(2) ?? '—'}`.padStart(
            30,
          );
        }),
      );
    writeFileSync(
      join(CACHE, 'variants.json'),
      JSON.stringify({ split: new Date(split).toISOString(), table }, null, 2),
    );
    return;
  }

  const policy = VARIANTS[option('variant', LIVE_VARIANT)];
  if (!policy)
    throw new Error(
      'Unknown --variant; use one of ' + Object.keys(VARIANTS).join(', '),
    );
  const rules = simulate(assets, { from, to, arm: 'rules', policy, index });
  const benchmark = buyAndHold(assets, from, to);
  const arms: BacktestRun[] = [rules];

  let ai:
    | (BacktestRun & { model: string; aiCalls: number; complete: boolean })
    | null = null;
  if (withAi) {
    if (!process.env.OPENAI_API_KEY)
      throw new Error('OPENAI_API_KEY is required for --ai');
    const model = option('model', process.env.PAPER_AI_MODEL || 'gpt-5.5');
    const agent = new PaperResearchAgent(
      new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
      { PAPER_AI_MODEL: model },
    );
    const store = reviewStore(model);
    let calls = 0;
    let run: BacktestRun;
    for (let pass = 1; ; pass++) {
      run = simulate(
        assets,
        {
          from,
          to,
          arm: 'ai',
          policy,
          index,
          lookup: (p) => store.get(p.key),
        },
        model,
      );
      if (!run.pending.length) break;
      const budget = maxAiCalls - calls;
      if (budget <= 0) {
        log(
          `AI budget of ${maxAiCalls} calls reached with ${run.pending.length} setups unreviewed`,
        );
        break;
      }
      const batch = run.pending.slice(0, budget);
      log(
        `AI pass ${pass}: reviewing ${batch.length} setups (${store.size()} cached)`,
      );
      let failed = 0;
      await pool(batch, concurrency, async (p) => {
        const research = await agent.review(p.evidence);
        // A failed call is not a decision: leave it pending for the next pass.
        if (research.error === 'research_unavailable') failed++;
        else store.set(p, research);
        // Keep finished reviews if the run is interrupted.
        if (++calls % 25 === 0) {
          store.save();
          log(`  ${calls} reviews`);
        }
      });
      store.save();
      if (failed) log(`  ${failed} reviews failed and stay pending`);
      if (failed === batch.length) {
        log('Every review in this pass failed; stopping the AI arm.');
        break;
      }
    }
    ai = { ...run, model, aiCalls: calls, complete: run.pending.length === 0 };
    arms.push(ai);
  }

  const results = {
    version: BACKTEST_VERSION,
    generatedAt: new Date().toISOString(),
    window: {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    },
    policy,
    costModel: {
      ...PAPER_MODEL,
      spread:
        'measured $1,000 Jupiter round trip per asset at run time, half per side',
      fills: 'open of the next hourly stock candle after each decision',
    },
    caveats: [
      "Universe is today's most liquid stock-feed assets, so delisted or illiquid names are missing (survivorship).",
      'Spreads are measured now and applied to the whole window; historical token spreads may have differed.',
      'Candles are stock-market prices. Tokens trade 24/7 and can drift from the stock outside sessions.',
      'Stops are checked on each completed hourly close in the 04:00–20:00 ET stock session, not continuously.',
    ],
    universe: assets.map((a) => ({
      asset: a.asset,
      ticker: a.ticker,
      roundTripBps: Math.round(a.roundTripBps * 10) / 10,
    })),
    excluded,
    benchmark: {
      name: 'equal-weight buy and hold',
      metrics: metrics(benchmark),
      equity: daily(benchmark),
    },
    arms: arms.map((r) => ({
      arm: r.arm,
      ...(r === ai
        ? {
            model: ai.model,
            aiCalls: ai.aiCalls,
            complete: ai.complete,
            unreviewed: ai.pending.length,
          }
        : {}),
      reviews: r.reviews,
      metrics: metrics(r.equity, r.trades),
      equity: daily(r.equity),
      trades: r.trades,
    })),
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = option('out', join(CACHE, `report-${stamp}.json`));
  writeFileSync(out, JSON.stringify(results, null, 2));

  const pct = (v: number | null | undefined, d = 2) =>
    v == null ? '—' : v.toFixed(d) + '%';
  const rows = [
    ['equal-weight hold', metrics(benchmark)],
    ...results.arms.map((a) => [a.arm, a.metrics] as const),
  ] as const;
  console.log(
    `\n${policy.version} ${BACKTEST_VERSION} · ${results.window.from.slice(0, 10)} → ${results.window.to.slice(0, 10)} · ${assets.length} assets`,
  );
  console.log(
    'arm'.padEnd(18),
    'return'.padStart(9),
    'maxDD'.padStart(8),
    'trades'.padStart(7),
    'win'.padStart(7),
    'PF'.padStart(6),
    'exposure'.padStart(9),
  );
  for (const [name, m] of rows)
    console.log(
      String(name).padEnd(18),
      pct(m.returnPct).padStart(9),
      pct(m.maxDrawdownPct).padStart(8),
      String(m.trades).padStart(7),
      pct(m.winRatePct, 0).padStart(7),
      (m.profitFactor == null ? '—' : m.profitFactor.toFixed(2)).padStart(6),
      pct(m.exposurePct, 0).padStart(9),
    );
  console.log(`\nreport: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
