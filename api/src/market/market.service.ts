import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { GetStocksResponse } from '../../types/api';
import type {
  Equity,
  EquitySummary,
  MarketForYouResponse,
} from '../../types/equity';
import type { InterestId } from '../../types/sectors';
import type { ChartRange, ChartSeries, MarketMover } from '../../types/market';
import { STOCK_CATALOG_TTL_MS } from '../config/constants';
import { StockCatalogRepository } from '../tokens/stock-catalog.repository';
import { TokensService } from '../tokens/tokens.service';
import { rankSectorMatches } from './sector-ranking';
import { MarketReadCache } from './market-read-cache';

@Injectable()
export class MarketService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MarketService.name);
  private catalogRefresh?: Promise<void>;
  private readonly charts = new MarketReadCache<ChartSeries>();

  constructor(
    private readonly tokens: TokensService,
    private readonly catalog: StockCatalogRepository,
  ) {}

  onApplicationBootstrap(): void {
    this.refreshCatalogInBackground();
  }

  async listStocks(page: number, limit: number): Promise<GetStocksResponse> {
    const offset = (page - 1) * limit;
    try {
      const cached = await this.catalog.listPage(offset, limit);
      if (cached.total > 0) {
        if (!cached.isFresh) this.refreshCatalogInBackground();
        return toStocksResponse(cached.items, page, limit, cached.total);
      }
    } catch (error) {
      this.logger.warn(
        `Stock catalog read failed; using Tokens directly: ${errorMessage(error)}`,
      );
    }

    const result = await this.tokens.getStocksPage(offset, limit);
    this.refreshCatalogInBackground();
    return toStocksResponse(
      result.stocks.map(toSummary),
      page,
      limit,
      result.total,
      result.hasMore,
    );
  }

  async getForYou(sectors: InterestId[]): Promise<MarketForYouResponse> {
    if (sectors.length === 0) return { state: 'no_preferences', items: [] };

    const catalog = await this.catalog
      .findSectorCandidates(sectors)
      .catch((error: unknown) => {
        this.logger.warn(`Sector catalog read failed: ${errorMessage(error)}`);
        return null;
      });
    if (!catalog || !catalog.isFresh) this.refreshCatalogInBackground();
    if (!catalog)
      throw new ServiceUnavailableException(
        'Stock sector catalog is unavailable',
      );

    const items = rankSectorMatches(catalog.items).map(
      ({ stock, sectorId, interestId }) => ({ ...stock, sectorId, interestId }),
    );
    return items.length
      ? { state: 'ready', items }
      : { state: 'no_matches', items: [] };
  }

  private refreshCatalogInBackground(): void {
    if (this.catalogRefresh) return;

    this.catalogRefresh = this.refreshCatalog()
      .catch((error) => {
        this.logger.warn(
          `Stock catalog refresh failed: ${errorMessage(error)}`,
        );
      })
      .finally(() => {
        this.catalogRefresh = undefined;
      });
  }

  private async refreshCatalog(): Promise<void> {
    const unique = new Map<string, Equity>();
    for (const stock of await this.tokens.getStocks()) {
      if (!unique.has(stock.id)) unique.set(stock.id, stock);
    }
    const stocks = [...unique.values()];
    await this.catalog.replaceAll(
      stocks,
      new Date(Date.now() + STOCK_CATALOG_TTL_MS),
    );
  }

  async searchStocks(query: string): Promise<EquitySummary[]> {
    try {
      const cached = await this.catalog.search(query);
      if (cached.length > 0) return cached;
    } catch (error) {
      this.logger.warn(
        `Stock catalog search failed; using Tokens directly: ${errorMessage(error)}`,
      );
    }

    const stocks = await this.tokens.searchStocks(query);
    return stocks.map(toSummary);
  }

  getStock(assetId: string): Promise<Equity> {
    return this.tokens.getStock(assetId);
  }

  getChart(assetId: string, range: ChartRange): Promise<ChartSeries> {
    return this.charts.get(JSON.stringify([assetId, range]), () =>
      this.loadChart(assetId, range),
    );
  }

  private async loadChart(
    assetId: string,
    range: ChartRange,
  ): Promise<ChartSeries> {
    const [equity, candles] = await Promise.all([
      this.catalog
        .findByAssetIds([assetId])
        .then((items) => items.find((item) => item.id === assetId))
        .catch(() => undefined)
        .then<EquitySummary | null>(
          (item) => item ?? this.tokens.getStock(assetId).catch(() => null),
        ),
      this.tokens.getPriceChart(assetId, range),
    ]);

    return {
      assetId,
      ticker: equity?.ticker ?? assetId.toUpperCase(),
      range,
      candles,
    };
  }

  async getTrending(): Promise<MarketMover[]> {
    const stocks = await this.tokens.getTrendingStocks();
    return stocks.map((s) => ({
      assetId: s.id,
      ticker: s.ticker,
      name: s.name,
      logo: s.logo,
      category: s.category,
      price: s.price ?? 0,
      priceChange24h: s.priceChange24h ?? 0,
      volume24h: s.volume24h,
    }));
  }
}

function toStocksResponse(
  items: EquitySummary[],
  page: number,
  limit: number,
  total: number,
  hasMore = page * limit < total,
): GetStocksResponse {
  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore,
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toSummary(equity: Equity): EquitySummary {
  return {
    id: equity.id,
    ticker: equity.ticker,
    name: equity.name,
    category: equity.category,
    logo: equity.logo,
    price: equity.price,
    priceChange24h: equity.priceChange24h,
    volume24h: equity.volume24h,
    liquidity: equity.liquidity,
  };
}
