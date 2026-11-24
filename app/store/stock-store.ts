"use client";

import { create } from "zustand";
import { getStock, getStockAnalysis, getStockChart, getStockNews } from "@/services/market-service";
import type { ChartInterval, ChartRange, MarketCandle, NewsItem, StockAnalysis, StockDetail } from "@/types";

interface StockState {
  requestedAssetId?: string;
  selected?: StockDetail;
  chart: MarketCandle[];
  analysis?: StockAnalysis;
  news: NewsItem[];
  isLoading: boolean;
  isChartLoading: boolean;
  isAnalysisLoading: boolean;
  isNewsLoading: boolean;
  error?: string;
  chartError?: string;
  loadStock: (assetId: string, range?: ChartRange, interval?: ChartInterval) => Promise<void>;
  loadChart: (assetId: string, range: ChartRange, interval?: ChartInterval) => Promise<void>;
  reset: () => void;
}

let stockRequestId = 0;
let chartRequestId = 0;
let detailController: AbortController | undefined;
let chartController: AbortController | undefined;

export const useStockStore = create<StockState>((set) => ({
  chart: [],
  news: [],
  isLoading: false,
  isChartLoading: false,
  isAnalysisLoading: false,
  isNewsLoading: false,
  async loadStock(assetId, range = "1M", interval) {
    const requestId = ++stockRequestId;
    const chartId = ++chartRequestId;
    detailController?.abort();
    chartController?.abort();
    const detail = detailController = new AbortController();
    const chart = chartController = new AbortController();
    set({
      requestedAssetId: assetId,
      selected: undefined,
      chart: [],
      analysis: undefined,
      news: [],
      isLoading: true,
      isChartLoading: true,
      isAnalysisLoading: true,
      isNewsLoading: true,
      error: undefined,
      chartError: undefined,
    });
    const current = () => requestId === stockRequestId;
    await Promise.all([
      getStock(assetId, detail.signal).then(
        (selected) => { if (current()) set({ selected, isLoading: false }); },
        (error: unknown) => { if (current()) set({ error: error instanceof Error ? error.message : "Unable to load stock", isLoading: false }); },
      ),
      (interval ? getStockChart(assetId, range, chart.signal, interval) : getStockChart(assetId, range, chart.signal)).then(
        (chart) => { if (current() && chartId === chartRequestId) set({ chart, isChartLoading: false }); },
        (error: unknown) => { if (current() && chartId === chartRequestId) set({ chartError: error instanceof Error ? error.message : "Unable to load chart", isChartLoading: false }); },
      ),
      getStockAnalysis(assetId, detail.signal).then(
        (analysis) => { if (current()) set({ analysis, isAnalysisLoading: false }); },
        () => { if (current()) set({ isAnalysisLoading: false }); },
      ),
      getStockNews(assetId, detail.signal).then(
        (news) => { if (current()) set({ news, isNewsLoading: false }); },
        () => { if (current()) set({ isNewsLoading: false }); },
      ),
    ]);
  },
  async loadChart(assetId, range, interval) {
    const requestId = ++chartRequestId;
    chartController?.abort();
    const controller = chartController = new AbortController();
    set({ isChartLoading: true, chartError: undefined });
    try {
      const chart = await (interval ? getStockChart(assetId, range, controller.signal, interval) : getStockChart(assetId, range, controller.signal));
      if (requestId !== chartRequestId) return;
      set({ chart, isChartLoading: false, chartError: undefined });
    } catch (error) {
      if (requestId !== chartRequestId) return;
      set({
        chart: [],
        isChartLoading: false,
        chartError: error instanceof Error ? error.message : "Unable to load chart",
      });
    }
  },
  reset() {
    detailController?.abort();
    chartController?.abort();
    stockRequestId += 1;
    chartRequestId += 1;
    set({
      requestedAssetId: undefined,
      selected: undefined,
      chart: [],
      analysis: undefined,
      news: [],
      isLoading: false,
      isChartLoading: false,
      isAnalysisLoading: false,
      isNewsLoading: false,
      error: undefined,
      chartError: undefined,
    });
  },
}));
