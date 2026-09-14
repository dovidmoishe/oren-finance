"use client";

import { create } from "zustand";
import { getPortfolio, getPortfolioActivity, getPortfolioHistory } from "@/services";
import type { PortfolioActivityItem, PortfolioRange, PortfolioSnapshot, PortfolioSummary } from "@/types";

interface PortfolioState {
  wallet?: string;
  portfolio?: PortfolioSummary;
  history: PortfolioSnapshot[];
  activity: PortfolioActivityItem[];
  isLoading: boolean;
  error?: string;
  loadPortfolio: (wallet: string) => Promise<void>;
  loadHistory: (wallet: string, range?: PortfolioRange) => Promise<void>;
  loadActivity: (wallet: string) => Promise<void>;
  reset: () => void;
}

export const usePortfolioStore = create<PortfolioState>((set) => ({
  history: [],
  activity: [],
  isLoading: false,
  async loadPortfolio(wallet) {
    set({ wallet, isLoading: true, error: undefined });
    try {
      const portfolio = await getPortfolio(wallet);
      set({ portfolio, isLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to load portfolio", isLoading: false });
    }
  },
  async loadHistory(wallet, range) {
    try {
      const history = await getPortfolioHistory(wallet, range);
      set({ history });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to load portfolio history" });
    }
  },
  async loadActivity(wallet) {
    try {
      const activity = await getPortfolioActivity(wallet);
      set({ activity });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to load portfolio activity" });
    }
  },
  reset() {
    set({ wallet: undefined, portfolio: undefined, history: [], activity: [], error: undefined, isLoading: false });
  },
}));
