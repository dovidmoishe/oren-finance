import type { MarketCandle } from "@/types";
import { getStockCharts } from "./market-service";
import { createSharedReadCache } from "./shared-read-cache";

/** Per-id display cache with frame batching and at most four HTTP requests. */
export function createSparklineReader(
  load = getStockCharts,
  schedule: (flush: () => void) => void = (flush) => { requestAnimationFrame(flush); },
) {
  type Entry = {
    id: string;
    signal: AbortSignal;
    resolve: (candles: MarketCandle[]) => void;
    reject: (error: unknown) => void;
  };
  // Allow all visible ids to reach the frame collector. The transport queue
  // below limits HTTP concurrency; per-id TTL, capacity and consumers stay shared.
  const read = createSharedReadCache<MarketCandle[]>({ concurrency: 128 });
  const waiting = new Set<Entry>();
  const batches: Entry[][] = [];
  let scheduled = false;
  let active = 0;
  const abortError = () => new DOMException("Read cancelled", "AbortError");

  function pump() {
    while (active < 4 && batches.length) {
      const entries = batches.shift()!.filter((entry) => !entry.signal.aborted);
      if (!entries.length) continue;
      const controller = new AbortController();
      const cancel = () => {
        if (entries.every((entry) => entry.signal.aborted)) controller.abort();
      };
      for (const entry of entries) entry.signal.addEventListener("abort", cancel, { once: true });
      active++;
      void Promise.resolve().then(() => load(entries.map((entry) => entry.id), "1D", controller.signal)).then(
        (series) => {
          for (const entry of entries) {
            const candles = series?.[entry.id]?.candles;
            if (candles) entry.resolve(candles);
            else entry.reject(new Error("Chart unavailable"));
          }
        },
        (error: unknown) => { for (const entry of entries) entry.reject(error); },
      ).finally(() => {
        for (const entry of entries) entry.signal.removeEventListener("abort", cancel);
        active--;
        pump();
      });
    }
  }

  function flush() {
    scheduled = false;
    const entries = [...waiting];
    waiting.clear();
    for (let index = 0; index < entries.length; index += 20) batches.push(entries.slice(index, index + 20));
    pump();
  }

  async function enqueue(id: string, signal: AbortSignal): Promise<MarketCandle[]> {
    let entry: Entry;
    const abort = () => {
      waiting.delete(entry);
      entry.reject(abortError());
    };
    try {
      return await new Promise<MarketCandle[]>((resolve, reject) => {
        entry = { id, signal, resolve, reject };
        if (signal.aborted) { reject(abortError()); return; }
        signal.addEventListener("abort", abort, { once: true });
        waiting.add(entry);
        if (!scheduled) { scheduled = true; schedule(flush); }
      });
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  return (assetId: string, signal?: AbortSignal) => read(assetId, (sharedSignal) => enqueue(assetId, sharedSignal), signal);
}
