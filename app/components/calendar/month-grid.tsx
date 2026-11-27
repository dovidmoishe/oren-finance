"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { cn, formatDate, weekdayLabels } from "@/components/ui";
import { useI18n } from "@/i18n/i18n";
import type { MarketEvent, TradingCalendarDaySummary } from "@/types";
import { isHighImpact, kindRank, sessionShare, weekdayOf, type MarketDay } from "./market-layer";

/** Two quiet tints: P&L should read at a glance without turning the month into a flag. */
function heatClass(day: TradingCalendarDaySummary, maxMove: number) {
  const strong = Math.abs(day.pnlUsd) / Math.max(maxMove, 1) > 0.66;
  if (day.pnlUsd > 0) return strong ? "bg-heat-up-2" : "bg-heat-up-1";
  if (day.pnlUsd < 0) return strong ? "bg-heat-down-2" : "bg-heat-down-1";
  return undefined;
}

/** The single most market-moving release names the day; anything else is a dot. */
function releaseMark(events: readonly MarketEvent[] | undefined) {
  const kinds = [...new Set((events ?? []).map((event) => event.kind))].sort((a, b) => kindRank(a) - kindRank(b));
  const major = kinds.filter(isHighImpact);
  return { label: major[0], more: Math.max(0, major.length - 1), minor: kinds.length > 0 && major.length === 0 };
}

export function MonthGrid({
  dates,
  today,
  activeDate,
  onSelect,
  onMove,
  portfolioDays,
  marketDays,
  releases,
  maxMove,
  todayProgress,
}: {
  dates: readonly string[];
  today?: string;
  activeDate?: string;
  onSelect: (date: string) => void;
  /** Move the selection by a number of days; the page crosses months. */
  onMove?: (days: number) => void;
  portfolioDays: ReadonlyMap<string, TradingCalendarDaySummary>;
  marketDays?: ReadonlyMap<string, MarketDay>;
  releases: ReadonlyMap<string, MarketEvent[]>;
  maxMove: number;
  /** Share of today's regular session already elapsed. */
  todayProgress?: number;
}) {
  const { locale, t } = useI18n();
  const grid = useRef<HTMLDivElement>(null);
  const keyboard = useRef(false);

  // After an arrow key, keep focus on the newly selected day, even in a new month.
  useEffect(() => {
    if (!keyboard.current) return;
    keyboard.current = false;
    grid.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus();
  }, [activeDate]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (!step || !onMove || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    keyboard.current = true;
    onMove(step);
  };
  const signedCompact = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1, signDisplay: "exceptZero" });

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 pb-2 sm:gap-1.5">
        {weekdayLabels(locale).map((day, index) => (
          <span className="px-1.5 text-[11px] font-medium uppercase tracking-wider text-muted sm:px-2.5" key={index}>{day}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5" onKeyDown={onKeyDown} ref={grid}>
        {Array.from({ length: weekdayOf(dates[0]) }).map((_, index) => <span aria-hidden key={`pad-${index}`} />)}
        {dates.map((date) => {
          const portfolio = portfolioDays.get(date);
          const market = marketDays?.get(date);
          const dayReleases = releases.get(date);
          const mark = releaseMark(dayReleases);
          const share = sessionShare(market);
          const closed = market?.status === "weekend" || market?.status === "holiday";
          const heat = portfolio?.hasData ? heatClass(portfolio, maxMove) : undefined;
          const isToday = date === today;
          const selected = date === activeDate;
          const label = [
            formatDate(date, locale, "UTC"),
            isToday ? t("calendar.today") : null,
            portfolio?.hasData ? signedCompact.format(portfolio.pnlUsd) : null,
            market?.status === "holiday" ? t("calendar.market.closedFor", { name: market.name ?? "" }) : null,
            market?.status === "early_close" ? t("calendar.market.earlyClose") : null,
            dayReleases?.length ? t("calendar.releaseCount", { count: dayReleases.length }) : null,
          ].filter(Boolean).join(", ");

          return (
            <button
              aria-label={label}
              aria-pressed={selected}
              className={cn(
                "relative flex h-16 min-w-0 flex-col items-start rounded-[12px] p-1.5 text-left transition-colors sm:h-24 sm:rounded-[16px] sm:p-2.5",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                // Trading days are soft tiles; closed days fall back to the page, holidays hatched.
                heat ??
                  (market?.status === "holiday"
                    ? "bg-[repeating-linear-gradient(135deg,var(--color-border)_0_1px,transparent_1px_7px)]"
                    : closed
                      ? "hover:bg-panel-subtle/60"
                      : "bg-panel-subtle/70 hover:bg-panel-subtle"),
                selected && "ring-1 ring-inset ring-foreground/60",
              )}
              key={date}
              onClick={() => onSelect(date)}
              tabIndex={selected || (!activeDate && date === dates[0]) ? 0 : -1}
              title={market?.status === "holiday" ? market.name ?? undefined : undefined}
              type="button"
            >
              <span
                className={cn(
                  "font-money text-xs tabular-nums sm:text-[13px]",
                  isToday
                    ? "-ml-1 -mt-1 inline-flex size-6 items-center justify-center rounded-full bg-foreground font-medium text-background"
                    : closed && !heat
                      ? "text-muted"
                      : "font-medium",
                )}
              >
                {Number(date.slice(-2))}
              </span>

              {mark.label ? (
                <span className="absolute right-1.5 top-2 hidden text-[10px] font-semibold uppercase tracking-wide text-brand sm:right-2.5 sm:top-3 sm:block">
                  {t(`calendar.market.kindShort.${mark.label}`)}
                  {mark.more ? <span className="ml-0.5 text-muted">+{mark.more}</span> : null}
                </span>
              ) : null}
              {mark.label || mark.minor ? (
                <span
                  aria-hidden
                  className={cn("absolute right-1.5 top-2 size-1.5 rounded-full", mark.label ? "bg-brand sm:hidden" : "bg-muted-2 sm:right-2.5 sm:top-3.5")}
                />
              ) : null}

              {portfolio?.hasData ? (
                <span className="mt-auto mb-1.5 max-w-full truncate font-money text-[10px] font-medium tabular-nums sm:mb-2 sm:text-xs">
                  {signedCompact.format(portfolio.pnlUsd)}
                </span>
              ) : null}

              {share > 0 ? (
                <span aria-hidden className="absolute inset-x-1.5 bottom-1.5 h-[3px] sm:inset-x-2.5 sm:bottom-2">
                  <span className="relative block h-full overflow-hidden rounded-full bg-foreground/15" style={{ width: `${share * 100}%` }}>
                    {isToday && todayProgress !== undefined ? (
                      <span className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${todayProgress * 100}%` }} />
                    ) : null}
                  </span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
