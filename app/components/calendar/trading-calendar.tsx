"use client";

import { ChevronLeft as ChevronLeftIcon, ChevronRight as ChevronRightIcon } from "lucide-react";

import { useEffect, useMemo, useState } from "react";
import { useOrenAuth } from "@/components/auth/auth-context";
import { RestoreActions, restoreBlocked } from "@/components/auth/restore-actions";
import { Button, Card, ErrorState, Skeleton, cn, formatMonth } from "@/components/ui";
import { useAgentStore, usePortfolioStore, useWalletStore } from "@/store";
import type { UsEquitySessionResponse } from "@/types";
import { useI18n } from "@/i18n/i18n";
import { DayPanel, MarketSources } from "./day-panel";
import { DayRecap } from "./day-recap";
import { ReleaseReminderButton } from "./release-reminder";
import {
  CALENDAR_LAYERS,
  NEW_YORK,
  addDays,
  calendarTimeZone,
  civilDate,
  eventsByDate,
  formatShortClock,
  formatWeekdayClock,
  marketDays,
  monthDates,
  progressBetween,
  type CalendarLayer,
} from "./market-layer";
import { MonthGrid } from "./month-grid";
import { useHydrated, useMarketCalendar, useMarketDayRecap, useMarketHours } from "./use-market-calendar";

function browserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

const DATE_PARAM = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * `?date=YYYY-MM-DD&layer=market` deep links, read once on the client. The
 * server render never depends on them: everything date-shaped waits for
 * hydration.
 */
function linkedState() {
  if (typeof window === "undefined" || !window.location?.search) return {};
  const params = new URLSearchParams(window.location.search);
  const date = params.get("date") ?? undefined;
  const layer = params.get("layer");
  return {
    date: date && DATE_PARAM.test(date) ? date : undefined,
    layer: CALENDAR_LAYERS.includes(layer as CalendarLayer) ? (layer as CalendarLayer) : undefined,
  };
}

/** Typing in Copilot or any field must never move the calendar. */
function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

function shiftMonth(month: string, delta: number) {
  const [year, monthIndex] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthIndex - 1 + delta, 1)).toISOString().slice(0, 7);
}

function LayerToggle({ value, onChange }: { value: CalendarLayer; onChange: (layer: CalendarLayer) => void }) {
  const { t } = useI18n();
  const labels: Record<CalendarLayer, string> = {
    all: t("calendar.layerAll"),
    portfolio: t("calendar.layerPortfolio"),
    market: t("calendar.layerMarket"),
  };
  return (
    <div aria-label={t("calendar.layers")} className="inline-flex rounded-full bg-panel-subtle p-0.5 text-xs" role="group">
      {CALENDAR_LAYERS.map((layer) => (
        <button
          aria-pressed={layer === value}
          className={cn(
            "h-7 rounded-full px-3 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus",
            layer === value ? "bg-panel text-foreground shadow-sm" : "text-muted hover:text-foreground",
          )}
          key={layer}
          onClick={() => onChange(layer)}
          type="button"
        >
          {labels[layer]}
        </button>
      ))}
    </div>
  );
}

