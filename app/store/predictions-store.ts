"use client";
import { create } from "zustand";
import {
  getPrediction,
  searchPredictions,
} from "@/services/predictions-service";
import type {
  PredictionMarket,
  PredictionResults,
  PredictionSearch,
} from "@/types/predictions";

interface Entry<T> {
  data?: T;
  error?: string;
  loading: boolean;
}
interface PredictionsState {
  searches: Record<string, Entry<PredictionResults>>;
  details: Record<string, Entry<PredictionMarket>>;
  search: (input: PredictionSearch, signal: AbortSignal) => Promise<void>;
  detail: (id: string, signal: AbortSignal) => Promise<void>;
}
function bounded<T>(
  rows: Record<string, T>,
  key: string,
  value: T,
): Record<string, T> {
  const next = { ...rows, [key]: value };
  const keys = Object.keys(next);
  if (keys.length > 100) delete next[keys[0]];
  return next;
}
export const predictionSearchKey = (input: PredictionSearch) =>
  JSON.stringify(input);
export const usePredictionsStore = create<PredictionsState>((set) => ({
  searches: {},
  details: {},
  async search(input, signal) {
    const key = predictionSearchKey(input);
    set((s) => ({ searches: bounded(s.searches, key, { loading: true }) }));
    try {
      const data = await searchPredictions(input, signal);
      if (!signal.aborted)
        set((s) => ({
          searches: bounded(s.searches, key, { data, loading: false }),
        }));
    } catch (error) {
      if (!signal.aborted)
        set((s) => ({
          searches: bounded(s.searches, key, {
            error:
              error instanceof Error ? error.message : "Discovery unavailable",
            loading: false,
          }),
        }));
    }
  },
  async detail(id, signal) {
    set((s) => ({ details: bounded(s.details, id, { loading: true }) }));
    try {
      const data = await getPrediction(id, signal);
      if (!signal.aborted)
        set((s) => ({
          details: bounded(s.details, id, { data, loading: false }),
        }));
    } catch (error) {
      if (!signal.aborted)
        set((s) => ({
          details: bounded(s.details, id, {
            error:
              error instanceof Error ? error.message : "Detail unavailable",
            loading: false,
          }),
        }));
    }
  },
}));
