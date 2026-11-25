import "server-only";
import type { SeoStock } from "./seo";

// Server-side catalog reads for stock metadata and the sitemap. The stock pages
// themselves still load their data in the browser; these reads only name them.

const STOCK_REVALIDATE_SECONDS = 60 * 60;
const SITEMAP_REVALIDATE_SECONDS = 6 * 60 * 60;
const PAGE_LIMIT = 50; // the API's maximum page size
const MAX_PAGES = 40;

/**
 * Previews and CI build with a relative /api that only the browser can resolve,
 * so they skip these reads and fall back to generic metadata.
 */
function serverApiBase() {
  const configured = process.env.NEXT_PUBLIC_OREN_API_URL?.replace(/\/+$/, "");
  return configured && /^https?:\/\//.test(configured) ? configured : undefined;
}

function toSeoStock(value: unknown): SeoStock | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { id, ticker, name, category } = value as Record<string, unknown>;
  if (typeof id !== "string" || typeof ticker !== "string" || typeof name !== "string" || !id || !ticker || !name) return undefined;
  return { id, ticker, name, ...(typeof category === "string" ? { category } : {}) };
}

/** null when the catalog has no such asset; undefined when the API could not answer. */
export async function getSeoStock(assetId: string): Promise<SeoStock | null | undefined> {
  const base = serverApiBase();
  if (!base) return undefined;
  try {
    const response = await fetch(`${base}/stocks/${encodeURIComponent(assetId)}`, {
      next: { revalidate: STOCK_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(2_500),
    });
    if (response.status === 404) return null;
    if (!response.ok) return undefined;
    return toSeoStock(await response.json());
  } catch {
    return undefined;
  }
}

async function getStocksPage(base: string, page: number) {
  const response = await fetch(`${base}/stocks?page=${page}&limit=${PAGE_LIMIT}`, {
    next: { revalidate: SITEMAP_REVALIDATE_SECONDS },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`stocks page ${page} returned ${response.status}`);
  const body = (await response.json()) as { items?: unknown[]; pagination?: { totalPages?: number } };
  return {
    ids: (body.items ?? []).map(toSeoStock).filter((stock): stock is SeoStock => Boolean(stock)).map((stock) => stock.id),
    totalPages: Number(body.pagination?.totalPages) || 1,
  };
}

/** Every catalog asset id, or the pages that answered. Empty when the API is unreachable. */
export async function getSeoStockIds(): Promise<string[]> {
  const base = serverApiBase();
  if (!base) return [];
  try {
    const first = await getStocksPage(base, 1);
    const pages = Math.min(first.totalPages, MAX_PAGES);
    const rest = await Promise.allSettled(Array.from({ length: pages - 1 }, (_, index) => getStocksPage(base, index + 2)));
    return [...first.ids, ...rest.flatMap((result) => (result.status === "fulfilled" ? result.value.ids : []))];
  } catch {
    return [];
  }
}
