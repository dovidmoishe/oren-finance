import type { Metadata } from "next";
import { TraderProfile } from "@/components/social";

export const metadata: Metadata = { title: "Trader profile" };

export default async function TraderProfilePage({ params }: PageProps<"/app/leaderboard/[slug]">) {
  const { slug } = await params;

  return <TraderProfile slug={slug} />;
}
