"use client";

import { create } from "zustand";
import { confirmExecution, createBasket, getExecutionQuote, prepareBasket, prepareExecution } from "@/services";
import type {
  BasketIntent,
  BasketResponse,
  ExecutionStatus,
  PreparedTransaction,
  QuoteResponse,
  TradeIntent,
} from "@/types";

interface ExecutionState {
  quote?: QuoteResponse;
  prepared?: PreparedTransaction | PreparedTransaction[];
  basket?: BasketResponse;
  status?: ExecutionStatus;
  isLoading: boolean;
  error?: string;
  quoteTrade: (intent: TradeIntent) => Promise<void>;
  prepareTrade: (intent: TradeIntent & { quoteId?: string }) => Promise<void>;
  confirmTrade: (wallet: string, executionId: string, signature: string) => Promise<void>;
  buildBasket: (intent: BasketIntent) => Promise<void>;
  prepareBasketTrades: (intent: BasketIntent & { basketId?: string }) => Promise<void>;
}

export const useExecutionStore = create<ExecutionState>((set) => ({
  isLoading: false,
  async quoteTrade(intent) {
    set({ isLoading: true, error: undefined });
    try {
      const quote = await getExecutionQuote(intent);
      set({ quote, isLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to get quote", isLoading: false });
    }
  },
  async prepareTrade(intent) {
    set({ isLoading: true, error: undefined });
    try {
      const prepared = await prepareExecution(intent);
      set({ prepared, isLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to prepare trade", isLoading: false });
    }
  },
  async confirmTrade(wallet, executionId, signature) {
    set({ isLoading: true, error: undefined });
    try {
      const status = await confirmExecution({ wallet, executionId, signature });
      set({ status, isLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to confirm trade", isLoading: false });
    }
  },
  async buildBasket(intent) {
    set({ isLoading: true, error: undefined });
    try {
      const basket = await createBasket(intent);
      set({ basket, isLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to create basket", isLoading: false });
    }
  },
  async prepareBasketTrades(intent) {
    set({ isLoading: true, error: undefined });
    try {
      const prepared = await prepareBasket(intent);
      set({ prepared, isLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to prepare basket", isLoading: false });
    }
  },
}));
