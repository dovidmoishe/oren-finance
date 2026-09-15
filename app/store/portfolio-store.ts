"use client";

import { create } from "zustand";
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
  activity: PortfolioActivityItem[];
  calendar?: TradingCalendarResponse;
  calendarDay?: TradingCalendarDayResponse;
  isLoading: boolean;
  isCalendarLoading: boolean;
  error?: string;
  loadPortfolio: (wallet: string) => Promise<void>;
  loadHistory: (wallet: string, range?: PortfolioRange) => Promise<void>;
  loadActivity: (wallet: string) => Promise<void>;
  loadCalendar: (wallet: string, input: { month?: string; start?: string; end?: string; timeZone?: string }) => Promise<void>;
  loadCalendarDay: (wallet: string, date: string, input: { timeZone?: string }) => Promise<void>;
  reset: () => void;
}

export const usePortfolioStore = create<PortfolioState>((set) => ({
  history: [],
  activity: [],
  isLoading: false,
  isCalendarLoading: false,
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
  async loadCalendar(wallet, input) {
    set({ wallet, isCalendarLoading: true, error: undefined });
    try {
      const calendar = await getTradingCalendar(wallet, input);
      set({ calendar, isCalendarLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to load trading calendar", isCalendarLoading: false });
    }
  },
  async loadCalendarDay(wallet, date, input) {
    set({ isCalendarLoading: true, error: undefined });
    try {
      const calendarDay = await getTradingCalendarDay(wallet, date, input);
      set({ calendarDay, isCalendarLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to load calendar day", isCalendarLoading: false });
    }
  },
  reset() {
    set({ wallet: undefined, portfolio: undefined, history: [], activity: [], calendar: undefined, calendarDay: undefined, error: undefined, isLoading: false, isCalendarLoading: false });
  },
}));
