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
import { TokensService } from '../tokens/tokens.service';
import { PAPER_MODEL, type PaperSignal } from '../../types/paper';
import {
  aiAccountIds,
  type MarketBook,
  type MarketObservation,
  type MarketRound,
  type ScreenRow,
} from '../../types/paper-market';
import { DAY, HOUR, history, orderInput, settle } from './strategy';
import { PaperService } from './paper.service';
import { PaperResearchAgent } from './paper-research';

const FINAL_HOUR = 48;
const SCREEN_HOURS = 4;

type Account = typeof accounts.$inferSelect;
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

  private async evaluate(
    account: Account,
    epoch: number,
  ): Promise<MarketRound> {
    const book = account.state;
    const round: MarketRound = {
      epoch,
      at: new Date().toISOString(),
      method: 'hourly-swing-v1',
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
        const mint =
          holding?.mint ??
          (await this.tokens.getStock(asset)).variants
            .filter((v) => v.tradable && v.mint && v.mint !== USDC_MINT)
            .sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0))[0]?.mint;
        if (!mint) throw new Error('no_tradable_variant');
        obs.mint = mint;
        const local = { cash: book.cash, position: holding?.quantity ?? '0' };
        let signal: PaperSignal = 'hold';
        if (epoch < FINAL_HOUR) {
          try {
            const asOf = new Date();
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
            obs.rows = history(daily, +asOf);
            obs.hourlyRows = history(hourly, +asOf, 'hourly');
            const candle = obs.hourlyRows.at(-1)!.time;
            obs.repeatedBar = account.rounds.some((r) =>
              r.observations.some(
                (o) =>
                  o.asset === asset &&
                  o.mint === mint &&
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
              );
              obs.research = analysis.research;
              signal = analysis.signal;
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
          book.positions[asset] = {
            mint,
            quantity: fill.book.position,
            entryRule,
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
