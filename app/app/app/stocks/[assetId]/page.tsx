import type { Metadata } from "next";
import { StockDetail } from "@/components/stock";
import { PRIVATE_ROBOTS, pageMetadata, stockSeo } from "@/lib/seo";
import { getSeoStock } from "@/lib/seo-data";

export async function generateMetadata({ params }: PageProps<"/app/stocks/[assetId]">): Promise<Metadata> {
  const { assetId } = await params;
  const stock = await getSeoStock(assetId);
  if (stock === null) return { title: "Stock not found", robots: PRIVATE_ROBOTS };
  // Keep the page indexable when the catalog is briefly unavailable; only the copy is generic.
  if (!stock) return pageMetadata({ title: "Tokenized stock", description: "Live price, chart, liquidity and AI research for a tokenized stock on Solana." });
  // The canonical uses the catalog id, so /app/stocks/TSLA points at /app/stocks/tesla.
  return pageMetadata(stockSeo(stock));
}

export default async function StockPage({ params }: PageProps<"/app/stocks/[assetId]">) {
  const { assetId } = await params;

  return <StockDetail key={assetId} assetId={assetId} />;
}
