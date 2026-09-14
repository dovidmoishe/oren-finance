"use client";

import { create } from "zustand";
import { confirmExecution, createBasket, getExecutionQuote, prepareBasket, prepareExecution } from "@/services";
import type {
  BasketIntent,
  BasketResponse,
  ExecutionStatus,
  ExecutionPreparedTransaction,
  PreparedBasketPurchase,
  PrepareExecutionRequest,
  QuoteResponse,
  TradeIntent,
} from "@/types";

interface ExecutionState {
  quote?: QuoteResponse;
  prepared?: ExecutionPreparedTransaction;
  preparedBasket?: PreparedBasketPurchase;
  basket?: BasketResponse;
  status?: ExecutionStatus;
  isLoading: boolean;
  error?: string;
  quoteTrade: (intent: TradeIntent) => Promise<void>;
  prepareTrade: (request: PrepareExecutionRequest) => Promise<void>;
  confirmTrade: (wallet: string, quoteId: string, signature: string) => Promise<void>;
  buildBasket: (intent: BasketIntent) => Promise<void>;
  prepareBasketTrades: (request: { basketId: string; wallet: string }) => Promise<void>;
  resetTrade: () => void;
  resetAll: () => void;
}

export const useExecutionStore = create<ExecutionState>((set) => ({
  isLoading: false,
  async quoteTrade(intent) {
    set({ isLoading: true, error: undefined, prepared: undefined, status: undefined });
    try {
      const quote = await getExecutionQuote(intent);
      set({ quote, isLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to get quote", isLoading: false });
    }
  },
  async prepareTrade(request) {
    set({ isLoading: true, error: undefined });
    try {
      const prepared = await prepareExecution(request);
      set({ prepared, isLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to prepare trade", isLoading: false });
    }
  },
  async confirmTrade(wallet, quoteId, signature) {
    set({ isLoading: true, error: undefined });
    try {
      const status = await confirmExecution({ wallet, quoteId, signature });
      set({ status, isLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to confirm trade", isLoading: false });
    }
  },
  async buildBasket(intent) {
    set({ isLoading: true, error: undefined, preparedBasket: undefined });
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
      const preparedBasket = await prepareBasket(intent);
      set({ preparedBasket, isLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to prepare basket", isLoading: false });
    }
  },
  resetTrade() {
    set({ quote: undefined, prepared: undefined, status: undefined, error: undefined, isLoading: false });
  },
  resetAll() {
    set({
      quote: undefined,
      prepared: undefined,
      preparedBasket: undefined,
      basket: undefined,
      status: undefined,
      error: undefined,
      isLoading: false,
    });
  },
}));
