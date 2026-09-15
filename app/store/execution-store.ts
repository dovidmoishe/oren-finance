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
  /** Intent used to produce the current quote — enables silent refresh on expiry. */
  lastQuoteIntent?: TradeIntent;
  prepared?: ExecutionPreparedTransaction;
  preparedBasket?: PreparedBasketPurchase;
  basket?: BasketResponse;
  status?: ExecutionStatus;
  isLoading: boolean;
  isRefreshingQuote: boolean;
  error?: string;
  quoteTrade: (intent: TradeIntent) => Promise<QuoteResponse | undefined>;
  refreshQuote: () => Promise<QuoteResponse | undefined>;
  prepareTrade: (request: PrepareExecutionRequest) => Promise<void>;
  confirmTrade: (wallet: string, quoteId: string, signature: string) => Promise<void>;
  buildBasket: (intent: BasketIntent) => Promise<void>;
  prepareBasketTrades: (request: { basketId: string; wallet: string }) => Promise<void>;
  seedQuote: (quote: QuoteResponse, intent?: TradeIntent) => void;
  resetTrade: () => void;
  resetAll: () => void;
}

function intentFromQuote(quote: QuoteResponse): TradeIntent {
  return {
    assetId: quote.assetId,
    ticker: quote.ticker,
    side: quote.side,
    amountUsd: quote.side === "buy" ? quote.amountUsd : undefined,
    amount: quote.side === "sell" ? quote.inputAmount : undefined,
    preferredMint: quote.variant.mint,
    slippageBps: quote.slippageBps,
  };
}

export const useExecutionStore = create<ExecutionState>((set, get) => ({
  isLoading: false,
  isRefreshingQuote: false,
  async quoteTrade(intent) {
    set({ isLoading: true, error: undefined, prepared: undefined, status: undefined });
    try {
      const quote = await getExecutionQuote(intent);
      set({
        quote,
        lastQuoteIntent: intent,
        isLoading: false,
        isRefreshingQuote: false,
      });
      return quote;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Unable to get quote",
        isLoading: false,
        isRefreshingQuote: false,
      });
      return undefined;
    }
  },
  async refreshQuote() {
    const intent = get().lastQuoteIntent;
    if (!intent) return undefined;
    set({ isRefreshingQuote: true, error: undefined });
    try {
      const quote = await getExecutionQuote(intent);
      set({
        quote,
        lastQuoteIntent: intent,
        prepared: undefined,
        status: undefined,
        isRefreshingQuote: false,
        isLoading: false,
      });
      return quote;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Unable to refresh quote",
        isRefreshingQuote: false,
      });
      return undefined;
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
  seedQuote(quote, intent) {
    set({
      quote,
      lastQuoteIntent: intent ?? intentFromQuote(quote),
      prepared: undefined,
      status: undefined,
      error: undefined,
      isLoading: false,
      isRefreshingQuote: false,
    });
  },
  resetTrade() {
    set({
      quote: undefined,
      lastQuoteIntent: undefined,
      prepared: undefined,
      status: undefined,
      error: undefined,
      isLoading: false,
      isRefreshingQuote: false,
    });
  },
  resetAll() {
    set({
      quote: undefined,
      lastQuoteIntent: undefined,
      prepared: undefined,
      preparedBasket: undefined,
      basket: undefined,
      status: undefined,
      error: undefined,
      isLoading: false,
      isRefreshingQuote: false,
    });
  },
}));
