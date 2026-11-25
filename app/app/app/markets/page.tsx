import { MarketsOverview } from "@/components/markets";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Tokenized stocks on Solana",
  description: "Browse tokenized stocks and ETFs on Solana, including Tesla, NVIDIA and Apple. Compare live prices, 24h volume and liquidity, then research any stock with Oren.",
  path: "/app/markets",
});

export default function MarketsPage() {
  return <MarketsOverview />;
}
