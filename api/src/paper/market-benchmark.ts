import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { DRIZZLE, USDC_MINT } from '../config/constants';
import type { Database } from '../database/database.provider';
import {
  paperAiAccounts as accounts,
  paperMarketAccounts as previousAccounts,
  paperAiScreens as screens,
} from '../database/schema';
import { MarketService } from '../market/market.service';
import { usMarketSession } from '../market/us-market-session';
import { TokensService } from '../tokens/tokens.service';
import type { Equity, EquitySummary } from '../../types/equity';
import type { MarketCandle } from '../../types/market';
import type { UsMarketSessionState } from '../../types/market-session';
import {
  PAPER_MODEL,
  type PaperBar,
  type PaperResearch,
  type PaperSignal,
} from '../../types/paper';
import {
  accountPolicy,
  aiAccountIds,
  legacyAiAccountIds,
  type AiAccountId,
  type MarketBook,
  type MarketObservation,
  type MarketRound,
  type PaperBarSource,
  type ScanSetup,
  type ScreenRow,
} from '../../types/paper-market';
import {
  STOCK_FEED_SOURCE,
  isNyseTradingDay,
  stockSessionBars,
} from './market-data';
import {
  DAY,
  HOUR,
  exitGuard,
  exitLevels,
  guardExit,
  history,
  settle,
} from './strategy';
import {
  MARKET_INDEX_ASSET,
  SWING_POLICY,
  analyze,
  marketContext,
  entryBudget,
  entrySignal,
  rankSetups,
  reviewable,
  roundTripBps,
  rulesChoice,
  setupEvidence,
  signalBars,
  type EntryRule,
  type SwingAnalysis,
} from './swing';
import { PaperService } from './paper.service';
import { PaperResearchAgent } from './paper-research';
import { StockCatalogRepository } from '../tokens/stock-catalog.repository';

// Ten days from funding.
const FINAL_HOUR = 240;
const EXPERIMENT = 'five-ai-v2';
const FEE = BigInt(PAPER_MODEL.fixedCostUsdcRaw);
const MIN_ENTRY = 1_000_000n;
/**
 * v2 scans are keyed by the absolute clock hour (about 495,000 in 2026); the
 * first cohort keyed four-hour screens by epoch (0 to 240) in the same table.
 */
const SCAN_HOUR_FLOOR = Math.floor(Date.parse('2026-01-01T00:00:00Z') / HOUR);
const cohort: readonly AiAccountId[] = aiAccountIds;
const legacy: readonly AiAccountId[] = legacyAiAccountIds;

/** Every asset a report mentions: holdings, scanned candidates and reviewed assets. */
export function benchmarkAssetIds(
  all: { state: MarketBook; rounds: MarketRound[] }[],
): string[] {
  const ids = new Set<string>();
  for (const account of all) {
    for (const id of Object.keys(account.state.positions)) ids.add(id);
    for (const round of account.rounds) {
      for (const id of round.candidates ?? []) ids.add(id);
      for (const obs of round.observations ?? []) ids.add(obs.asset);
    }
  }
  return [...ids].sort();
}

type Account = typeof accounts.$inferSelect;
type Holding = MarketBook['positions'][string];
type ReviewBars = {
  source: PaperBarSource;
  session?: UsMarketSessionState;
  dropped: number;
  /** Null while a stock-sourced asset is outside the regular session. */
  candles: { daily: MarketCandle[]; hourly: MarketCandle[] } | null;
};
const latestClose = (candles: MarketCandle[]) =>
  candles.reduce((latest, c) => (+c.timestamp > +latest.timestamp ? c : latest))
    .close;
const barError = (err: unknown) =>
  err instanceof Error &&
  /^(invalid|insufficient_recent)_(hourly|daily)_bars$/.test(err.message)
    ? err.message
    : 'market_data_unavailable';
const KNOWN_ERRORS = new Set([
  'stale_quote',
  'no_tradable_variant',
  'invalid_route_terms',
  'invalid_route_output',
  'insufficient_paper_cash',
]);
const observationError = (err: unknown) =>
  err instanceof Error && KNOWN_ERRORS.has(err.message)
    ? err.message
    : 'observation_unavailable';
/** The signal-timeframe candle a review decided on. */
const decisionBar = (rows: PaperBar[], hourlyRows: PaperBar[]) =>
  signalBars(SWING_POLICY, { daily: rows, hourly: hourlyRows }).at(-1)!.time;

