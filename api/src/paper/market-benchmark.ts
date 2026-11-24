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
import { DAY, history, orderInput, settle } from './strategy';
import { PaperService } from './paper.service';
import { PaperResearchAgent } from './paper-research';

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
      .where(and(lt(accounts.epoch, 2), lte(accounts.nextAt, new Date())));
    for (const account of due) {
      const epoch = Math.min(
        2,
        Math.floor((Date.now() - +account.startedAt) / DAY),
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
        const universe = epoch === 2 ? [] : await this.screen(epoch);
        const round = await this.evaluate(claimed, epoch, universe);
        if (epoch < 2 && Date.now() >= +claimed.startedAt + (epoch + 1) * DAY)
          throw new Error('round_expired');
        await this.db
          .update(accounts)
          .set({
            epoch,
            state: claimed.state,
            lastError: null,
            rounds: [...claimed.rounds, round],
            nextAt: new Date(+claimed.startedAt + Math.min(2, epoch + 1) * DAY),
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
    universe: ScreenRow[],
  ): Promise<MarketRound> {
    const book = account.state;
    const round: MarketRound = {
      epoch,
      at: new Date().toISOString(),
      universeSize: universe.length,
      candidates: [],
      observations: [],
      equityRaw: null,
      cashRaw: book.cash,
    };
    if (epoch < 2) {
      try {
        round.candidates = await this.agent.shortlist(universe, book);
      } catch {
        round.screenError = 'shortlist_unavailable';
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
        if (epoch !== 2) {
          const asOf = new Date();
          const rows = history(
            await this.tokens.getOHLCV(asset, {
              mint,
              timeframe: '1D',
              start: new Date(+asOf - 65 * DAY),
              end: asOf,
            }),
            +asOf,
          );
          obs.rows = rows;
          const prev = account.rounds
            .at(-1)
            ?.observations.find((o) => o.asset === asset)
            ?.rows?.at(-1)?.time;
          if (prev === undefined || rows.at(-1)!.time > prev) {
            const analysis = await this.agent.investigate(
              asset,
              mint,
              rows,
              local,
              book,
            );
            obs.research = analysis.research;
            signal = analysis.signal;
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
        else book.positions[asset] = { mint, quantity: fill.book.position };
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
          endsAt: new Date(+a.startedAt + 2 * DAY),
          status: a.epoch === 2 ? 'ended' : latest ? 'observing' : 'starting',
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
