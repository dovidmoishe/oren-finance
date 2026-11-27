import { apiRequest } from "./api-client";
import { createSharedReadCache } from "./shared-read-cache";
import type {
  MarketDayRecap,
  MarketEventsResponse,
  UsEquityClosuresResponse,
  UsEquityHours,
  UsEquitySessionResponse,
} from "@/types";

// Public, read-only routes. Holiday schedules change rarely; release values
// land a few times a week, so events keep a shorter browser cache.
const closuresCache = createSharedReadCache<UsEquityClosuresResponse>({ capacity: 8, ttlMs: 60 * 60_000 });
const hoursCache = createSharedReadCache<UsEquityHours>({ capacity: 64, ttlMs: 60 * 60_000 });
const eventsCache = createSharedReadCache<MarketEventsResponse>({ capacity: 16, ttlMs: 5 * 60_000 });

/** Whether the US cash session is open now, and when it next opens or closes. */
export function getUsMarketSession(signal?: AbortSignal) {
  return apiRequest<UsEquitySessionResponse>("/markets/session", { signal });
}

/** Pre-market, regular and after-hours windows for one New York date. */
export function getUsMarketHours(date: string, signal?: AbortSignal) {
  return hoursCache(date, (shared) => apiRequest<UsEquityHours>("/markets/hours", { query: { date }, signal: shared }), signal);
}

/** Full closes and 1:00 p.m. ET early closes for one year. */
export function getUsMarketClosures(year: number, signal?: AbortSignal) {
  return closuresCache(
    String(year),
    (shared) => apiRequest<UsEquityClosuresResponse>("/markets/closures", { query: { year }, signal: shared }),
    signal,
  );
}

/** Official US macro releases whose New York date falls in [from, to]. */
export function getMarketEvents(from: string, to: string, signal?: AbortSignal) {
  return eventsCache(
    `${from}:${to}`,
    (shared) => apiRequest<MarketEventsResponse>("/calendar/events", { query: { from, to }, signal: shared }),
    signal,
  );
}

const recapCache = createSharedReadCache<MarketDayRecap>({ capacity: 32, ttlMs: 2 * 60_000 });

/** Index moves, biggest movers, releases and same-day headlines for one New York date. */
export function getMarketDayRecap(date: string, signal?: AbortSignal) {
  return recapCache(date, (shared) => apiRequest<MarketDayRecap>(`/calendar/days/${date}`, { signal: shared }), signal);
}
