"use client";

import { ArrowLeft01Icon, ArrowRight01Icon, RefreshCwIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  cn,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  formatRelativeTime,
} from "@/components/ui";
import { usePortfolioStore, useWalletStore } from "@/store";
import type { TradingCalendarDaySummary, TradingCalendarEvent } from "@/types";

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00Z`));
}

function shiftMonth(month: string, delta: number) {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthIndex - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

function browserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function dayNumber(date: string) {
  return Number(date.slice(-2));
}

function eventTone(type: TradingCalendarEvent["type"]) {
  if (type === "movement") return "bg-foreground";
  if (type === "agent") return "bg-accent-lavender";
  if (type === "lock" || type === "unlock") return "bg-accent-pink";
  return "bg-accent-yellow";
}

function dayClass(day: TradingCalendarDaySummary, maxMove: number) {
  if (!day.hasData) return "bg-panel-subtle text-muted";
  const intensity = Math.min(1, Math.abs(day.pnlUsd) / Math.max(maxMove, 1));
  if (day.pnlUsd > 0) {
    return intensity > 0.66 ? "bg-positive text-white" : intensity > 0.33 ? "bg-[#b9f3d4]" : "bg-[#e0f8eb]";
  }
  if (day.pnlUsd < 0) {
    return intensity > 0.66 ? "bg-negative text-white" : intensity > 0.33 ? "bg-[#ffc3c7]" : "bg-[#ffe4e6]";
  }
  return "bg-panel text-foreground";
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <section className="rounded-[20px] bg-panel-subtle p-4">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold tracking-normal">{value}</p>
      <p className="mt-1 text-xs text-muted">{detail}</p>
    </section>
  );
}

function EventRow({ event }: { event: TradingCalendarEvent }) {
  return (
    <div className="flex items-start gap-3 rounded-[16px] border border-border bg-background p-3">
      <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", eventTone(event.type))} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">{event.title}</p>
          <p className="text-xs text-muted">{formatRelativeTime(event.occurredAt)}</p>
        </div>
        <p className="mt-1 text-xs text-muted">
          {event.detail ?? event.status ?? "Observed event"}
          {event.ticker ? ` · ${event.ticker}` : ""}
        </p>
      </div>
    </div>
  );
}

function CalendarSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-24" />
      <Skeleton className="h-[520px]" />
    </div>
  );
}

export function TradingCalendar() {
  const wallet = useWalletStore((state) => state.address);
  const connected = useWalletStore((state) => state.connected);
  const calendar = usePortfolioStore((state) => state.calendar);
  const calendarDay = usePortfolioStore((state) => state.calendarDay);
  const isLoading = usePortfolioStore((state) => state.isCalendarLoading);
  const error = usePortfolioStore((state) => state.error);
  const loadCalendar = usePortfolioStore((state) => state.loadCalendar);
  const loadCalendarDay = usePortfolioStore((state) => state.loadCalendarDay);
  const reset = usePortfolioStore((state) => state.reset);
  const [month, setMonth] = useState(currentMonth);
  const [selectedDate, setSelectedDate] = useState<string>();
  const timeZone = useMemo(() => browserTimeZone(), []);

  useEffect(() => {
    if (!wallet || !connected) {
      reset();
      return;
    }
    void loadCalendar(wallet, { month, timeZone });
  }, [connected, loadCalendar, month, reset, timeZone, wallet]);

  useEffect(() => {
    if (!wallet || !connected || !selectedDate) return;
    void loadCalendarDay(wallet, selectedDate, { timeZone });
  }, [connected, loadCalendarDay, selectedDate, timeZone, wallet]);

  const maxMove = useMemo(
    () => Math.max(...(calendar?.days ?? []).map((day) => Math.abs(day.pnlUsd)), 1),
    [calendar],
  );
  const selectedSummary = calendar?.days.find((day) => day.date === selectedDate);
  const monthPnl = useMemo(
    () => (calendar?.days ?? []).reduce((sum, day) => sum + day.pnlUsd, 0),
    [calendar],
  );
  const activeDays = calendar?.days.filter((day) => day.hasData).length ?? 0;

  if (!connected) {
    return (
      <div className="mx-auto max-w-6xl">
        <div className="mb-5">
          <p className="text-sm text-muted">Trading Calendar</p>
          <h1 className="font-display text-4xl font-semibold tracking-normal">Calendar</h1>
        </div>
        <EmptyState
          description="Connect a Solana wallet to view Oren-observed daily P&L, trades, vault events, and agent activity."
          title="Connect wallet to open your trading memory"
        />
      </div>
    );
  }

  if (isLoading && !calendar) return <CalendarSkeleton />;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Trading Calendar</p>
          <h1 className="font-display text-4xl font-semibold tracking-normal">Calendar</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Snapshot-based performance memory for your Oren-observed portfolio.
          </p>
        </div>
        <Button disabled={isLoading || !wallet} onClick={() => wallet && loadCalendar(wallet, { month, timeZone })} variant="secondary">
          <HugeiconsIcon className={cn(isLoading && "animate-spin")} color="currentColor" icon={RefreshCwIcon} size={16} strokeWidth={1.8} />
          Refresh
        </Button>
      </div>

      {error ? <ErrorState description={error} onRetry={() => wallet && loadCalendar(wallet, { month, timeZone })} /> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Metric detail={`${activeDays} observed days`} label="Month P&L" value={formatCurrency(monthPnl)} />
        <Metric detail="Last observed close" label="Cumulative Value" value={formatCurrency(calendar?.days.findLast((day) => day.hasData)?.cumulativeValueUsd)} />
        <Metric detail={timeZone} label="Calendar Timezone" value={monthLabel(month)} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-semibold">{monthLabel(month)}</h2>
              <p className="mt-1 text-sm text-muted">Green and red intensity follows observed daily P&L.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button aria-label="Previous month" onClick={() => setMonth((value) => shiftMonth(value, -1))} size="icon" variant="ghost">
                <HugeiconsIcon color="currentColor" icon={ArrowLeft01Icon} size={18} strokeWidth={1.8} />
              </Button>
              <Button aria-label="Next month" onClick={() => setMonth((value) => shiftMonth(value, 1))} size="icon" variant="ghost">
                <HugeiconsIcon color="currentColor" icon={ArrowRight01Icon} size={18} strokeWidth={1.8} />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold text-muted">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="mt-3 grid grid-cols-7 gap-2">
              {calendar?.days[0] ? Array.from({ length: new Date(`${calendar.days[0].date}T00:00:00`).getDay() }).map((_, index) => <span key={`pad-${index}`} />) : null}
              {(calendar?.days ?? []).map((day) => (
                <button
                  className={cn(
                    "min-h-28 rounded-[18px] border p-2 text-left transition hover:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus",
                    selectedDate === day.date ? "border-foreground" : "border-border",
                    dayClass(day, maxMove),
                  )}
                  key={day.date}
                  onClick={() => setSelectedDate(day.date)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-sm font-semibold">{dayNumber(day.date)}</span>
                    <span className="text-[11px] font-semibold">{day.hasData ? formatPercent(day.returnPct) : ""}</span>
                  </div>
                  {day.hasData ? (
                    <div className="mt-5">
                      <p className="font-mono text-sm font-semibold">{formatCurrency(day.pnlUsd)}</p>
                      <p className="mt-1 truncate text-[11px] opacity-75">{formatCurrency(day.cumulativeValueUsd)} close</p>
                    </div>
                  ) : null}
                  <div className="mt-3 flex gap-1">
                    {day.significantEvents.slice(0, 4).map((event) => (
                      <span className={cn("h-1.5 w-1.5 rounded-full", eventTone(event.type))} key={event.id} />
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <h2 className="font-display text-xl font-semibold">Day Drilldown</h2>
            <p className="mt-1 text-sm text-muted">{selectedDate ? formatDate(selectedDate) : "Select a day to inspect performance."}</p>
          </CardHeader>
          <CardContent>
            {selectedSummary ? (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  <Metric detail="Observed close minus open" label="P&L" value={formatCurrency(selectedSummary.pnlUsd)} />
                  <Metric detail="Snapshot return" label="Return" value={formatPercent(selectedSummary.returnPct)} />
                </div>
                <div className="rounded-[18px] bg-panel-subtle p-4">
                  <p className="text-xs font-semibold text-muted">Movement Split</p>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-muted">Realized activity</p>
                      <p className="font-mono font-semibold">{formatCurrency(selectedSummary.realizedActivityUsd)}</p>
                    </div>
                    <div>
                      <p className="text-muted">Unrealized movement</p>
                      <p className="font-mono font-semibold">{formatCurrency(selectedSummary.unrealizedMovementUsd)}</p>
                    </div>
                  </div>
                </div>
                {calendarDay?.contributors.length ? (
                  <div>
                    <p className="mb-2 text-sm font-semibold">Contributors</p>
                    <div className="space-y-2">
                      {calendarDay.contributors.slice(0, 4).map((item) => (
                        <div className="flex items-center justify-between rounded-[14px] bg-background p-3 text-sm" key={item.assetId}>
                          <span className="font-semibold">{item.ticker}</span>
                          <span className={cn("font-mono", item.valueChangeUsd >= 0 ? "text-positive" : "text-negative")}>
                            {formatCurrency(item.valueChangeUsd)} · {formatNumber(item.valueChangePct, 2)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div>
                  <p className="mb-2 text-sm font-semibold">Events</p>
                  <div className="space-y-2">
                    {[...(calendarDay?.summary.significantEvents ?? selectedSummary.significantEvents), ...(calendarDay?.walletActivity ?? [])].length ? (
                      [...(calendarDay?.summary.significantEvents ?? selectedSummary.significantEvents), ...(calendarDay?.walletActivity ?? [])]
                        .slice(0, 8)
                        .map((event) => <EventRow event={event} key={event.id} />)
                    ) : (
                      <p className="rounded-[16px] bg-panel-subtle p-4 text-sm text-muted">No notable events were recorded for this day.</p>
                    )}
                  </div>
                </div>
                <p className="rounded-[16px] bg-panel-subtle p-4 text-xs leading-5 text-muted">
                  {calendarDay?.notes[1] ?? "This view is based on Oren-observed snapshots and activity."}
                </p>
              </div>
            ) : (
              <EmptyState description="Choose a calendar day to see trades, vault activity, wallet events, and best or worst contributors." title="No day selected" />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
