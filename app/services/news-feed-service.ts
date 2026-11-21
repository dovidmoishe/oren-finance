import type { NewsFeed } from "@/types/news-feed";
import { apiRequest } from "./api-client";

export async function getNewsFeed(scope: "for-you" | "trending", signal: AbortSignal, identity?: {
  wallet: string;
  getAccessToken: () => Promise<string | null>;
}): Promise<NewsFeed> {
  if (scope === "trending") return apiRequest<NewsFeed>("/news/trending", { signal });
  if (!identity?.wallet) throw new Error("A connected wallet is required");
  const token = await identity.getAccessToken();
  signal.throwIfAborted();
  if (!token) throw new Error("Sign in to see your news");
  return apiRequest<NewsFeed>("/news/for-you", {
    signal,
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
    query: { walletAddress: identity.wallet },
  });
}
