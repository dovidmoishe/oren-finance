import type { MarketNewsItem, NewsFeedStock } from '../../types/news';

/** Match the canonical issuer or full name, not generic name fragments. */
export function matchesStock(
  item: MarketNewsItem,
  stock: NewsFeedStock,
): boolean {
  if (
    item.assetId === stock.assetId ||
    item.ticker?.toLowerCase() === stock.ticker.toLowerCase()
  )
    return true;
  const normalize = (text: string) =>
    text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const text = ` ${normalize(`${item.headline} ${item.summary ?? ''}`)} `;
  return [stock.ticker, stock.assetId, stock.name]
    .map(normalize)
    .filter(Boolean)
    .some((identity) => text.includes(` ${identity} `));
}
