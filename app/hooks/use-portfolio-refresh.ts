"use client";

import { useCallback } from "react";
import { usePortfolioStore } from "@/store/portfolio-store";
import { useWalletStore } from "@/store/wallet-store";
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

    await Promise.all([loadPortfolio(wallet, force), loadHistory(wallet, historyRange, force), loadActivity(wallet, force)]);
  }, [loadActivity, loadHistory, loadPortfolio, historyRange, wallet]);
}