export const startingBook = (): MarketBook => ({
  cash: PAPER_MODEL.startingUsdcRaw,
  positions: {},
});

@Injectable()
export class MarketBenchmark {
  /** Review time. Tests pin it to a session hour; epochs always follow the real clock. */
  clock: () => Date = () => new Date();
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly market: MarketService,
    private readonly tokens: TokensService,
    private readonly paper: PaperService,
    private readonly agent: PaperResearchAgent,
    private readonly catalog: StockCatalogRepository,
  ) {}

  async poll() {
    // One statement funds the cohort on the same clock. A redeploy cannot top it up.
    await this.db
      .insert(accounts)
      .values(cohort.map((accountId) => ({ accountId, state: startingBook() })))
      .onConflictDoNothing();
    const due = await this.db
      .select()
      .from(accounts)
      .where(
        and(
          inArray(accounts.accountId, [...cohort]),
          lt(accounts.epoch, FINAL_HOUR),
          lte(accounts.nextAt, new Date()),
        ),
      );
    for (const account of due) {
      const epoch = Math.min(
        FINAL_HOUR,
        Math.floor((Date.now() - +account.startedAt) / HOUR),
      );
      if (epoch <= account.epoch) continue;
      const [claimed] = await this.db
        .update(accounts)
        .set({
          nextAt: new Date(Date.now() + 15 * 60000),
          revision: sql`${accounts.revision}+1`,
        })
        .where(
          and(
            eq(accounts.accountId, account.accountId),
            eq(accounts.revision, account.revision),
          ),
        )
        .returning();
      if (!claimed) continue;
      const fence = and(
        eq(accounts.accountId, claimed.accountId),
        eq(accounts.revision, claimed.revision),
      );
      try {
        const round = await this.evaluate(claimed, epoch);
        if (
          epoch < FINAL_HOUR &&
          Date.now() >= +claimed.startedAt + (epoch + 1) * HOUR
        )
          throw new Error('round_expired');
        await this.db
          .update(accounts)
          .set({
            epoch,
            state: claimed.state,
            lastError: null,
            rounds: [...claimed.rounds, round],
            nextAt: new Date(
              +claimed.startedAt + Math.min(FINAL_HOUR, epoch + 1) * HOUR,
            ),
          })
          .where(fence);
      } catch {
        await this.db
          .update(accounts)
          .set({
            lastError: 'market_round_unavailable',
            nextAt: new Date(Date.now() + 5 * 60000),
          })
          .where(fence);
      }
    }
  }

  private async catalogRows(): Promise<ScreenRow[]> {
    const rows = new Map<string, ScreenRow>();
    for (let page = 1; ; page++) {
      const result = await this.market.listStocks(page, 50);
      const before = rows.size;
      for (const stock of result.items) {
        if (Object.hasOwn(Object.prototype, stock.id))
          throw new Error('invalid_stock_id');
        rows.set(stock.id, {
          id: stock.id,
          ticker: stock.ticker,
          price: stock.price ?? null,
          change: stock.priceChange24h ?? null,
          volume: stock.volume24h ?? null,
          liquidity: stock.liquidity ?? null,
        });
      }
      if (!result.pagination.hasMore) {
        if (rows.size !== result.pagination.total || !rows.size)
          throw new Error('incomplete_catalog');
        break;
      }
      if (rows.size === before) throw new Error('catalog_page_stalled');
    }
    return [...rows.values()];
  }

  /**
   * One deterministic market scan per clock hour, shared by the cohort. The
   * most liquid catalog stocks with a stock-market feed are read on session
   * candles; only assets with complete history and an entry signal become
   * setups. Scans are keyed by the absolute hour, so they never collide with
   * the first cohort's four-hour screen blocks.
   */
  private async scan(hour: number, asOf: Date): Promise<ScreenRow[]> {
    const read = () =>
      this.db.select().from(screens).where(eq(screens.epoch, hour));
    const [saved] = await read();
    if (saved) return saved.universe;
    const rows = await this.catalogRows();
    const scanned = rows
      .filter((r) => (r.liquidity ?? 0) >= SWING_POLICY.minLiquidityUsd)
      .sort(
        (a, b) =>
          (b.liquidity ?? 0) - (a.liquidity ?? 0) || a.id.localeCompare(b.id),
      )
      .slice(0, SWING_POLICY.scanLimit);
    // Every scanned asset with complete history counts toward market breadth.
    const analyses: SwingAnalysis[] = [];
    for (const row of scanned) {
      try {
        const equity = await this.tokens.getStock(row.id);
        if (equity.canonicalMarketSource !== STOCK_FEED_SOURCE) {
          row.skipped = 'no_stock_feed';
          continue;
        }
        const mint = bestMint(equity);
        if (!mint) {
          row.skipped = 'no_tradable_variant';
          continue;
        }
        const bars = await this.reviewBars(row.id, mint, true, asOf);
        if (bars.source !== 'stock') {
          row.skipped = 'no_stock_candles';
          continue;
        }
        if (!bars.candles) {
          row.skipped = 'market_closed';
          continue;
        }
        const daily = history(bars.candles.daily, +asOf);
        const hourly = history(bars.candles.hourly, +asOf, 'hourly');
        const analysis = analyze(
          daily,
          signalBars(SWING_POLICY, { daily, hourly }),
          undefined,
          SWING_POLICY.rules,
        );
        analyses.push(analysis);
        if (!analysis.entryRules.length) {
          row.skipped = 'no_signal';
          continue;
        }
        row.setup = {
          mint,
          source: 'stock',
          price: latestClose(bars.candles.hourly),
          analysis,
          rows: daily,
          hourlyRows: hourly,
        };
      } catch (err) {
        row.skipped = barError(err);
      }
    }
    const setups = rows.filter((r) => r.setup);
    const market = marketContext(
      await this.indexDaily(asOf),
      analyses,
      setups.length,
    );
    for (const row of setups) row.setup!.market = market;
    await this.db
      .insert(screens)
      .values({ epoch: hour, universe: rows })
      .onConflictDoNothing();
    return (await read())[0].universe;
  }

  /** QQQ's completed daily candles on NYSE trading days, or null when unavailable. */
  private async indexDaily(asOf: Date): Promise<PaperBar[] | null> {
    try {
      const candles = await this.tokens.getCanonicalCandles(
        MARKET_INDEX_ASSET,
        {
          interval: '1D',
          from: Math.floor((+asOf - 65 * DAY) / 1000),
          to: Math.floor(+asOf / 1000),
        },
      );
      return history(
        candles.filter((c) => isNyseTradingDay(+c.timestamp)),
        +asOf,
      );
    } catch {
      return null;
    }
  }

  /**
   * Candles for one review. A stock mapped to the Tokens stock-market feed is
   * read from `/price-chart` and kept to NYSE sessions; outside the regular
   * session it waits for the open instead of reporting a data error. Other
   * assets, and a mapped stock whose chart is not session-shaped (Tokens fell
   * back to another source), use the traded mint's on-chain candles at any hour.
   * A failed stock-feed request is an error rather than a silent switch to
   * token candles, so a feed outage cannot open positions while markets are shut.
   */
  private async reviewBars(
    asset: string,
    mint: string,
    stockMapped: boolean,
    asOf: Date,
  ): Promise<ReviewBars> {
    const window = (interval: '1H' | '1D', span: number) => ({
      interval,
      from: Math.floor((+asOf - span) / 1000),
      to: Math.floor(+asOf / 1000),
    });
    if (stockMapped) {
      const hourly = stockSessionBars(
        await this.tokens.getCanonicalCandles(
          asset,
          window('1H', 10 * DAY),
          mint,
        ),
        'hourly',
      );
      if (hourly) {
        const session = usMarketSession(asOf);
        if (!session.regular)
          return {
            source: 'stock',
            session: session.state,
            dropped: hourly.dropped,
            candles: null,
          };
        const daily = stockSessionBars(
          await this.tokens.getCanonicalCandles(
            asset,
            window('1D', 65 * DAY),
            mint,
          ),
          'daily',
        );
        if (daily)
          return {
            source: 'stock',
            session: session.state,
            dropped: hourly.dropped + daily.dropped,
            candles: { daily: daily.bars, hourly: hourly.bars },
          };
      }
    }
    const [daily, hourly] = await Promise.all([
      this.tokens.getOHLCV(asset, {
        mint,
        timeframe: '1D',
        start: new Date(+asOf - 65 * DAY),
        end: asOf,
      }),
      this.tokens.getOHLCV(asset, {
        mint,
        timeframe: '1H',
        start: new Date(+asOf - 10 * DAY),
        end: asOf,
      }),
    ]);
    return { source: 'token', dropped: 0, candles: { daily, hourly } };
  }

  /**
   * Review a holding: deterministic exits on fresh candles, otherwise the
   * live sale quote against the holding's guard. No model call. Returns the
   * holding's marked value, zero once sold.
   */
  private async reviewHolding(
    book: MarketBook,
    asset: string,
    holding: Holding,
    obs: MarketObservation,
    epoch: number,
    asOf: Date,
  ): Promise<bigint> {
    const local = { cash: book.cash, position: holding.quantity };
    let signal: PaperSignal = 'hold';
    let fresh: {
      daily: PaperBar[];
      signal: PaperBar[];
      bar: number;
      price: number;
      source: PaperBarSource;
    } | null = null;
    if (epoch < FINAL_HOUR) {
      try {
        let equity: Equity | null = null;
        try {
          equity = await this.tokens.getStock(asset);
        } catch {
          // A holding keeps its mint, so it stays reviewable without asset detail.
        }
        const bars = await this.reviewBars(
          asset,
          holding.mint,
          equity?.canonicalMarketSource === STOCK_FEED_SOURCE,
          asOf,
        );
        obs.source = bars.source;
        if (bars.session) obs.session = bars.session;
        if (bars.dropped) obs.droppedBars = bars.dropped;
        if (!bars.candles) obs.marketClosed = true;
        else {
          obs.rows = history(bars.candles.daily, +asOf);
          obs.hourlyRows = history(bars.candles.hourly, +asOf, 'hourly');
          const bar = decisionBar(obs.rows, obs.hourlyRows);
          // A candle already decided on keeps the earlier guard, so a stale price never drags the stop down.
          obs.repeatedBar = bar <= (holding.decidedBar ?? -Infinity);
          if (!obs.repeatedBar) {
            const series = signalBars(SWING_POLICY, {
              daily: obs.rows,
              hourly: obs.hourlyRows,
            });
            const analysis = analyze(obs.rows, series, {
              entryRule: holding.entryRule,
            });
            obs.analysis = analysis;
            if (analysis.riskExit) signal = 'sell';
            fresh = {
              daily: obs.rows,
              signal: series,
              bar,
              price: latestClose(bars.candles.hourly),
              source: bars.source,
            };
          }
        }
      } catch (err) {
        obs.error = barError(err);
      }
    }
    const terms = await this.paper.route(
      holding.mint,
      'sell',
      BigInt(holding.quantity),
    );
    obs.terms = terms;
    // Without a fresh decision (market closed, stale or missing candles, or a
    // candle already decided on), the live sale quote is checked against the guard.
    const hit =
      signal === 'hold' && !fresh && epoch < FINAL_HOUR
        ? guardExit(holding.guard, terms.quotedOutput)
        : null;
    if (hit) {
      signal = 'sell';
      obs.guardExit = hit;
    }
    obs.signal = signal;
    const fill = settle(local, signal, terms);
    if (Date.now() - terms.requestedAt > 30000) throw new Error('stale_quote');
    book.cash = fill.book.cash;
    obs.filled = signal === 'sell';
    if (signal === 'sell') {
      delete book.positions[asset];
      obs.mark = '0';
      return 0n;
    }
    const mark =
      BigInt(fill.liquidationEquityUsdcRaw!) - BigInt(fill.book.cash);
    obs.mark = mark.toString();
    if (fresh) {
      const guard = exitGuard(
        exitLevels(fresh.daily, fresh.signal, holding.entryRule),
        fresh.price,
        terms.quotedOutput,
        fresh.source,
        new Date(),
      );
      book.positions[asset] = {
        ...holding,
        ...(guard ? { guard } : {}),
        decidedBar: fresh.bar,
      };
    }
    return mark;
  }

  /** An earlier review of the same setup candle by this account, reused instead of asking again. */
  private earlierReview(
    account: Account,
    asset: string,
    bar: number,
  ): PaperResearch | undefined {
    for (const round of account.rounds.slice(-24).reverse())
      for (const obs of round.observations ?? [])
        if (
          obs.asset === asset &&
          obs.research &&
          !obs.research.error &&
          obs.rows &&
          obs.hourlyRows &&
          decisionBar(obs.rows, obs.hourlyRows) === bar
        )
          return obs.research;
    return undefined;
  }

  private async enter(
    account: Account,
    book: MarketBook,
    asset: string,
    setup: ScanSetup,
    obs: MarketObservation,
    equity: bigint,
  ): Promise<bigint> {
    const { analysis, rows, hourlyRows, mint } = setup;
    let choice: EntryRule | 'cash';
    if (accountPolicy(account.accountId) === 'rules') {
      choice = rulesChoice(analysis);
      obs.research = {
        version: SWING_POLICY.version,
        model: 'rules',
        rationale:
          'Rules baseline: takes the top-ranked setup without a model review.',
        selected: choice,
      };
    } else {
      const bar = decisionBar(rows, hourlyRows);
      const earlier = this.earlierReview(account, asset, bar);
      if (earlier) obs.repeatedBar = true;
      obs.research =
        earlier ??
        (await this.agent.review(
          setupEvidence(rows, hourlyRows, analysis, SWING_POLICY, setup.market),
        ));
      choice = obs.research.selected ?? 'cash';
    }
    obs.signal = entrySignal(analysis, choice);
    obs.filled = false;
    if (obs.signal !== 'buy' || choice === 'cash') return 0n;
    const budget = entryBudget(BigInt(book.cash), equity, FEE, SWING_POLICY);
    if (budget < MIN_ENTRY) {
      obs.signal = 'hold';
      obs.error = 'insufficient_paper_cash';
      return 0n;
    }
    const terms = await this.paper.route(mint, 'buy', budget);
    obs.terms = terms;
    const fill = settle(
      { cash: book.cash, position: '0' },
      'buy',
      terms,
      budget,
    );
    const exit = await this.paper.route(
      mint,
      'sell',
      BigInt(fill.book.position),
    );
    obs.exit = exit;
    obs.roundTripBps = roundTripBps(budget, BigInt(exit.quotedOutput));
    if (obs.roundTripBps > SWING_POLICY.maxRoundTripBps) {
      obs.signal = 'hold';
      obs.error = 'spread_too_wide';
      return 0n;
    }
    if (Date.now() - terms.requestedAt > 30000) throw new Error('stale_quote');
    const mark =
      BigInt(settle(fill.book, 'hold', exit).liquidationEquityUsdcRaw!) -
      BigInt(fill.book.cash);
    book.cash = fill.book.cash;
    const guard = exitGuard(
      exitLevels(
        rows,
        signalBars(SWING_POLICY, { daily: rows, hourly: hourlyRows }),
        choice,
      ),
      setup.price,
      exit.quotedOutput,
      setup.source,
      new Date(),
    );
    book.positions[asset] = {
      mint,
      quantity: fill.book.position,
      entryRule: choice,
      ...(guard ? { guard } : {}),
      decidedBar: decisionBar(rows, hourlyRows),
    };
    obs.filled = true;
    obs.mark = mark.toString();
    return mark;
  }

  private async evaluate(
    account: Account,
    epoch: number,
  ): Promise<MarketRound> {
    const book = account.state;
    const asOf = this.clock();
    const round: MarketRound = {
      epoch,
      at: asOf.toISOString(),
      method: SWING_POLICY.version,
      universeSize: 0,
      candidates: [],
      observations: [],
      equityRaw: null,
      cashRaw: book.cash,
    };
    let marked = 0n,
      complete = true;
    // Holdings first: exits free cash and their marks size any new entry.
    for (const [asset, holding] of Object.entries(book.positions)) {
      const obs: MarketObservation = { asset, mint: holding.mint };
      round.observations.push(obs);
      try {
        marked += await this.reviewHolding(
          book,
          asset,
          holding,
          obs,
          epoch,
          asOf,
        );
      } catch (err) {
        obs.error = observationError(err);
        complete = false;
      }
    }
    if (
      epoch < FINAL_HOUR &&
      usMarketSession(asOf).regular &&
      Object.keys(book.positions).length < SWING_POLICY.maxPositions
    ) {
      let universe: ScreenRow[] = [];
      try {
        universe = await this.scan(Math.floor(+asOf / HOUR), asOf);
        round.screenEpoch = Math.floor(+asOf / HOUR);
      } catch {
        round.screenError = 'scan_unavailable';
      }
      const ranked = rankSetups(
        universe
          .filter((r) => r.setup)
          .map((r) => ({
            asset: r.id,
            analysis: r.setup!.analysis,
            setup: r.setup!,
          })),
      );
      round.universeSize = universe.filter((r) => r.setup || r.skipped).length;
      round.candidates = ranked.map((s) => s.asset);
      const held = new Set(Object.keys(book.positions));
      const equity = complete ? BigInt(book.cash) + marked : BigInt(book.cash);
      for (const pick of reviewable(ranked, held, held.size, SWING_POLICY)) {
        const obs: MarketObservation = {
          asset: pick.asset,
          mint: pick.setup.mint,
          source: pick.setup.source,
          session: 'regular',
          rows: pick.setup.rows,
          hourlyRows: pick.setup.hourlyRows,
          analysis: pick.setup.analysis,
        };
        round.observations.push(obs);
        try {
          marked += await this.enter(
            account,
            book,
            pick.asset,
            pick.setup,
            obs,
            equity,
          );
        } catch (err) {
          obs.error = observationError(err);
          obs.filled = false;
        }
      }
    }
    round.cashRaw = book.cash;
    round.equityRaw = complete ? (BigInt(book.cash) + marked).toString() : null;
    return round;
  }

  private summarize(a: Account) {
    const latest = a.rounds.at(-1);
    const equity = latest?.equityRaw;
    const netPnlUsdc =
      equity == null
        ? null
        : Number(BigInt(equity) - BigInt(PAPER_MODEL.startingUsdcRaw)) / 1e6;
    let peak = Number(PAPER_MODEL.startingUsdcRaw),
      drawdown = 0;
    for (const round of a.rounds) {
      if (round.equityRaw === null) continue;
      const value = Number(round.equityRaw);
      peak = Math.max(peak, value);
      drawdown = Math.max(drawdown, 100 * (1 - value / peak));
    }
    return {
      accountId: a.accountId,
      startedAt: a.startedAt,
      netPnlUsdc,
      returnPct: netPnlUsdc === null ? null : netPnlUsdc / 100,
      observedDrawdownPct: a.rounds.some((r) => r.equityRaw !== null)
        ? drawdown
        : null,
      fills: a.rounds.reduce(
        (n, r) => n + (r.observations ?? []).filter((o) => o.filled).length,
        0,
      ),
    };
  }

  async report() {
    const all = await this.db
      .select()
      .from(accounts)
      .orderBy(accounts.accountId);
    const current = all.filter((a) => cohort.includes(a.accountId));
    const archived = all.filter((a) => legacy.includes(a.accountId));
    const coverage = await this.db
      .select({
        epoch: screens.epoch,
        at: screens.capturedAt,
        count: sql<number>`jsonb_array_length(${screens.universe})`,
      })
      .from(screens)
      .where(gte(screens.epoch, SCAN_HOUR_FLOOR))
      .orderBy(screens.epoch);
    // Names and logos for the report UI. A catalog miss leaves the journal intact.
    const catalog = await this.catalog
      .findByAssetIds(benchmarkAssetIds(current))
      .catch((): EquitySummary[] => []);
    const assets = Object.fromEntries(
      catalog.map((s) => [
        s.id,
        { ticker: s.ticker, name: s.name, logo: s.logo ?? null },
      ]),
    );
    return {
      experiment: EXPERIMENT,
      policy: SWING_POLICY,
      costModel: PAPER_MODEL,
      archivedFiveAiV1: archived.map((a) => ({
        ...this.summarize(a),
        book: a.state,
      })),
      archivedMixed: await this.db
        .select({
          policy: previousAccounts.policy,
          startedAt: previousAccounts.startedAt,
          book: previousAccounts.state,
          rounds: previousAccounts.rounds,
        })
        .from(previousAccounts)
        .orderBy(previousAccounts.policy),
      startingUsdcPerAccount: 10000,
      totalStartingUsdc: current.length * 10000,
      cadence: {
        reviewHours: 1,
        marketScreenHours: 1,
        durationHours: FINAL_HOUR,
      },
      coverage,
      assets,
      accounts: current.map((a) => {
        const latest = a.rounds.at(-1);
        return {
          ...this.summarize(a),
          policy: accountPolicy(a.accountId),
          endsAt: new Date(+a.startedAt + FINAL_HOUR * HOUR),
          nextCheckAt: a.epoch === FINAL_HOUR ? null : a.nextAt,
          status:
            a.epoch === FINAL_HOUR
              ? ('ended' as const)
              : latest
                ? ('observing' as const)
                : ('starting' as const),
          book: a.state,
          lastError: a.lastError,
          rounds: a.rounds,
        };
      }),
    };
  }
}

function bestMint(equity: Equity) {
  return equity.variants
    .filter((v) => v.tradable && v.mint && v.mint !== USDC_MINT)
    .sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0))[0]?.mint;
}
