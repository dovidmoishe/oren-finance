import { Inject, Injectable } from '@nestjs/common';
import { and, eq, lt, lte, sql } from 'drizzle-orm';
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
import type { Equity } from '../../types/equity';
import type { MarketCandle } from '../../types/market';
import type { UsMarketSessionState } from '../../types/market-session';
import {
  PAPER_MODEL,
  type PaperBar,
  type PaperSignal,
} from '../../types/paper';
import {
  aiAccountIds,
  type MarketBook,
  type MarketObservation,
  type MarketRound,
  type PaperBarSource,
  type ScreenRow,
} from '../../types/paper-market';
import { STOCK_FEED_SOURCE, stockSessionBars } from './market-data';
import {
  DAY,
  HOUR,
  exitGuard,
  exitLevels,
  guardExit,
  history,
  orderInput,
  settle,
} from './strategy';
import { PaperService } from './paper.service';
import { PaperResearchAgent } from './paper-research';

const FINAL_HOUR = 48;
const SCREEN_HOURS = 4;

type Account = typeof accounts.$inferSelect;
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
export const startingBook = (): MarketBook => ({
  cash: PAPER_MODEL.startingUsdcRaw,
  positions: {},
});

@Injectable()
export class MarketBenchmark {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly market: MarketService,
    private readonly tokens: TokensService,
    private readonly paper: PaperService,
    private readonly agent: PaperResearchAgent,
  ) {}

  async poll() {
    // One statement funds all five books on the same clock. A redeploy cannot top them up.
    await this.db
      .insert(accounts)
      .values(
        aiAccountIds.map((accountId) => ({ accountId, state: startingBook() })),
      )
      .onConflictDoNothing();
    const due = await this.db
      .select()
      .from(accounts)
      .where(
        and(lt(accounts.epoch, FINAL_HOUR), lte(accounts.nextAt, new Date())),
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

  private async screen(epoch: number) {
    const read = () =>
      this.db.select().from(screens).where(eq(screens.epoch, epoch));
    const [saved] = await read();
    if (saved) return saved.universe;
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
    await this.db
      .insert(screens)
      .values({ epoch, universe: [...rows.values()] })
      .onConflictDoNothing();
    return (await read())[0].universe;
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

  private async evaluate(
    account: Account,
    epoch: number,
  ): Promise<MarketRound> {
    const book = account.state;
    const round: MarketRound = {
      epoch,
      at: new Date().toISOString(),
      method: 'hourly-swing-v2',
      universeSize: 0,
      candidates: [],
      observations: [],
      equityRaw: null,
      cashRaw: book.cash,
    };
    if (epoch < FINAL_HOUR) {
      const block = epoch - (epoch % SCREEN_HOURS);
      const previous = account.rounds.at(-1);
      if (previous) {
        round.candidates = previous.candidates;
        round.universeSize = previous.universeSize;
      }
      if (previous?.screenEpoch === block) {
        round.screenEpoch = block;
      } else {
        try {
          const universe = await this.screen(block);
          round.universeSize = universe.length;
          round.candidates = await this.agent.shortlist(universe, book);
          round.screenEpoch = block;
        } catch {
          round.screenError = 'shortlist_unavailable';
        }
      }
    }
    // Review held mints before spending cash on any new entry. Each fill updates the same book.
    const assets = new Set([
      ...Object.keys(book.positions),
      ...round.candidates,
    ]);
    let marked = 0n,
      complete = true;
    for (const asset of assets) {
      const obs: MarketObservation = { asset };
      round.observations.push(obs);
      const holding = book.positions[asset];
      try {
        // A holding keeps its mint, so it stays reviewable without asset detail.
        let equity: Equity | null = null;
        try {
          equity = await this.tokens.getStock(asset);
        } catch (err) {
          if (!holding) throw err;
        }
        const mint =
          holding?.mint ??
          equity?.variants
            .filter((v) => v.tradable && v.mint && v.mint !== USDC_MINT)
            .sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0))[0]?.mint;
        if (!mint) throw new Error('no_tradable_variant');
        obs.mint = mint;
        const local = { cash: book.cash, position: holding?.quantity ?? '0' };
        let signal: PaperSignal = 'hold';
        // Set only when new completed candles produced a decision in this
        // review. Their exit levels and latest price, observed alongside this
        // review's sale quote, re-anchor the holding's guard. A repeated bar
        // keeps the earlier guard, so a stale price never drags the stop down.
        let fresh: {
          daily: PaperBar[];
          hourly: PaperBar[];
          price: number;
          source: PaperBarSource;
        } | null = null;
        if (epoch < FINAL_HOUR) {
          try {
            const asOf = new Date();
            const bars = await this.reviewBars(
              asset,
              mint,
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
              const candle = obs.hourlyRows.at(-1)!.time;
              obs.repeatedBar = account.rounds.some((r) =>
                r.observations.some(
                  (o) =>
                    o.asset === asset &&
                    o.mint === mint &&
                    (o.source ?? 'token') === bars.source &&
                    (o.hourlyRows?.at(-1)?.time ?? -1) >= candle,
                ),
              );
              if (!obs.repeatedBar) {
                const analysis = await this.agent.investigate(
                  asset,
                  mint,
                  obs.rows,
                  obs.hourlyRows,
                  local,
                  book,
                  bars.source,
                );
                obs.research = analysis.research;
                signal = analysis.signal;
                fresh = {
                  daily: obs.rows,
                  hourly: obs.hourlyRows,
                  price: latestClose(bars.candles.hourly),
                  source: bars.source,
                };
              }
            }
          } catch (err) {
            obs.error =
              err instanceof Error &&
              /^(invalid|insufficient_recent)_(hourly|daily)_bars$/.test(
                err.message,
              )
                ? err.message
                : 'market_data_unavailable';
          }
        }
        obs.signal = signal;
        const input = orderInput(signal, local);
        if (input === 0n) continue;
        const terms = await this.paper.route(
          mint,
          signal === 'buy' ? 'buy' : 'sell',
          input,
        );
        obs.terms = terms;
        // Without a fresh decision (market closed, stale or missing candles,
        // or a repeated bar), the live sale quote is checked against the guard.
        const hit =
          holding && signal === 'hold' && !fresh && epoch < FINAL_HOUR
            ? guardExit(holding.guard, terms.quotedOutput)
            : null;
        if (hit) {
          signal = 'sell';
          obs.signal = signal;
          obs.guardExit = hit;
        }
        const fill = settle(local, signal, terms);
        let mark = 0n;
        if (signal === 'buy') {
          const exit = await this.paper.route(
            mint,
            'sell',
            BigInt(fill.book.position),
          );
          obs.exit = exit;
          mark =
            BigInt(settle(fill.book, 'hold', exit).liquidationEquityUsdcRaw!) -
            BigInt(fill.book.cash);
        } else if (signal === 'hold')
          mark =
            BigInt(fill.liquidationEquityUsdcRaw!) - BigInt(fill.book.cash);
        if (Date.now() - terms.requestedAt > 30000)
          throw new Error('stale_quote');
        book.cash = fill.book.cash;
        if (fill.book.position === '0') delete book.positions[asset];
        else {
          const selected = obs.research?.selected;
          const entryRule =
            holding?.entryRule ??
            (signal === 'buy' &&
            (selected === 'breakout-v1' || selected === 'pullback-v1')
              ? selected
              : undefined);
          // The position's own sale quote anchors the guard: the exit quote
          // after a buy, the mark quote otherwise.
          const sale = signal === 'buy' ? obs.exit : terms;
          const refreshed =
            fresh && sale
              ? exitGuard(
                  exitLevels(fresh.daily, fresh.hourly, entryRule),
                  fresh.price,
                  sale.quotedOutput,
                  fresh.source,
                  new Date(),
                )
              : null;
          const guard = refreshed ?? holding?.guard;
          book.positions[asset] = {
            mint,
            quantity: fill.book.position,
            entryRule,
            ...(guard ? { guard } : {}),
          };
        }
        marked += mark;
        obs.mark = mark.toString();
        obs.filled = signal !== 'hold';
      } catch (err) {
        obs.error =
          err instanceof Error &&
          [
            'stale_quote',
            'insufficient_recent_daily_bars',
            'invalid_daily_bars',
            'no_tradable_variant',
          ].includes(err.message)
            ? err.message
            : 'observation_unavailable';
        if (holding) complete = false;
      }
    }
    round.cashRaw = book.cash;
    round.equityRaw = complete ? (BigInt(book.cash) + marked).toString() : null;
    return round;
  }

  async report() {
    const all = await this.db
      .select()
      .from(accounts)
      .orderBy(accounts.accountId);
    const coverage = await this.db
      .select({
        epoch: screens.epoch,
        at: screens.capturedAt,
        count: sql<number>`jsonb_array_length(${screens.universe})`,
      })
      .from(screens)
      .orderBy(screens.epoch);
    return {
      experiment: 'five-ai-v1',
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
      totalStartingUsdc: all.length * 10000,
      cadence: {
        reviewHours: 1,
        marketScreenHours: SCREEN_HOURS,
        durationHours: FINAL_HOUR,
      },
      coverage,
      accounts: all.map((a) => {
        const latest = a.rounds.at(-1);
        const equity = latest?.equityRaw;
        const netPnlUsdc =
          equity == null
            ? null
            : Number(BigInt(equity) - BigInt(PAPER_MODEL.startingUsdcRaw)) /
              1e6;
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
          policy: 'guided' as const,
          startedAt: a.startedAt,
          endsAt: new Date(+a.startedAt + FINAL_HOUR * HOUR),
          nextCheckAt: a.epoch === FINAL_HOUR ? null : a.nextAt,
          status:
            a.epoch === FINAL_HOUR
              ? 'ended'
              : latest
                ? 'observing'
                : 'starting',
          book: a.state,
          lastError: a.lastError,
          netPnlUsdc,
          returnPct: netPnlUsdc === null ? null : netPnlUsdc / 100,
          observedDrawdownPct: a.rounds.some((r) => r.equityRaw !== null)
            ? drawdown
            : null,
          rounds: a.rounds,
        };
      }),
    };
  }
}
