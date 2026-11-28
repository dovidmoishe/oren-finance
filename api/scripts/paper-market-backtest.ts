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
  type BacktestRun,
  type EquityPoint,
  type PendingReview,
} from '../src/paper/backtest';
import {
  PaperResearchAgent,
  SETUP_REVIEW_VERSION,
} from '../src/paper/paper-research';
import {
  DAILY_BREAKOUT_POLICY,
  HOURLY_POLICY,
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
    daily: await read('1D', from - 65 * DAY),
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

function reviewStore(model: string) {
  const file = join(
    CACHE,
    `reviews-${model.replace(/[^\w.-]/g, '_')}-${SETUP_REVIEW_VERSION}.json`,
  );
  type Saved = Record<string, PaperResearch & { asset: string; at: number }>;
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
            from: Math.floor((from - 65 * DAY) / 1000),
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
