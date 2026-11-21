"use client";

import { create } from "zustand";
import { getMarketOpportunities, getStocks, getTrendingStocks, searchStocks } from "@/services/market-service";
import type { StockSummary } from "@/types";

interface MarketState {
  stocks: StockSummary[];
  trending: StockSummary[];
  opportunities: StockSummary[];
  searchResults: StockSummary[];
  isLoading: boolean;
  isLoadingMore: boolean;
  isSearching: boolean;
  hasMore: boolean;
  nextPage: number;
  error?: string;
  loadMoreError?: string;
  loadMarkets: () => Promise<void>;
  loadNextStocks: () => Promise<void>;
  search: (query: string) => Promise<void>;
}

const STOCKS_PAGE_SIZE = 20;
let searchRequestId = 0;
let initialRequest: Promise<void> | undefined;
let featuredRequest: Promise<void> | undefined;

function mergeStocks(existing: StockSummary[], incoming: StockSummary[]) {
  if (!existing.length) {
    return incoming;
  }

  const byId = new Map(existing.map((stock) => [stock.assetId, stock]));
  for (const stock of incoming) {
    byId.set(stock.assetId, { ...byId.get(stock.assetId), ...stock });
  }

  return [...byId.values()];
}

export const useMarketStore = create<MarketState>((set, get) => ({
  stocks: [],
  trending: [],
  opportunities: [],
  searchResults: [],
  isLoading: false,
  isLoadingMore: false,
  isSearching: false,
  hasMore: true,
  nextPage: 1,
  loadMarkets() {
    if (initialRequest) return initialRequest;
    set({ isLoading: true, error: undefined });
    // Publish primary rows independently of optional featured data.
    const stocks = getStocks(1, STOCKS_PAGE_SIZE).then((stockPage) => {
      const current = get();
      set({
        stocks: mergeStocks(current.stocks, stockPage.items),
        hasMore: current.stocks.length > stockPage.items.length ? current.hasMore : stockPage.pagination.hasMore,
        nextPage: Math.max(current.nextPage, 2),
        isLoading: false,
      });
    }).catch((error: unknown) => {
      set({ error: error instanceof Error ? error.message : "Unable to load markets", isLoading: false });
    });
    if (!featuredRequest) {
      const trending = getTrendingStocks().then((trending) => set({ trending })).catch(() => {});
      const opportunities = getMarketOpportunities().then((opportunities) => set({ opportunities })).catch(() => {});
      featuredRequest = Promise.all([trending, opportunities]).then(() => {}).finally(() => { featuredRequest = undefined; });
    }
    // A failed primary read can retry even while optional cards are pending.
    initialRequest = stocks.finally(() => { initialRequest = undefined; });
    return initialRequest;
  },
  async loadNextStocks() {
    const { hasMore, isLoading, isLoadingMore, nextPage } = get();
    if (!hasMore || isLoading || isLoadingMore) return;

    set({ isLoadingMore: true, loadMoreError: undefined });
    try {
      const stockPage = await getStocks(nextPage, STOCKS_PAGE_SIZE);
      set({
        stocks: mergeStocks(get().stocks, stockPage.items),
        hasMore: stockPage.pagination.hasMore,
        nextPage: nextPage + 1,
        isLoadingMore: false,
      });
    } catch (error) {
      set({
        loadMoreError: error instanceof Error ? error.message : "Unable to load more stocks",
        isLoadingMore: false,
      });
    }
  },
  async search(query) {
    const requestId = ++searchRequestId;
    if (!query.trim()) {
      set({ searchResults: [], isSearching: false });
      return;
    }

    set({ searchResults: [], isSearching: true, error: undefined });
    try {
      const searchResults = await searchStocks(query);
      if (requestId !== searchRequestId) return;
      set({ searchResults });
    } catch (error) {
      if (requestId !== searchRequestId) return;
      set({
        error: error instanceof Error ? error.message : "Unable to search stocks",
      });
    } finally {
      if (requestId === searchRequestId) set({ isSearching: false });
    }
  },
}));
