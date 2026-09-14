/** Raw Tokens.xyz Assets API response shapes (loose — mapped to domain). */

export interface TokensErrorBody {
  error?: {
    _tag?: string;
    message?: string;
    details?: unknown;
  };
}

export interface TokensVariantRaw {
  variantId?: string;
  mint?: string;
  symbol?: string;
  name?: string;
  label?: string;
  kind?: string;
  decimals?: number;
  liquidity?: number;
  liquidityTier?: string;
  trustTier?: string;
  stockVariantTier?: string;
  tradable?: boolean;
  market?: {
    price?: number;
    priceChange24hPercent?: number;
    volume24hUSD?: number;
    liquidity?: number;
    liquidityUSD?: number;
    logoURI?: string | null;
  };
}

export interface TokensAssetRaw {
  assetId?: string;
  id?: string;
  ticker?: string;
  symbol?: string;
  name?: string;
  category?: string;
  logo?: string | null;
  logoUrl?: string | null;
  imageUrl?: string | null;
  sector?: string;
  price?: number;
  priceChange24h?: number;
  priceChange24hPercent?: number;
  volume24h?: number;
  volume24hUSD?: number;
  liquidity?: number;
  stats?: {
    price?: number | null;
    liquidity?: number | null;
    volume24hUSD?: number;
    volume30dUSD?: number | null;
    priceChange24hPercent?: number | null;
  };
  variants?: TokensVariantRaw[];
  primaryVariant?: TokensVariantRaw;
  asset?: TokensAssetRaw;
}

export interface TokensResolveRaw {
  assetId?: string;
  name?: string;
  category?: string;
  primaryVariant?: TokensVariantRaw;
  asset?: TokensAssetRaw;
}

export interface TokensSearchRaw {
  results?: TokensAssetRaw[];
  assets?: TokensAssetRaw[];
  items?: TokensAssetRaw[];
}

export interface TokensCuratedRaw {
  listId?: string;
  results?: TokensAssetRaw[];
  assets?: TokensAssetRaw[];
  items?: TokensAssetRaw[];
  pagination?: {
    offset?: number;
    limit?: number;
    total?: number;
    hasMore?: boolean;
    nextOffset?: number | null;
  };
}

export interface TokensVariantsRaw {
  assetId?: string;
  variants?: TokensVariantRaw[];
}

export interface TokensCandleRaw {
  timestamp?: number;
  t?: number;
  open?: number;
  o?: number;
  high?: number;
  h?: number;
  low?: number;
  l?: number;
  close?: number;
  c?: number;
  volume?: number;
  v?: number;
}

export interface TokensChartRaw {
  candles?: TokensCandleRaw[];
  data?: TokensCandleRaw[];
  bars?: TokensCandleRaw[];
}

export interface TokensRiskRaw {
  assetId?: string;
  score?: number;
  grade?: string;
  label?: string;
  volatility?: number;
  caps?: unknown[];
  [key: string]: unknown;
}

export interface TokensNewsItemRaw {
  id?: string;
  assetId?: string;
  ticker?: string;
  headline?: string;
  title?: string;
  source?: string;
  summary?: string;
  description?: string;
  url?: string;
  publishedAt?: string | number;
  published_at?: string | number;
  imageUrl?: string;
  image?: string;
}

export interface TokensNewsFeedRaw {
  items?: TokensNewsItemRaw[];
  results?: TokensNewsItemRaw[];
  feed?: TokensNewsItemRaw[];
}

export interface TokensTrendingRaw {
  results?: TokensAssetRaw[];
  assets?: TokensAssetRaw[];
  items?: TokensAssetRaw[];
}

export interface TokensMarketSnapshotRaw {
  mint?: string;
  price?: number;
  priceChange24hPercent?: number;
  volume24hUSD?: number;
  assetId?: string;
}
