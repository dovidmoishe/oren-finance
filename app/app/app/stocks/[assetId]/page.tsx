import { StockDetail } from "@/components/stock";

export default async function StockPage({ params }: PageProps<"/app/stocks/[assetId]">) {
  const { assetId } = await params;
  return <StockDetail assetId={assetId} />;
}
