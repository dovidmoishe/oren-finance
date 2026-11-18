"use client";

import { create } from "zustand";
import { sessionSetter } from "@/services/wallet-session";
import {
  getPortfolio,
  getPortfolioActivity,
  getPortfolioHistory,
  getTradingCalendar,
  getTradingCalendarDay,
} from "@/services";
import type {
  PortfolioActivityItem,
  PortfolioRange,
  PortfolioSnapshot,
  PortfolioSummary,
  TradingCalendarDayResponse,
  TradingCalendarResponse,
} from "@/types";

interface PortfolioState {
  wallet?: string;
  portfolio?: PortfolioSummary;
  history: PortfolioSnapshot[];
  historyKey?: string;
  historyCache: Record<string, { points: PortfolioSnapshot[]; updatedAt: number }>;
  selectedRange: PortfolioRange;
  selectRange: (range: PortfolioRange) => void;
  activity: PortfolioActivityItem[];
  calendar?: TradingCalendarResponse;
  calendarDay?: TradingCalendarDayResponse;
  isLoading: boolean;
  isHistoryLoading: boolean;
  isCalendarLoading: boolean;
  error?: string;
  historyError?: string;
  loadPortfolio: (wallet: string) => Promise<void>;
  loadHistory: (wallet: string, range?: PortfolioRange, force?: boolean) => Promise<void>;
  loadActivity: (wallet: string) => Promise<void>;
  loadCalendar: (wallet: string, input: { month?: string; start?: string; end?: string; timeZone?: string }) => Promise<void>;
  loadCalendarDay: (wallet: string, date: string, input: { timeZone?: string }) => Promise<void>;
  reset: () => void;
}

let historyRequestId = 0;

export const usePortfolioStore = create<PortfolioState>((set, get) => ({
  history: [],
  historyCache: {},
  selectedRange: "1W",
  selectRange: (selectedRange) => set({ selectedRange }),
  activity: [],
  isLoading: false,
  isHistoryLoading: false,
  isCalendarLoading: false,
  async loadPortfolio(wallet) {
    const update = sessionSetter(set);
    update({ wallet, isLoading: true, error: undefined });
    try {
      const portfolio = await getPortfolio(wallet);
      update({ portfolio, isLoading: false });
    } catch (error) {
      update({ error: error instanceof Error ? error.message : "Unable to load portfolio", isLoading: false });
    }
  },
  async loadHistory(wallet, range = "1W", force = true) {
    const key = `${wallet}:${range}`;
    const cached = get().historyCache[key];
    // A fresh navigation reuses data; explicit refreshes and completed trades still fetch.
    if (!force && cached && Date.now() - cached.updatedAt < 30_000) {
      historyRequestId += 1;
      set({ history: cached.points, historyKey: key, isHistoryLoading: false, historyError: undefined });
      return;
    }
    const requestId = ++historyRequestId;
    const update = sessionSetter(set);
    update({ history: cached?.points ?? [], historyKey: key, isHistoryLoading: !cached, historyError: undefined });
    try {
      const history = await getPortfolioHistory(wallet, range);
      if (requestId !== historyRequestId) return;
      update({ history, isHistoryLoading: false, historyCache: { ...get().historyCache, [key]: { points: history, updatedAt: Date.now() } } });
    } catch (error) {
      if (requestId !== historyRequestId) return;
      update({ historyError: error instanceof Error ? error.message : "Unable to load portfolio history", isHistoryLoading: false });
    }
  },
  async loadActivity(wallet) {
    const update = sessionSetter(set);
    try {
      const activity = await getPortfolioActivity(wallet);
      update({ activity });
    } catch (error) {
      update({ error: error instanceof Error ? error.message : "Unable to load portfolio activity" });
    }
  },
  async loadCalendar(wallet, input) {
    const update = sessionSetter(set);
    update({ wallet, isCalendarLoading: true, error: undefined });
    try {
      const calendar = await getTradingCalendar(wallet, input);
      update({ calendar, isCalendarLoading: false });
    } catch (error) {
      update({ error: error instanceof Error ? error.message : "Unable to load trading calendar", isCalendarLoading: false });
    }
  },
  async loadCalendarDay(wallet, date, input) {
    const update = sessionSetter(set);
    update({ isCalendarLoading: true, error: undefined });
    try {
      const calendarDay = await getTradingCalendarDay(wallet, date, input);
      update({ calendarDay, isCalendarLoading: false });
    } catch (error) {
      update({ error: error instanceof Error ? error.message : "Unable to load calendar day", isCalendarLoading: false });
    }
  },
  reset() {
    historyRequestId += 1;
    set({ wallet: undefined, portfolio: undefined, history: [], historyKey: undefined, historyCache: {}, selectedRange: "1W", activity: [], calendar: undefined, calendarDay: undefined, error: undefined, historyError: undefined, isLoading: false, isHistoryLoading: false, isCalendarLoading: false });
  },
}));
