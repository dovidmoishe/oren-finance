"use client";

import { useCallback } from "react";
import { usePortfolioStore, useWalletStore } from "@/store";
import type { PortfolioRange } from "@/types";

export function usePortfolioRefresh(range?: PortfolioRange) {
  const wallet = useWalletStore((state) => state.address);
  const selectedRange = usePortfolioStore((state) => state.selectedRange);
  const historyRange = range ?? selectedRange;
  const loadPortfolio = usePortfolioStore((state) => state.loadPortfolio);
  const loadHistory = usePortfolioStore((state) => state.loadHistory);
  const loadActivity = usePortfolioStore((state) => state.loadActivity);

  return useCallback(async (force = true) => {
    if (!wallet) {
      return;
    }

    await Promise.all([loadPortfolio(wallet), loadHistory(wallet, historyRange, force), loadActivity(wallet)]);
  }, [loadActivity, loadHistory, loadPortfolio, historyRange, wallet]);
}
