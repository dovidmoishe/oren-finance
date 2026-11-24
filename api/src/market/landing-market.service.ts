import { Injectable } from '@nestjs/common';
import { MarketReadCache } from './market-read-cache';
import { TokensService } from '../tokens/tokens.service';
import { IntelligenceService } from '../intelligence/intelligence.service';

@Injectable()
export class LandingMarketService {
  private readonly cache = new MarketReadCache<
    Awaited<ReturnType<LandingMarketService['load']>>
  >(60_000, 1, 1, 1);
  constructor(
    private readonly tokens: TokensService,
    private readonly intelligence: IntelligenceService,
  ) {}

  getSnapshot() {
    return this.cache.get('landing', () => this.load());
  }

  private async load() {
    const [stocks, candles, analysis] = await Promise.all([
      Promise.all(
        ['nvidia', 'apple', 'microsoft', 'tesla'].map((id) =>
          this.tokens.getStock(id),
        ),
      ),
      this.tokens.getPriceChart('nvidia', '1M'),
      this.intelligence.getAnalysis('nvidia'),
    ]);
    if (
      stocks.some(
        (stock) =>
          !Number.isFinite(stock.price) ||
          stock.price! <= 0 ||
          !Number.isFinite(stock.priceChange24h),
      ) ||
      candles.length < 2
    )
      throw new Error('Incomplete landing market snapshot');
    return {
      retrievedAt: new Date().toISOString(),
      stale: false,
      data: {
        source: 'Tokens.xyz',
        stocks: stocks.map(({ id, ticker, name, price, priceChange24h }) => ({
          assetId: id,
          ticker,
          name,
          price,
          priceChange24h,
        })),
        candles,
        analysis,
      },
    };
  }
}
