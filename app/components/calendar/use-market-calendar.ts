"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getMarketDayRecap, getMarketEvents, getUsMarketClosures, getUsMarketHours, getUsMarketSession } from "@/services/market-calendar-service";
import type { MarketDayRecap, MarketEventsResponse, UsEquityClosuresResponse, UsEquityHours, UsEquitySessionResponse } from "@/types";
import { eventsRange } from "./market-layer";

const SESSION_REFRESH_MS = 60_000;

const noSubscription = () => () => undefined;

/**
 * False during server rendering and hydration. The calendar's month, "today"
 * and time zone come from the viewer's clock, so they render after hydration.
 */
export function useHydrated() {
  return useSyncExternalStore(noSubscription, () => true, () => false);
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function message(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Unable to load the US market calendar";
}

interface MonthState {
  key: string;
  closures?: UsEquityClosuresResponse;
  events?: MarketEventsResponse;
  error?: string;
}

/**
 * Public US market data for one month: the year's closures, the month's
 * official releases, and the live session (refreshed each minute). Loading is
 * derived from the request key so no state is set synchronously in effects.
 */
export function useMarketCalendar(month: string, today: string | undefined, enabled = true) {
  const year = Number(month.slice(0, 4));
  const range = eventsRange(month, today);
  const [attempt, setAttempt] = useState(0);
  const key = `${year}:${range.from}:${range.to}:${attempt}`;
  const [state, setState] = useState<MonthState>({ key: "" });
  const [session, setSession] = useState<UsEquitySessionResponse>();

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void Promise.allSettled([
      getUsMarketClosures(year, controller.signal),
      getMarketEvents(range.from, range.to, controller.signal),
    ]).then(([closures, events]) => {
      if (controller.signal.aborted) return;
      const failure = [closures, events].find((result) => result.status === "rejected" && !isAbort(result.reason));
      setState({
        key,
        closures: closures.status === "fulfilled" ? closures.value : undefined,
        events: events.status === "fulfilled" ? events.value : undefined,
        error: failure?.status === "rejected" ? message(failure.reason) : undefined,
      });
    });
    return () => controller.abort();
  }, [enabled, key, range.from, range.to, year]);

  useEffect(() => {
    if (!enabled) return;
    let controller = new AbortController();
    const load = () => {
      controller.abort();
      controller = new AbortController();
      getUsMarketSession(controller.signal).then(setSession, () => undefined);
    };
    load();
    const timer = setInterval(load, SESSION_REFRESH_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [enabled, attempt]);

  const current = state.key === key ? state : undefined;
  return {
    closures: current?.closures,
    events: current?.events,
    error: current?.error,
    isLoading: enabled && !current,
    session,
    retry: () => setAttempt((value) => value + 1),
  };
}

/** Pre-market, regular and after-hours windows for the selected day. */
export function useMarketHours(date: string | undefined, enabled = true) {
  const [hours, setHours] = useState<{ date: string; value?: UsEquityHours; failed?: boolean }>();

  useEffect(() => {
    if (!enabled || !date) return;
    const controller = new AbortController();
    getUsMarketHours(date, controller.signal).then(
      (value) => setHours({ date, value }),
      (error: unknown) => {
        if (!isAbort(error)) setHours({ date, failed: true });
      },
    );
    return () => controller.abort();
  }, [date, enabled]);

  const current = hours?.date === date ? hours : undefined;
  return { hours: current?.value, failed: Boolean(current?.failed), isLoading: enabled && Boolean(date) && !current };
}

/** What happened in US markets on the selected day. */
export function useMarketDayRecap(date: string | undefined, enabled = true) {
  const [recap, setRecap] = useState<{ date: string; value?: MarketDayRecap; failed?: boolean }>();

  useEffect(() => {
    if (!enabled || !date) return;
    const controller = new AbortController();
    getMarketDayRecap(date, controller.signal).then(
      (value) => setRecap({ date, value }),
      (error: unknown) => {
        if (!isAbort(error)) setRecap({ date, failed: true });
      },
    );
    return () => controller.abort();
  }, [date, enabled]);

  const current = recap?.date === date ? recap : undefined;
  return { recap: current?.value, failed: Boolean(current?.failed), isLoading: enabled && Boolean(date) && !current };
}
