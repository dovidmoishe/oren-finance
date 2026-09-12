import { Injectable } from '@nestjs/common';
import type { Equity, TokenizedEquity } from '../../types/equity';
import type { ChartRange, MarketCandle, OhlcvBar } from '../../types/market';
import type { EquityRisk, MarketNewsItem } from '../../types/news';
import type { TokensService as TokensServiceContract } from '../../types/providers/tokens-provider';
import { TokensNotFoundError } from '../common/errors/provider.errors';
import { chartRangeToWindow } from './chart-range.util';
import { TokensClient } from './tokens.client';
import {
  extractAssetList,
  extractCandles,
  extractNews,
  mapCandles,
  mapEquity,
  mapEquityList,
  mapNewsFeed,
  mapOhlcv,
  mapRisk,
  mapVariants,
} from './tokens.mapper';
import type {
  TokensAssetRaw,
  TokensResolveRaw,
  TokensRiskRaw,
  TokensVariantsRaw,
  TokensMarketSnapshotRaw,
} from './tokens.types';

@Injectable()
export class TokensService implements TokensServiceContract {
  constructor(private readonly client: TokensClient) {}

  async getStocks(): Promise<Equity[]> {
    const raw = await this.client.get<unknown>('/assets/curated', {
      list: 'stocks',
      groupBy: 'asset',
    });
    return mapEquityList(extractAssetList(raw));
  }

  async searchStocks(query: string): Promise<Equity[]> {
    const raw = await this.client.get<unknown>('/assets/search', {
      q: query,
      variants: 'all',
      limit: 20,
    });
    return mapEquityList(extractAssetList(raw));
  }

  async getStock(assetId: string): Promise<Equity> {
    const raw = await this.client.get<TokensAssetRaw>(
      `/assets/${encodeURIComponent(assetId)}`,
      { include: 'profile,risk' },
    );
    const equity = mapEquity(raw);
    if (!equity.id) {
      throw new TokensNotFoundError(`Asset not found: ${assetId}`);
    }
    return equity;
  }

  async getVariants(assetId: string): Promise<TokenizedEquity[]> {
    const raw = await this.client.get<TokensVariantsRaw>(
      `/assets/${encodeURIComponent(assetId)}/variants`,
      { kind: 'tokenized_equity' },
    );
    return mapVariants(raw.variants);
  }

  async resolveMint(mint: string): Promise<Equity | null> {
    try {
      const resolved = await this.client.get<TokensResolveRaw>(
        '/assets/resolve',
        { mint },
      );
      const assetId = resolved.assetId ?? resolved.asset?.assetId;
      if (!assetId) return null;
      return this.getStock(assetId);
    } catch (err) {
      if (err instanceof TokensNotFoundError) return null;
      throw err;
    }
  }

  async getCurrentMarketData(assetId: string): Promise<Equity> {
    return this.getStock(assetId);
  }

  async getPriceChart(
    assetId: string,
    range: ChartRange,
  ): Promise<MarketCandle[]> {
    const window = chartRangeToWindow(range);
    const raw = await this.client.get<unknown>(
      `/assets/${encodeURIComponent(assetId)}/price-chart`,
      {
        interval: window.interval,
        from: window.from,
        to: window.to,
      },
    );
    return mapCandles(extractCandles(raw));
  }

  async getOHLCV(
    assetId: string,
    params?: { start?: Date; end?: Date; timeframe?: string },
  ): Promise<OhlcvBar[]> {
    const to = Math.floor((params?.end ?? new Date()).getTime() / 1000);
    const from = Math.floor(
      (params?.start ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).getTime() /
        1000,
    );
    const raw = await this.client.get<unknown>(
      `/assets/${encodeURIComponent(assetId)}/ohlcv`,
      {
        interval: params?.timeframe ?? '1H',
        from,
        to,
      },
    );
    return mapOhlcv(assetId, extractCandles(raw));
  }

  async getTrendingStocks(): Promise<Equity[]> {
    const raw = await this.client.get<unknown>('/assets/trending', {
      category: 'equity',
      limit: 50,
    });
    return mapEquityList(extractAssetList(raw));
  }

  async getRisk(assetId: string): Promise<EquityRisk> {
    const raw = await this.client.get<TokensRiskRaw>(
      `/assets/${encodeURIComponent(assetId)}/risk-summary`,
    );
    return mapRisk(assetId, assetId.toUpperCase(), raw);
  }

  async getNews(assetId?: string): Promise<MarketNewsItem[]> {
    const query: Record<string, string | number | undefined> = {};
    if (assetId) query.assetId = assetId;
    const raw = await this.client.get<unknown>('/news/feed', query);
    return mapNewsFeed(extractNews(raw));
  }

  /** Phase 1 helper — bulk mint pricing (max 250). */
  async getMarketSnapshots(
    mints: string[],
  ): Promise<TokensMarketSnapshotRaw[]> {
    if (mints.length === 0) return [];
    const raw = await this.client.post<{
      results?: TokensMarketSnapshotRaw[];
      snapshots?: TokensMarketSnapshotRaw[];
    }>('/assets/market-snapshots', { mints: mints.slice(0, 250) });
    return raw.results ?? raw.snapshots ?? [];
  }

  /** Phase 1 helper — batch variant markets (max 50). */
  async getVariantMarkets(mints: string[]): Promise<unknown> {
    if (mints.length === 0) return [];
    return this.client.get('/assets/variant-markets', {
      mints: mints.slice(0, 50).join(','),
    });
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    return this.client.getHealth();
  }
}
