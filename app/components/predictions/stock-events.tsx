"use client";
import { useEffect, useMemo } from "react";
import {
  predictionSearchKey,
  usePredictionsStore,
} from "@/store/predictions-store";
import { PredictionCard, PoweredByPanta } from "./prediction-cards";
export function StockEvents({ assetId }: { assetId: string }) {
  const input = useMemo(() => ({ assetIds: [assetId], limit: 50 }), [assetId]);
  const key = predictionSearchKey(input);
  const entry = usePredictionsStore((s) => s.searches[key]),
    search = usePredictionsStore((s) => s.search);
  useEffect(() => {
    const abort = new AbortController();
    void search(input, abort.signal);
    return () => abort.abort();
  }, [input, search]);
  const items =
    entry?.data?.items
      .filter((m) => m.stockLinks.some((s) => s.assetId === assetId))
      .slice(0, 3) ?? [];
  const status = entry?.error
    ? "Related events are temporarily unavailable."
    : !entry || entry.loading
      ? "Finding related events…"
      : items.length
        ? ""
        : entry.data?.coverage.complete
          ? "No directly matched events in the scanned catalog."
          : "No direct matches found; catalog coverage is partial.";
  return (
    <section className="space-y-3">
      <h2 className="font-display text-xl font-semibold">
        Related prediction events
      </h2>
      <PoweredByPanta />
      {status ? <p className="text-sm text-muted">{status}</p> : null}
      <div className="grid gap-4 md:grid-cols-3">
        {items.map((m) => (
          <PredictionCard key={m.marketId} market={m} />
        ))}
      </div>
    </section>
  );
}
