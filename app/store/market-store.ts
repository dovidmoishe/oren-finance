"use client";

import { create } from "zustand";
import { getMarketOpportunities, getStocks, getTrendingStocks, searchStocks } from "@/services";
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
  loadMarkets: () => Promise<void>;
  loadNextStocks: () => Promise<void>;
  search: (query: string) => Promise<void>;
}

const STOCKS_PAGE_SIZE = 20;

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
  async loadMarkets() {
    if (get().isLoading) return;

    set({ isLoading: true, error: undefined });
    try {
      const [stockPage, trendingResult, opportunitiesResult] = await Promise.all([
        getStocks(1, STOCKS_PAGE_SIZE),
        getTrendingStocks().catch(() => []),
        getMarketOpportunities().catch(() => []),
      ]);
      set({
        opportunities: opportunitiesResult,
        stocks: stockPage.items,
        trending: trendingResult,
        hasMore: stockPage.pagination.hasMore,
        nextPage: 2,
        isLoading: false,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to load markets", isLoading: false });
    }
  },
  async loadNextStocks() {
    const { hasMore, isLoading, isLoadingMore, nextPage, stocks } = get();
    if (!hasMore || isLoading || isLoadingMore) return;

    set({ isLoadingMore: true, error: undefined });
    try {
      const stockPage = await getStocks(nextPage, STOCKS_PAGE_SIZE);
      const byId = new Map(stocks.map((stock) => [stock.assetId, stock]));
      for (const stock of stockPage.items) {
        byId.set(stock.assetId, stock);
      }
      set({
        stocks: [...byId.values()],
        hasMore: stockPage.pagination.hasMore,
        nextPage: nextPage + 1,
        isLoadingMore: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Unable to load more stocks",
        isLoadingMore: false,
      });
    }
  },
  async search(query) {
    if (!query.trim()) {
      set({ searchResults: [], isSearching: false });
      return;
    }

    set({ isSearching: true, error: undefined });
    try {
      const searchResults = await searchStocks(query);
      set({ searchResults, isSearching: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Unable to search stocks",
        isSearching: false,
      });
    }
  },
}));
