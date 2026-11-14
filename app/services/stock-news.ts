import type { NewsItem, StockSummary } from "@/types";

function words(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Broad feeds can match a common word from a company name, such as "two". */
export function filterStockNews<T extends Pick<NewsItem, "headline" | "summary" | "assetId" | "ticker">>(items: T[], stock: Pick<StockSummary, "assetId" | "ticker" | "name">): T[] {
  const identities = [stock.ticker, stock.name, stock.assetId].map(words).filter(Boolean);
  return items.filter((item) => {
    if (item.assetId === stock.assetId || item.ticker?.toLowerCase() === stock.ticker.toLowerCase()) return true;
    const text = ` ${words(`${item.headline} ${item.summary ?? ""}`)} `;
    return identities.some((identity) => text.includes(` ${identity} `));
  });
}
