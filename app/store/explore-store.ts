"use client";

import { create } from "zustand";
import { getNewsFeed } from "@/services/news-feed-service";
import type { NewsFeed } from "@/types/news-feed";

export type ExploreScope = "for-you" | "trending";
interface FeedIdentity {
  userId: string;
  wallet: string;
  getAccessToken: () => Promise<string | null>;
}
interface FeedEntry {
  feed?: NewsFeed;
  isLoading: boolean;
  error: boolean;
}
interface ExploreState {
  selectedScope: ExploreScope;
  feeds: Record<string, FeedEntry>;
  selectScope: (scope: ExploreScope) => void;
  loadFeed: (scope: ExploreScope, identity?: FeedIdentity, force?: boolean) => Promise<void>;
  resetPrivateFeeds: () => void;
}

export function exploreFeedKey(scope: ExploreScope, userId?: string, wallet?: string) {
  if (scope === "trending") return "trending";
  if (userId && wallet) return JSON.stringify([scope, userId, wallet]);
}

const requests = new Map<string, { controller: AbortController; promise: Promise<void> }>();

export const useExploreStore = create<ExploreState>((set, get) => ({
  selectedScope: "for-you",
  feeds: {},
  selectScope: (selectedScope) => set({ selectedScope }),
  loadFeed(scope, identity, force = false) {
    const key = exploreFeedKey(scope, identity?.userId, identity?.wallet);
    if (!key) return Promise.resolve();
    const pending = requests.get(key);
    if (pending) return pending.promise;
    const cached = get().feeds[key];
    // Navigation preserves both successes and errors; Refresh/Retry fetch explicitly.
    if (!force && cached) return Promise.resolve();

    const controller = new AbortController();
    const isCurrent = () => requests.get(key)?.controller === controller && !controller.signal.aborted;
    const promise = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return getNewsFeed(scope, controller.signal, scope === "for-you" ? identity : undefined);
    }).then((feed) => {
      if (isCurrent()) set({ feeds: { ...get().feeds, [key]: { feed, isLoading: false, error: false } } });
    }).catch(() => {
      if (isCurrent()) set({ feeds: { ...get().feeds, [key]: { ...cached, isLoading: false, error: true } } });
    }).finally(() => {
      if (requests.get(key)?.controller === controller) requests.delete(key);
    });
    // Store-owned work survives tab/page unmounts and coalesces duplicate mounts.
    requests.set(key, { controller, promise });
    set({ feeds: { ...get().feeds, [key]: { ...cached, isLoading: true, error: false } } });
    return promise;
  },
  resetPrivateFeeds() {
    for (const [key, request] of requests) {
      if (key === "trending") continue;
      requests.delete(key);
      request.controller.abort();
    }
    const trending = get().feeds.trending;
    set({ feeds: trending ? { trending } : {} });
  },
}));
