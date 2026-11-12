import type { TokensMarketSnapshotRaw } from '../tokens/tokens.types';

export const QUOTE_MAX_AGE_MS = 120_000;
export const BASELINE_MAX_GAP_MS = 180_000;

export interface Quote {
  mint: string;
  price: number;
  at: Date;
}

export function providerQuote(
  raw: TokensMarketSnapshotRaw,
  now: Date,
  maxTradeAgeMs = QUOTE_MAX_AGE_MS,
): Quote | null {
  if (
    !raw.mint ||
    typeof raw.price !== 'number' ||
    !Number.isFinite(raw.price) ||
    raw.price <= 0
  )
    return null;
  const timestamp = raw.priceUpdatedAt;
  let at: Date;
  if (
    typeof timestamp === 'string' &&
    /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)
  ) {
    at = new Date(timestamp);
  } else {
    // The provider timestamp must be corroborated by recent venue activity.
    // Our poll time alone says nothing about the age of a quote.
    if (
      !Number.isSafeInteger(raw.providerFetchedAt) ||
      !Number.isSafeInteger(raw.lastTradeAt)
    )
      return null;
    const trade = raw.lastTradeAt!;
    const fetched = raw.providerFetchedAt!;
    if (trade > fetched || now.getTime() - trade > maxTradeAgeMs) return null;
    at = new Date(fetched);
  }
  const age = now.getTime() - at.getTime();
  if (!Number.isFinite(age) || age < 0 || age > QUOTE_MAX_AGE_MS) return null;
  return { mint: raw.mint, price: raw.price, at };
}

export function crossed(
  direction: 'above' | 'below',
  target: number,
  previous: { price: number; at: Date } | null,
  current: Quote,
): boolean {
  if (
    !previous ||
    current.at.getTime() <= previous.at.getTime() ||
    current.at.getTime() - previous.at.getTime() > BASELINE_MAX_GAP_MS
  )
    return false;
  return direction === 'above'
    ? previous.price < target && current.price >= target
    : previous.price > target && current.price <= target;
}
