import type { Metadata } from "next";
import { ExplorePage } from "@/components/news/news-page";

export const metadata: Metadata = { title: "Explore" };

export default function ExploreRoute() {
  return <ExplorePage />;
}
