import { Injectable } from '@nestjs/common';
import type { Equity, EquitySummary } from '../../types/equity';
import type {
  ChartRange,
  ChartSeries,
  MarketMover,
} from '../../types/market';
import { TokensService } from '../tokens/tokens.service';

@Injectable()
export class MarketService {
  constructor(private readonly tokens: TokensService) {}

  async listStocks(): Promise<EquitySummary[]> {
    const stocks = await this.tokens.getStocks();
    return stocks.map(toSummary);
  }

  async searchStocks(query: string): Promise<EquitySummary[]> {
    const stocks = await this.tokens.searchStocks(query);
    return stocks.map(toSummary);
  }

  getStock(assetId: string): Promise<Equity> {
    return this.tokens.getStock(assetId);
  }

  async getChart(assetId: string, range: ChartRange): Promise<ChartSeries> {
    const [equity, candles] = await Promise.all([
      this.tokens.getStock(assetId).catch(() => null),
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

function toSummary(equity: Equity): EquitySummary {
  return {
    id: equity.id,
    ticker: equity.ticker,
    name: equity.name,
    category: equity.category,
    logo: equity.logo,
    price: equity.price,
    priceChange24h: equity.priceChange24h,
  };
}
