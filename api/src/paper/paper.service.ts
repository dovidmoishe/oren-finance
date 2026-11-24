import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, lt, lte, sql } from 'drizzle-orm';
import {
  PAPER_MODEL,
  type ObservedPaperQuote,
  type PaperValuation,
} from '../../types/paper';
import { DRIZZLE, USDC_MINT } from '../config/constants';
import type { Database } from '../database/database.provider';
import { paperEvents, paperRuns } from '../database/schema';
import { TokensService } from '../tokens/tokens.service';
import {
  DAY,
  decide,
  history,
  INITIAL,
  orderInput,
  quoteTerms,
  settle,
  type Strategy,
} from './strategy';
import { PAPER_QUOTES, type PaperQuotes } from './quotes';

type Run = typeof paperRuns.$inferSelect;
type PaperTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
const maxActiveRuns = 12;
function lockOwner(tx: PaperTransaction, owner: string) {
  return tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${'paper:' + owner}, 0))`,
  );
}
async function requireAvailableSlot(tx: PaperTransaction, owner: string) {
  const count = await tx.$count(
    paperRuns,
    and(eq(paperRuns.ownerId, owner), eq(paperRuns.active, true)),
  );
  if (count >= maxActiveRuns)
    throw new ConflictException(
      'Pause a trial before starting another (12 active runs)',
    );
}
const hour = 3600000;
const owned = (owner: string, id: string) =>
  and(eq(paperRuns.id, id), eq(paperRuns.ownerId, owner));

@Injectable()
export class PaperService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly tokens: TokensService,
    @Inject(PAPER_QUOTES) private readonly quotes: PaperQuotes,
  ) {}

  list(owner: string) {
    return this.db
      .select()
      .from(paperRuns)
      .where(eq(paperRuns.ownerId, owner))
      .orderBy(desc(paperRuns.createdAt));
  }

  async start(owner: string, assetId: string, strategy: Strategy) {
    const identity = and(
      eq(paperRuns.ownerId, owner),
      eq(paperRuns.assetId, assetId),
      eq(paperRuns.strategy, strategy),
    );
    const [existing] = await this.db.select().from(paperRuns).where(identity);
    if (existing) return existing;
    const equity = await this.tokens.getStock(assetId);
    const variant = equity.variants
      .filter((v) => v.tradable && v.mint && v.mint !== USDC_MINT)
      .sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0))[0];
    if (!variant || equity.id !== assetId)
      throw new BadRequestException(
        'Choose a supported canonical stock with a tradable token',
      );
    return this.db.transaction(async (tx) => {
      await lockOwner(tx, owner);
      const [repeated] = await tx.select().from(paperRuns).where(identity);
      if (repeated) return repeated;
      await requireAvailableSlot(tx, owner);
      const [run] = await tx
        .insert(paperRuns)
        .values({
          ownerId: owner,
          assetId,
          strategy,
          mint: variant.mint,
          book: INITIAL,
          liquidationEquityUsdcRaw: INITIAL.cash,
        })
        .returning();
      return run;
    });
  }

  async activity(owner: string, id: string, before?: number) {
    const [run] = await this.db
      .select()
      .from(paperRuns)
      .where(owned(owner, id));
    if (!run) throw new NotFoundException();
    const events =
      run.lastBar === null
        ? []
        : await this.db
            .select()
            .from(paperEvents)
            .where(
              and(
                eq(paperEvents.runId, id),
                lte(paperEvents.barTime, run.lastBar),
                before === undefined
                  ? undefined
                  : lt(paperEvents.barTime, before),
              ),
            )
            .orderBy(desc(paperEvents.barTime))
            .limit(100);
    const equity = run.liquidationEquityUsdcRaw;
    const net = equity === null ? null : BigInt(equity) - BigInt(INITIAL.cash);
    return {
      run,
      model: PAPER_MODEL,
      performance: {
        valuedAt: run.valuedAt,
        netPnlUsdcRaw: net?.toString() ?? null,
        returnPct:
          net === null
            ? null
            : Number((net * 1000000n) / BigInt(INITIAL.cash)) / 10000,
      },
      events,
    };
  }

  async setActive(owner: string, id: string, active: boolean) {
    return this.db.transaction(async (tx) => {
      await lockOwner(tx, owner);
      const [current] = await tx
        .select()
        .from(paperRuns)
        .where(owned(owner, id));
      if (!current) throw new NotFoundException();
      if (current.active === active) return current;
      if (active) await requireAvailableSlot(tx, owner);
      const [updated] = await tx
        .update(paperRuns)
        .set({
          active,
          nextAt: new Date(),
          revision: sql`${paperRuns.revision}+1`,
        })
        .where(owned(owner, id))
        .returning();
      return updated;
    });
  }

  async tick() {
    const due = await this.db
      .select()
      .from(paperRuns)
      .where(and(eq(paperRuns.active, true), lte(paperRuns.nextAt, new Date())))
      .orderBy(asc(paperRuns.nextAt))
      .limit(16);
    for (const candidate of due) {
      const [run] = await this.db
        .update(paperRuns)
        .set({
          revision: sql`${paperRuns.revision}+1`,
          nextAt: new Date(Date.now() + 5 * 60000),
        })
        .where(
          and(
            eq(paperRuns.id, candidate.id),
            eq(paperRuns.revision, candidate.revision),
            eq(paperRuns.active, true),
            lte(paperRuns.nextAt, new Date()),
          ),
        )
        .returning();
      if (!run) continue;
      try {
        await this.observe(run);
      } catch (err) {
        const message =
          err instanceof Error &&
          ['insufficient_recent_daily_bars', 'invalid_daily_bars'].includes(
            err.message,
          )
            ? err.message
            : 'observation_unavailable';
        await this.db
          .update(paperRuns)
          .set({
            lastError: message,
            nextAt: new Date(Date.now() + 15 * 60000),
          })
          .where(this.claim(run));
      }
    }
  }

  private claim(run: Run) {
    return and(
      eq(paperRuns.id, run.id),
      eq(paperRuns.active, true),
      eq(paperRuns.revision, run.revision),
    );
  }

  private async route(mint: string, side: 'buy' | 'sell', amount: bigint) {
    const buy = side === 'buy';
    const requestedAt = Date.now();
    const raw = await this.quotes.getQuote({
      inputMint: buy ? USDC_MINT : mint,
      outputMint: buy ? mint : USDC_MINT,
      amount: amount.toString(),
      slippageBps: PAPER_MODEL.slippageBps,
      lane: 'background',
    });
    return {
      ...quoteTerms(raw, mint, side, amount),
      requestedAt,
      receivedAt: Date.now(),
    };
  }

  private async observe(run: Run) {
    const asOf = new Date();
    const bars = await this.tokens.getOHLCV(run.assetId, {
      mint: run.mint,
      timeframe: '1D',
      start: new Date(+asOf - 65 * DAY),
      end: asOf,
    });
    const rows = history(bars, +asOf);
    const time = rows[rows.length - 1].time;
    const nextAt = new Date(Date.now() + hour);
    if (run.lastBar !== null && time <= run.lastBar) {
      await this.db.update(paperRuns).set({ nextAt }).where(this.claim(run));
      return;
    }
    const signal = decide(run.strategy, rows, run.book);
    const amount = orderInput(signal, run.book);
    let terms: ObservedPaperQuote | null = null;
    let exitMark: ObservedPaperQuote | null = null;
    let error: string | null = null;
    let result: PaperValuation | null = null;
    try {
      if (amount > 0n)
        terms = await this.route(
          run.mint,
          signal === 'buy' ? 'buy' : 'sell',
          amount,
        );
      const fill = settle(run.book, signal, terms);
      if (signal === 'buy') {
        // Price the exit for the acquired quantity before recording the paper purchase.
        exitMark = await this.route(
          run.mint,
          'sell',
          BigInt(fill.book.position),
        );
        fill.liquidationEquityUsdcRaw = settle(
          fill.book,
          'hold',
          exitMark,
        ).liquidationEquityUsdcRaw;
      }
      if (terms && Date.now() - terms.requestedAt > 30000)
        throw new Error('stale_quote');
      result = fill;
    } catch (cause) {
      error =
        cause instanceof Error &&
        [
          'stale_quote',
          'invalid_route_terms',
          'invalid_route_output',
          'output_below_precision',
          'insufficient_paper_cash',
        ].includes(cause.message)
          ? cause.message
          : 'route_or_fill_unavailable';
    }
    const observedAt = new Date();
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(paperRuns)
        .set({
          book: result?.book ?? run.book,
          liquidationEquityUsdcRaw:
            result?.liquidationEquityUsdcRaw ??
            (run.book.position === '0' ? run.book.cash : null),
          valuedAt: result || run.book.position === '0' ? observedAt : null,
          lastBar: time,
          nextAt,
          lastError: error,
        })
        .where(this.claim(run))
        .returning({ id: paperRuns.id });
      if (!updated.length) return;
      await tx.insert(paperEvents).values({
        runId: run.id,
        barTime: time,
        observedAt,
        evidence: {
          mode: 'paper',
          modelVersion: PAPER_MODEL.version,
          source: 'tokens-1D / Jupiter ExactIn',
          strategy: run.strategy,
          mint: run.mint,
          asOf: asOf.toISOString(),
          rows,
          before: run.book,
          signal,
          terms,
          exitMark,
          result,
          error,
        },
      });
    });
  }
}