/** Live US session: a lavender pulse while the regular session is open. */
function MarketPill({ session }: { session?: UsEquitySessionResponse }) {
  const { locale, t } = useI18n();
  if (!session) return <span aria-hidden className="h-7 w-36 animate-pulse rounded-full bg-panel-subtle" />;
  const next = session.isOpen
    ? t("calendar.market.closesAt", { time: formatShortClock(session.nextRegularClose, locale, NEW_YORK) })
    : t("calendar.market.opensAt", {
        time:
          civilDate(NEW_YORK, new Date(session.nextRegularOpen)) === session.date
            ? formatShortClock(session.nextRegularOpen, locale, NEW_YORK)
            : formatWeekdayClock(session.nextRegularOpen, locale, NEW_YORK),
      });
  const state = t(`calendar.market.state.${session.state}`);
  return (
    <span aria-label={`${t("calendar.market.title")}: ${state}, ${next}`} className="inline-flex h-7 items-center gap-2 rounded-full bg-panel-subtle px-3 text-xs" role="status">
      <span aria-hidden className="relative flex size-2">
        {session.isOpen ? <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60 motion-reduce:hidden" /> : null}
        <span className={cn("relative inline-flex size-2 rounded-full", session.isOpen ? "bg-brand" : "bg-muted-2")} />
      </span>
      <span aria-hidden className="font-medium">{state}</span>
      <span aria-hidden className="text-muted">{next}</span>
    </span>
  );
}

export function TradingCalendar() {
  const auth = useOrenAuth();
  const { locale, t } = useI18n();
  const hydrated = useHydrated();
  const wallet = useWalletStore((state) => state.address);
  const connected = useWalletStore((state) => state.connected);
  const calendar = usePortfolioStore((state) => state.calendar);
  const calendarDay = usePortfolioStore((state) => state.calendarDay);
  const error = usePortfolioStore((state) => state.error);
  const loadCalendar = usePortfolioStore((state) => state.loadCalendar);
  const loadCalendarDay = usePortfolioStore((state) => state.loadCalendarDay);
  const reset = usePortfolioStore((state) => state.reset);
  const viewerTimeZone = useMemo(() => browserTimeZone(), []);
  const [linked] = useState(linkedState);
  const [chosenMonth, setMonth] = useState(linked.date?.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState<string | undefined>(linked.date);
  const [layerChoice, setLayerChoice] = useState<CalendarLayer>(linked.layer ?? "all");
  const agentBusy = useAgentStore((state) => state.isSending);
  const setAgentOpen = useAgentStore((state) => state.setPanelOpen);
  const newChat = useAgentStore((state) => state.newChat);
  const sendToAgent = useAgentStore((state) => state.sendMessage);

  // Signed out, only the public market layer has data to show.
  const layer: CalendarLayer = connected ? layerChoice : "market";
  const timeZone = calendarTimeZone(layer, viewerTimeZone);
  const currentDate = civilDate(timeZone);
  const today = hydrated ? currentDate : undefined;
  const month = chosenMonth ?? currentDate.slice(0, 7);
  const showPortfolio = layer !== "market";
  const showMarket = layer !== "portfolio";
  const activeDate = selectedDate ?? (today?.startsWith(month) ? today : undefined);

  const market = useMarketCalendar(month, today, hydrated && showMarket);
  const { hours } = useMarketHours(activeDate, hydrated && showMarket);
  const dayRecap = useMarketDayRecap(activeDate, hydrated && showMarket);

  // Keep the address bar shareable without adding history entries.
  useEffect(() => {
    if (!hydrated) return;
    const url = new URL(window.location.href);
    if (selectedDate) url.searchParams.set("date", selectedDate);
    else url.searchParams.delete("date");
    if (layerChoice !== "all") url.searchParams.set("layer", layerChoice);
    else url.searchParams.delete("layer");
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [hydrated, layerChoice, selectedDate]);

  useEffect(() => {
    if (!wallet || !connected) {
      reset();
      return;
    }
    if (showPortfolio) void loadCalendar(wallet, { month, timeZone });
  }, [connected, loadCalendar, month, reset, showPortfolio, timeZone, wallet]);

  useEffect(() => {
    if (!wallet || !connected || !showPortfolio || !activeDate) return;
    void loadCalendarDay(wallet, activeDate, { timeZone });
  }, [activeDate, connected, loadCalendarDay, showPortfolio, timeZone, wallet]);

  const dates = useMemo(() => monthDates(month), [month]);
  const portfolioDays = useMemo(
    () => {
      const matches = showPortfolio && calendar && calendar.walletAddress === wallet && calendar.timeZone === timeZone && calendar.range.month === month;
      return new Map(matches ? calendar.days.map((day) => [day.date, day] as const) : []);
    },
    [calendar, month, showPortfolio, timeZone, wallet],
  );
  const marketByDate = useMemo(
    () => (showMarket ? marketDays(dates, market.closures?.closures, market.closures?.provisional) : undefined),
    [dates, market.closures, showMarket],
  );
  const releases = useMemo(() => eventsByDate(showMarket ? market.events?.events : undefined), [market.events, showMarket]);
  const maxMove = useMemo(() => Math.max(...[...portfolioDays.values()].map((day) => Math.abs(day.pnlUsd)), 1), [portfolioDays]);
  const monthPnl = useMemo(() => [...portfolioDays.values()].reduce((sum, day) => sum + day.pnlUsd, 0), [portfolioDays]);
  const hasMonthPnl = [...portfolioDays.values()].some((day) => day.hasData);

  // The session refreshes each minute; its observation time drives the progress marks.
  const now = market.session ? Date.parse(market.session.observedAt) : undefined;
  const todayHours = market.session?.hours;
  const todayProgress =
    now !== undefined && todayHours?.regularOpenUtc && todayHours.regularCloseUtc && market.session?.date === today
      ? progressBetween(now, todayHours.regularOpenUtc, todayHours.regularCloseUtc)
      : undefined;

  const changeMonth = (delta: number) => {
    setSelectedDate(undefined);
    setMonth((value) => shiftMonth(value ?? month, delta));
  };
  const selectDate = (date: string) => {
    setSelectedDate(date);
    setMonth(date.slice(0, 7));
  };
  const goToday = () => {
    if (today) selectDate(today);
  };
  /** Arrow keys walk days and weeks, crossing into the next or previous month. */
  const moveSelection = (days: number) => selectDate(addDays(activeDate ?? `${month}-01`, days));

  // T jumps to today, [ and ] change month.
  useEffect(() => {
    if (!hydrated) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (event.key === "t" || event.key === "T") {
        const now = civilDate(timeZone);
        setSelectedDate(now);
        setMonth(now.slice(0, 7));
      } else if (event.key === "[" || event.key === "]") {
        setSelectedDate(undefined);
        setMonth((value) => shiftMonth(value ?? month, event.key === "]" ? 1 : -1));
      } else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hydrated, month, timeZone]);

  const canAsk = connected && auth.authenticated && Boolean(auth.address);
  const askAboutDay = (date: string) => {
    if (!auth.address || agentBusy) return;
    const spoken = new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${date}T00:00:00Z`),
    );
    newChat(auth.address);
    setAgentOpen(true);
    void sendToAgent(t(showPortfolio ? "calendar.day.askPrompt" : "calendar.day.askMarketPrompt", { date: spoken, isoDate: date }), auth.address, {
      page: "calendar",
    });
  };

  const signedCompact = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1, signDisplay: "exceptZero" });

  return (
    <div className="space-y-6">
      <h1 className="sr-only">{t("calendar.title")}</h1>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 className="font-display text-3xl font-medium tracking-tight">
            {hydrated ? formatMonth(month, locale) : <span className="inline-block h-8 w-48 animate-pulse rounded-full bg-panel-subtle align-middle" />}
          </h2>
          {showPortfolio && hasMonthPnl ? (
            <span className={cn("font-money text-sm font-medium tabular-nums", monthPnl > 0 ? "text-positive" : monthPnl < 0 ? "text-negative" : "text-muted")}>
              {t("calendar.thisMonth", { value: signedCompact.format(monthPnl) })}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showMarket && hydrated ? <MarketPill session={market.session} /> : null}
          {connected ? <LayerToggle onChange={setLayerChoice} value={layerChoice} /> : null}
          <div className="flex items-center">
            <Button aria-keyshortcuts="T" className="rounded-full" disabled={!today || activeDate === today} onClick={goToday} size="sm" title={`${t("calendar.today")} (T)`} variant="ghost">
              {t("calendar.today")}
            </Button>
            <Button aria-keyshortcuts="[" aria-label={t("calendar.previousMonth")} className="rounded-full" onClick={() => changeMonth(-1)} size="icon" title={`${t("calendar.previousMonth")} ([)`} variant="ghost">
              <ChevronLeftIcon color="currentColor" size={18} strokeWidth={1.8} />
            </Button>
            <Button aria-keyshortcuts="]" aria-label={t("calendar.nextMonth")} className="rounded-full" onClick={() => changeMonth(1)} size="icon" title={`${t("calendar.nextMonth")} (])`} variant="ghost">
              <ChevronRightIcon color="currentColor" size={18} strokeWidth={1.8} />
            </Button>
          </div>
        </div>
      </div>

      {!connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] bg-panel-subtle py-2 pl-4 pr-2 text-sm">
          <p className="min-w-0 text-muted">
            {restoreBlocked(auth) ? t("auth.restoreSlow") : !auth.ready ? t("calendar.restoring") : auth.authenticated ? t("calendar.preparing") : t("calendar.signInPrompt")}
          </p>
          {restoreBlocked(auth) ? (
            <RestoreActions signInLabel={t("common.signIn")} size="sm" />
          ) : auth.ready && !auth.authenticated ? (
            <Button onClick={auth.open} size="sm" type="button">
              {t("common.signIn")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {connected && showPortfolio && error ? <ErrorState description={error} onRetry={() => wallet && loadCalendar(wallet, { month, timeZone })} /> : null}
      {showMarket && market.error ? <ErrorState description={t("calendar.market.loadFailed")} onRetry={market.retry} /> : null}

      {!hydrated ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-[540px]" />
          <Skeleton className="h-[420px]" />
        </div>
      ) : (
        // Phones read grid, day, market; wide screens put the market under the grid.
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <MonthGrid
            activeDate={activeDate}
            dates={dates}
            marketDays={marketByDate}
            maxMove={maxMove}
            onMove={moveSelection}
            onSelect={setSelectedDate}
            portfolioDays={portfolioDays}
            releases={releases}
            today={today}
            todayProgress={todayProgress}
          />
          <Card className="p-5 xl:sticky xl:top-6 xl:col-start-2 xl:row-span-2 xl:row-start-1">
            {activeDate ? (
              <DayPanel
                askBusy={agentBusy}
                date={activeDate}
                day={calendarDay?.date === activeDate && calendarDay.walletAddress === wallet && calendarDay.timeZone === timeZone ? calendarDay : undefined}
                hours={hours}
                marketDay={marketByDate?.get(activeDate)}
                now={now}
                onAsk={canAsk ? () => askAboutDay(activeDate) : undefined}
                releases={releases.get(activeDate) ?? []}
                releasesUnavailable={market.events ? !market.events.available : false}
                reminder={(event) => <ReleaseReminderButton event={event} />}
                showMarket={showMarket}
                showPortfolio={showPortfolio}
                summary={portfolioDays.get(activeDate)}
                timeZone={viewerTimeZone}
              />
            ) : (
              <p className="py-10 text-center text-sm text-muted">{t("calendar.selectDay")}</p>
            )}
          </Card>
          {showMarket && activeDate ? (
            <div className="min-w-0 xl:col-start-1 xl:row-start-2">
              <DayRecap date={activeDate} failed={dayRecap.failed} loading={dayRecap.isLoading} recap={dayRecap.recap} />
            </div>
          ) : null}
        </div>
      )}

      {showMarket ? <MarketSources response={market.events} /> : null}
    </div>
  );
}
