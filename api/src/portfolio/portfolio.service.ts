import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Equity } from '../../types/equity';
import type { ChartRange } from '../../types/market';
import type {
  ActivityFeed,
  ActivityItem,
  ExecutionRecord,
} from '../../types/activity';
import type { WalletTransaction } from '../../types/providers/alchemy-provider';
import type { Portfolio, PortfolioHistory } from '../../types/portfolio';
import { AlchemyService } from '../alchemy/alchemy.service';
import { USDC_MINT } from '../config/constants';
import { routeVenueLabel } from '../execution/route-label';
import { TokensService } from '../tokens/tokens.service';
import {
  buildLockedByMint,
  buildPortfolio,
  buildPositions,
  cashFromBalances,
  isCashMint,
  priceFromSnapshots,
  type HoldingLot,
} from './portfolio.mapper';
import { PortfolioRepository, type ExecutionRow } from './portfolio.repository';

const RESOLVE_CONCURRENCY = 6;
const MAX_DISTINCT_MINTS = 256;
const MAX_ACTIVE_BUILDS = 4;
const MAX_CACHED_MINTS = 2048;
const HISTORY_RANGE_DAYS: Record<Exclude<ChartRange, 'ALL'>, number> = {
  '1D': 1,
  '1W': 7,
  '1M': 30,
  '3M': 90,
  '1Y': 365,
};

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);
  private readonly builds = new Map<string, Promise<Portfolio>>();
  private readonly mintLookups = new Map<string, Promise<Equity | null>>();
  private readonly mintCache = new Map<
    string,
    { equity: Equity | null; expiresAt: number }
  >();

  constructor(
    private readonly alchemy: AlchemyService,
    private readonly tokens: TokensService,
    private readonly repository: PortfolioRepository,
  ) {}

  async getPortfolio(walletAddress: string): Promise<Portfolio> {
    const current = this.builds.get(walletAddress);
    if (current) return current;
    if (this.builds.size >= MAX_ACTIVE_BUILDS) {
      throw new ServiceUnavailableException(
        'Portfolio service is busy. Try again shortly.',
      );
    }
    // Register before starting work, including synchronous provider failures.
    const build = Promise.resolve().then(() =>
      this.buildPortfolio(walletAddress),
    );
    this.builds.set(walletAddress, build);
    try {
      return await build;
    } finally {
      this.builds.delete(walletAddress);
    }
  }

  private async resolveMint(mint: string): Promise<Equity | null> {
    const cached = this.mintCache.get(mint);
    if (cached && cached.expiresAt > Date.now()) return cached.equity;
    const pending = this.mintLookups.get(mint);
    if (pending) return pending;
    const lookup = Promise.resolve().then(() => this.tokens.resolveMint(mint));
    this.mintLookups.set(mint, lookup);
    try {
      const equity = await lookup;
      this.mintCache.delete(mint);
      this.mintCache.set(mint, {
        equity,
        expiresAt: Date.now() + (equity ? 15_000 : 60_000),
      });
      if (this.mintCache.size > MAX_CACHED_MINTS) {
        const oldest = this.mintCache.keys().next();
        if (!oldest.done) this.mintCache.delete(oldest.value);
      }
      return equity;
    } finally {
      this.mintLookups.delete(mint);
    }
  }

  private async buildPortfolio(walletAddress: string): Promise<Portfolio> {
    const [balances, locks, previous] = await Promise.all([
      this.alchemy.getTokenBalances(walletAddress),
      this.repository.listVaultPositions(walletAddress),
      this.repository.getLatestSnapshot(walletAddress),
    ]);

    let cashValueUsd = cashFromBalances(balances);
    const amounts = new Map<string, number>();
    for (const balance of balances) {
      if (balance.uiAmount <= 0 || balance.mint === USDC_MINT) continue;
      amounts.set(
        balance.mint,
        (amounts.get(balance.mint) ?? 0) + balance.uiAmount,
      );
      if (amounts.size > MAX_DISTINCT_MINTS) {
        // Fail the whole request: a truncated financial total would be misleading.
        throw new ServiceUnavailableException(
          'This wallet has too many token types to load its complete portfolio.',
        );
      }
    }
    const nonCash = [...amounts].map(([mint, uiAmount]) => ({
      mint,
      uiAmount,
    }));

    const resolved = await mapPool(
      nonCash,
      RESOLVE_CONCURRENCY,
      async (bal) => {
        try {
          const equity = await this.resolveMint(bal.mint);
          if (!equity) return null;
          if (isCashMint(bal.mint, equity.id)) {
            return { kind: 'cash' as const, amount: bal.uiAmount };
          }
          return {
            kind: 'lot' as const,
            lot: {
              mint: bal.mint,
              amount: bal.uiAmount,
              equity,
            } satisfies Omit<HoldingLot, 'price' | 'priceChange24h'>,
          };
        } catch (err) {
          this.logger.warn(
            `resolveMint failed for ${bal.mint}: ${err instanceof Error ? err.message : String(err)}`,
          );
          return null;
        }
      },
    );

    const lots: HoldingLot[] = [];
    for (const item of resolved) {
      if (!item) continue;
      if (item.kind === 'cash') {
        cashValueUsd += item.amount;
      } else {
        lots.push(item.lot);
      }
    }

    const equityMints = [...new Set(lots.map((l) => l.mint))];
    let snapshots: Awaited<ReturnType<TokensService['getMarketSnapshots']>> =
      [];
    try {
      if (equityMints.length > 0) {
        snapshots = await this.tokens.getMarketSnapshots(equityMints);
      }
    } catch (err) {
      this.logger.warn(
        `market-snapshots failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const priceMap = priceFromSnapshots(snapshots);
    const pricedLots: HoldingLot[] = lots.map((lot) => {
      const snap = priceMap.get(lot.mint);
      const price =
        snap?.price ??
        lot.equity.price ??
        lot.equity.variants.find((v) => v.mint === lot.mint)?.liquidity;
      return {
        ...lot,
        price: typeof price === 'number' ? price : 0,
        priceChange24h: snap?.priceChange24h ?? lot.equity.priceChange24h,
      };
    });

    // Ensure equity.variants includes held mints for mapper
    for (const lot of pricedLots) {
      if (!lot.equity.variants.some((v) => v.mint === lot.mint)) {
        lot.equity = {
          ...lot.equity,
          variants: [
            ...lot.equity.variants,
            {
              mint: lot.mint,
              symbol: lot.equity.ticker,
              name: lot.equity.name,
              tradable: true,
            },
          ],
        };
      }
    }

    const lockedByMint = buildLockedByMint(locks);
    const positions = buildPositions(pricedLots, lockedByMint);

    const previousTotal = previous ? Number(previous.totalValueUsd) : null;

    const portfolio = buildPortfolio({
      walletAddress,
      positions,
      cashValueUsd,
      previousTotalValueUsd: previousTotal,
    });

    try {
      await this.repository.insertSnapshot({
        walletAddress,
        totalValueUsd: portfolio.totalValueUsd,
        availableValueUsd: portfolio.availableValueUsd,
        lockedValueUsd: portfolio.lockedValueUsd,
        positionsJson: portfolio.positions,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write portfolio snapshot: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return portfolio;
  }

  async getHistory(
    walletAddress: string,
    range: ChartRange = 'ALL',
  ): Promise<PortfolioHistory> {
    if (range !== 'ALL' && !Object.hasOwn(HISTORY_RANGE_DAYS, range)) {
      throw new BadRequestException('Invalid portfolio history range');
    }
    const end = new Date();
    // Range queries are chronological; the legacy latest-snapshots query is not.
    const rows =
      range === 'ALL'
        ? [...(await this.repository.listSnapshots(walletAddress))].reverse()
        : await this.repository.listSnapshotsInRange(
            walletAddress,
            new Date(end.getTime() - HISTORY_RANGE_DAYS[range] * 86_400_000),
            end,
          );
    const points = rows.map((row) => ({
      timestamp: row.timestamp,
      totalValueUsd: Number(row.totalValueUsd),
      availableValueUsd: Number(row.availableValueUsd),
      lockedValueUsd: Number(row.lockedValueUsd),
    }));
    return { walletAddress, points };
  }

  async getActivity(walletAddress: string): Promise<ActivityFeed> {
    const [orenRows, walletTxs] = await Promise.all([
      this.repository.listExecutions(walletAddress, 50),
      this.alchemy
        .getTransactionHistory(walletAddress, { limit: 20 })
        .catch((err): WalletTransaction[] => {
          this.logger.warn(
            `wallet activity failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return [];
        }),
    ]);

    const orenItems: ActivityItem[] = orenRows.map((row) => ({
      source: 'oren' as const,
      ...mapExecutionRow(row),
    }));

    const walletItems: ActivityItem[] = walletTxs.map((tx) => ({
      source: 'wallet' as const,
      ...tx,
    }));

    const items = [...orenItems, ...walletItems].sort((a, b) => {
      const ta =
        a.source === 'oren'
          ? a.createdAt.getTime()
          : (a.blockTime?.getTime() ?? 0);
      const tb =
        b.source === 'oren'
          ? b.createdAt.getTime()
          : (b.blockTime?.getTime() ?? 0);
      return tb - ta;
    });

    return { walletAddress, items };
  }
}

export function mapExecutionRow(row: ExecutionRow): ExecutionRecord {
  return {
    id: row.id,
    walletAddress: row.walletAddress,
    type: row.type,
    assetId: row.assetId ?? undefined,
    ticker: row.ticker ?? undefined,
    tokenMint: row.tokenMint ?? undefined,
    inputAsset: row.inputAsset ?? undefined,
    outputAsset: row.outputAsset ?? undefined,
    amount: row.amount !== null ? Number(row.amount) : undefined,
    amountUsd: row.amountUsd !== null ? Number(row.amountUsd) : undefined,
    provider: row.provider ?? undefined,
    route: routeVenueLabel(row.provider),
    transactionSignature: row.transactionSignature ?? undefined,
    status: row.status,
    createdAt: row.createdAt,
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
