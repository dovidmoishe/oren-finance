"use client";

import { create } from "zustand";
import { sessionSetter } from "@/services/wallet-session";
import {
  getPortfolio,
  getPortfolioActivity,
  getPortfolioHistory,
  getTradingCalendar,
  getTradingCalendarDay,
} from "@/services/portfolio-service";
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
  loadPortfolio: (wallet: string, force?: boolean) => Promise<void>;
  loadHistory: (wallet: string, range?: PortfolioRange, force?: boolean) => Promise<void>;
  loadActivity: (wallet: string, force?: boolean) => Promise<void>;
  loadCalendar: (wallet: string, input: { month?: string; start?: string; end?: string; timeZone?: string }) => Promise<void>;
  loadCalendarDay: (wallet: string, date: string, input: { timeZone?: string }) => Promise<void>;
  reset: () => void;
}

let historyRequestId = 0;
let portfolioRequestId = 0;
let activityRequestId = 0;
let calendarRequestId = 0;
let calendarDayRequestId = 0;
let portfolioUpdatedAt = 0;
let portfolioFlight: { wallet: string; promise: Promise<void> } | undefined;
let activityFlight: { wallet: string; promise: Promise<void> } | undefined;
const historyFlights = new Map<string, Promise<PortfolioSnapshot[]>>();

export const usePortfolioStore = create<PortfolioState>((set, get) => ({
  history: [],
  historyCache: {},
  selectedRange: "1W",
  selectRange: (selectedRange) => set({ selectedRange }),
  activity: [],
  isLoading: false,
  isHistoryLoading: false,
  isCalendarLoading: false,
  loadPortfolio(wallet, force = false) {
    if (!force && portfolioFlight?.wallet === wallet) return portfolioFlight.promise;
    if (!force && get().portfolio?.wallet === wallet && Date.now() - portfolioUpdatedAt < 30_000) return Promise.resolve();
    const requestId = ++portfolioRequestId;
    const update = sessionSetter(set);
    update({ wallet, isLoading: true, error: undefined });
    const promise = getPortfolio(wallet).then((portfolio) => {
      if (requestId !== portfolioRequestId) return;
      portfolioUpdatedAt = Date.now();
      update({ portfolio, isLoading: false });
    }).catch((error: unknown) => {
      if (requestId === portfolioRequestId) update({ error: error instanceof Error ? error.message : "Unable to load portfolio", isLoading: false });
    }).finally(() => { if (portfolioFlight?.promise === promise) portfolioFlight = undefined; });
    portfolioFlight = { wallet, promise };
    return promise;
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
      let pending = force ? undefined : historyFlights.get(key);
      if (!pending) {
        const request = getPortfolioHistory(wallet, range).finally(() => {
          if (historyFlights.get(key) === request) historyFlights.delete(key);
        });
        pending = request;
        historyFlights.set(key, request);
      }
      const history = await pending;
      if (requestId !== historyRequestId) return;
      update({ history, isHistoryLoading: false, historyCache: { ...get().historyCache, [key]: { points: history, updatedAt: Date.now() } } });
    } catch (error) {
      if (requestId !== historyRequestId) return;
      update({ historyError: error instanceof Error ? error.message : "Unable to load portfolio history", isHistoryLoading: false });
    }
  },
  loadActivity(wallet, force = false) {
    if (!force && activityFlight?.wallet === wallet) return activityFlight.promise;
    const requestId = ++activityRequestId;
    const update = sessionSetter(set);
    const promise = getPortfolioActivity(wallet).then((activity) => {
      if (requestId === activityRequestId) update({ activity });
    }).catch((error: unknown) => {
      if (requestId === activityRequestId) update({ error: error instanceof Error ? error.message : "Unable to load portfolio activity" });
    }).finally(() => { if (activityFlight?.promise === promise) activityFlight = undefined; });
    activityFlight = { wallet, promise };
    return promise;
  },
  async loadCalendar(wallet, input) {
    const requestId = ++calendarRequestId;
    const update = sessionSetter(set);
    update({ wallet, isCalendarLoading: true, error: undefined });
    try {
      const calendar = await getTradingCalendar(wallet, input);
      if (requestId !== calendarRequestId) return;
      update({ calendar, isCalendarLoading: false });
    } catch (error) {
      if (requestId !== calendarRequestId) return;
      update({ error: error instanceof Error ? error.message : "Unable to load trading calendar", isCalendarLoading: false });
    }
  },
  async loadCalendarDay(wallet, date, input) {
    const requestId = ++calendarDayRequestId;
    const update = sessionSetter(set);
    update({ isCalendarLoading: true, error: undefined });
    try {
      const calendarDay = await getTradingCalendarDay(wallet, date, input);
      if (requestId !== calendarDayRequestId) return;
      update({ calendarDay, isCalendarLoading: false });
    } catch (error) {
      if (requestId !== calendarDayRequestId) return;
      update({ error: error instanceof Error ? error.message : "Unable to load calendar day", isCalendarLoading: false });
    }
  },
  reset() {
    portfolioRequestId++;
    activityRequestId++;
    calendarRequestId++;
    calendarDayRequestId++;
    portfolioUpdatedAt = 0;
    portfolioFlight = activityFlight = undefined;
    historyFlights.clear();
    historyRequestId += 1;
    set({ wallet: undefined, portfolio: undefined, history: [], historyKey: undefined, historyCache: {}, selectedRange: "1W", activity: [], calendar: undefined, calendarDay: undefined, error: undefined, historyError: undefined, isLoading: false, isHistoryLoading: false, isCalendarLoading: false });
  },
}));
