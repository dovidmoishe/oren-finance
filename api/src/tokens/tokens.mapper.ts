import type { Equity, EquityCategory, TokenizedEquity } from '../../types/equity';
import type { MarketCandle, OhlcvBar } from '../../types/market';
import type { EquityRisk, MarketNewsItem } from '../../types/news';
import type {
  TokensAssetRaw,
  TokensCandleRaw,
  TokensNewsItemRaw,
  TokensRiskRaw,
  TokensVariantRaw,
} from './tokens.types';

function asCategory(value?: string): EquityCategory {
  const v = (value ?? 'equity').toLowerCase();
  if (v === 'etf' || v === 'index' || v === 'equity') return v;
  if (v === 'stock' || v === 'stocks' || v === 'rwa') return 'equity';
  return 'equity';
}

function pickAsset(raw: TokensAssetRaw): TokensAssetRaw {
  return raw.asset ?? raw;
}

export function mapVariant(raw: TokensVariantRaw): TokenizedEquity | null {
  if (!raw.mint) return null;
  return {
    mint: raw.mint,
    symbol: raw.symbol ?? raw.label ?? raw.mint.slice(0, 6),
    name: raw.name ?? raw.symbol ?? raw.mint,
    issuer: raw.label,
    decimals: raw.decimals,
    liquidity: raw.liquidity ?? raw.market?.liquidityUSD,
    liquidityTier: raw.liquidityTier,
    trustTier: raw.trustTier,
    stockVariantTier: raw.stockVariantTier,
    tradable: raw.tradable ?? true,
  };
}

export function mapVariants(raws?: TokensVariantRaw[]): TokenizedEquity[] {
  if (!raws?.length) return [];
  return raws
    .map(mapVariant)
    .filter((v): v is TokenizedEquity => v !== null);
}

export function mapEquity(rawInput: TokensAssetRaw): Equity {
  const raw = pickAsset(rawInput);
  const id = raw.assetId ?? raw.id ?? '';
  const variants = mapVariants(raw.variants);
  const primary = raw.primaryVariant
    ? mapVariant(raw.primaryVariant)
    : undefined;
  if (primary && !variants.some((v) => v.mint === primary.mint)) {
    variants.unshift(primary);
  }

  const price =
    raw.price ??
    raw.primaryVariant?.market?.price ??
    variants[0]?.liquidity;

  return {
    id,
    ticker: (raw.ticker ?? raw.symbol ?? id).toUpperCase(),
    name: raw.name ?? raw.ticker ?? id,
    category: asCategory(raw.category),
    logo: raw.logo ?? raw.logoUrl,
    price:
      typeof price === 'number'
        ? price
        : raw.primaryVariant?.market?.price,
    priceChange24h:
      raw.priceChange24hPercent ??
      raw.priceChange24h ??
      raw.primaryVariant?.market?.priceChange24hPercent,
    volume24h:
      raw.volume24hUSD ??
      raw.volume24h ??
      raw.stats?.volume24hUSD ??
      raw.primaryVariant?.market?.volume24hUSD,
    liquidity:
      raw.liquidity ?? raw.primaryVariant?.market?.liquidityUSD,
    sector: raw.sector,
    variants,
  };
}

export function mapEquityList(
  items?: TokensAssetRaw[] | null,
): Equity[] {
  if (!items?.length) return [];
  return items
    .map((item) => {
      try {
        return mapEquity(item);
      } catch {
        return null;
      }
    })
    .filter((e): e is Equity => e !== null && Boolean(e.id));
}

export function mapCandle(raw: TokensCandleRaw): MarketCandle | null {
  const ts = raw.timestamp ?? raw.t;
  if (ts === undefined) return null;
  const open = raw.open ?? raw.o;
  const high = raw.high ?? raw.h;
  const low = raw.low ?? raw.l;
  const close = raw.close ?? raw.c;
  if (
    open === undefined ||
    high === undefined ||
    low === undefined ||
    close === undefined
  ) {
    return null;
  }
  const ms = ts > 1_000_000_000_000 ? ts : ts * 1000;
  return {
    timestamp: new Date(ms),
    open,
    high,
    low,
    close,
    volume: raw.volume ?? raw.v,
  };
}

export function mapCandles(raws?: TokensCandleRaw[]): MarketCandle[] {
  if (!raws?.length) return [];
  return raws
    .map(mapCandle)
    .filter((c): c is MarketCandle => c !== null);
}

export function mapOhlcv(
  assetId: string,
  raws?: TokensCandleRaw[],
): OhlcvBar[] {
  return mapCandles(raws).map((c) => ({ ...c, assetId }));
}

export function mapRisk(
  assetId: string,
  ticker: string,
  raw: TokensRiskRaw,
): EquityRisk {
  return {
    assetId: raw.assetId ?? assetId,
    ticker,
    score: raw.score,
    label: raw.label ?? raw.grade,
    volatility: raw.volatility,
    metadata: raw,
  };
}

export function mapNewsItem(raw: TokensNewsItemRaw): MarketNewsItem | null {
  const headline = raw.headline ?? raw.title;
  if (!headline) return null;
  const published = raw.publishedAt ?? raw.published_at;
  let publishedAt = new Date();
  if (typeof published === 'number') {
    publishedAt = new Date(
      published > 1_000_000_000_000 ? published : published * 1000,
    );
  } else if (typeof published === 'string') {
    publishedAt = new Date(published);
  }
  return {
    id: raw.id,
    assetId: raw.assetId,
    ticker: raw.ticker,
    headline,
    source: raw.source,
    summary: raw.summary ?? raw.description,
    url: raw.url,
    publishedAt,
    imageUrl: raw.imageUrl ?? raw.image,
  };
}

export function mapNewsFeed(
  items?: TokensNewsItemRaw[] | null,
): MarketNewsItem[] {
  if (!items?.length) return [];
  return items
    .map(mapNewsItem)
    .filter((n): n is MarketNewsItem => n !== null);
}

export function extractAssetList(payload: unknown): TokensAssetRaw[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;
  if (Array.isArray(p)) return p as TokensAssetRaw[];
  if (Array.isArray(p.results)) return p.results as TokensAssetRaw[];
  if (Array.isArray(p.assets)) return p.assets as TokensAssetRaw[];
  if (Array.isArray(p.items)) return p.items as TokensAssetRaw[];
  if (p.asset && typeof p.asset === 'object') return [p.asset as TokensAssetRaw];
  if (p.assetId || p.id) return [p as TokensAssetRaw];
  return [];
}

export function extractCandles(payload: unknown): TokensCandleRaw[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;
  if (Array.isArray(p)) return p as TokensCandleRaw[];
  if (Array.isArray(p.candles)) return p.candles as TokensCandleRaw[];
  if (Array.isArray(p.data)) return p.data as TokensCandleRaw[];
  if (Array.isArray(p.bars)) return p.bars as TokensCandleRaw[];
  return [];
}

export function extractNews(payload: unknown): TokensNewsItemRaw[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;
  if (Array.isArray(p)) return p as TokensNewsItemRaw[];
  if (Array.isArray(p.items)) return p.items as TokensNewsItemRaw[];
  if (Array.isArray(p.results)) return p.results as TokensNewsItemRaw[];
  if (Array.isArray(p.feed)) return p.feed as TokensNewsItemRaw[];
  return [];
}
