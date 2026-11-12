import type { TokensMarketSnapshotRaw } from './tokens.types';

type WrappedSnapshot = {
  address?: string;
  hasMarket?: boolean;
  token?: {
    address?: string;
    price?: number;
    priceChange24hPercent?: number;
    volume24hUSD?: number;
    lastFetchedAt?: number;
    lastTradeAt?: number;
  } | null;
};

export function normalizeMarketSnapshots(
  raw:
    | Array<WrappedSnapshot | TokensMarketSnapshotRaw>
    | {
        results?: TokensMarketSnapshotRaw[];
        snapshots?: TokensMarketSnapshotRaw[];
      },
): TokensMarketSnapshotRaw[] {
  if (!Array.isArray(raw)) return raw.results ?? raw.snapshots ?? [];
  return raw.flatMap((entry) => {
    if ('mint' in entry && entry.mint) return [entry];
    if (
      !('token' in entry) ||
      !entry.hasMarket ||
      !entry.token ||
      !entry.address ||
      entry.token.address !== entry.address
    )
      return [];
    return [
      {
        mint: entry.address,
        price: entry.token.price,
        priceChange24hPercent: entry.token.priceChange24hPercent,
        volume24hUSD: entry.token.volume24hUSD,
        providerFetchedAt: entry.token.lastFetchedAt,
        lastTradeAt: entry.token.lastTradeAt,
      },
    ];
  });
}
