import type { Metadata } from "next";
import { BrowserTradeReview } from './trade-review';

export const metadata: Metadata = { title: "Review trade" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BrowserTradeReview intentId={id} />;
}
