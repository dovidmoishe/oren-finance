import { apiRequest } from "./api-client";
import type {
  PredictionMarket,
  PredictionResults,
  PredictionSearch,
} from "@/types/predictions";

export function searchPredictions(
  input: PredictionSearch = {},
  signal?: AbortSignal,
) {
  return apiRequest<PredictionResults>("/predictions/markets", {
    signal,
    query: { ...input, assetIds: input.assetIds?.join(",") },
  });
}
export function getPrediction(id: string, signal?: AbortSignal) {
  return apiRequest<PredictionMarket>(
    `/predictions/markets/${encodeURIComponent(id)}`,
    { signal },
  );
}
