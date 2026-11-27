"use client";

import { cn } from "@/components/ui/utils";
import { useI18n } from "@/i18n/i18n";
import type { MarketDayMove, MarketDayRecap } from "@/types";
import { NEW_YORK, formatClock } from "./market-layer";

function percent(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero" }).format(value / 100);
}

function tone(value: number) {
  return value > 0 ? "text-positive" : value < 0 ? "text-negative" : "text-muted";
}

function Label({ children }: { children: React.ReactNode }) {
  return <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted">{children}</h4>;
}

function MoveRow({ label, title, move }: { label: string; title?: string; move: MarketDayMove }) {
  const { locale } = useI18n();
  return (
    <li className="flex items-baseline justify-between gap-3 py-1 text-sm" title={title}>
      <span className="truncate">{label}</span>
      <span className={cn("shrink-0 font-money tabular-nums", tone(move.changePct))}>{percent(move.changePct, locale)}</span>
    </li>
  );
}

/**
 * The market's day under the month grid: index moves, the biggest movers
 * among large names, and that day's headlines, side by side. Everything is
 * computed or quoted; none of it is written by a model.
 */
export function DayRecap({ date, recap, loading, failed }: { date: string; recap?: MarketDayRecap; loading?: boolean; failed?: boolean }) {
  const { locale, t } = useI18n();
  const shell = "rounded-[20px] border border-border p-5";
  if (loading)
    return (
      <div aria-hidden className={cn(shell, "grid gap-6 md:grid-cols-3")}>
        {[0, 1, 2].map((key) => (
          <div className="space-y-2" key={key}>
            <div className="h-3 w-20 animate-pulse rounded-full bg-panel-subtle" />
            <div className="h-16 animate-pulse rounded-[12px] bg-panel-subtle" />
          </div>
        ))}
      </div>
    );
  if (failed) return <p className="px-1 text-xs text-muted">{t("calendar.recap.unavailable")}</p>;
  if (!recap || recap.date !== date || recap.status === "upcoming") return null;
  const movers = [...recap.gainers, ...recap.losers];
  if (!recap.indexes.length && !movers.length && !recap.headlines.length) return null;

  const heading = t(recap.status === "in_progress" ? "calendar.recap.soFar" : recap.status === "closed" ? "calendar.recap.onChain" : "calendar.recap.title");
  const day = new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

  return (
    <section aria-labelledby="calendar-recap" className={shell}>
      <h3 className="flex items-baseline gap-2 text-sm font-medium" id="calendar-recap">
        {heading}
        <span className="font-normal text-muted">{day}</span>
      </h3>
      <div className="mt-4 grid gap-x-8 gap-y-6 md:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.7fr)]">
        {recap.indexes.length ? (
          <div className="min-w-0">
            <Label>{t("calendar.recap.indexes")}</Label>
            <ul className="mt-2">
              {recap.indexes.map((move) => <MoveRow key={move.assetId} label={move.name} move={move} title={move.ticker} />)}
            </ul>
          </div>
        ) : null}
        {movers.length ? (
          <div className="min-w-0">
            <Label>{t("calendar.recap.movers")}</Label>
            <ul className="mt-2">
              {movers.map((move) => <MoveRow key={move.assetId} label={move.ticker} move={move} title={move.name} />)}
            </ul>
          </div>
        ) : null}
        {recap.headlines.length ? (
          <div className="min-w-0">
            <Label>{t("calendar.recap.headlines")}</Label>
            <ul className="mt-2 space-y-2.5">
              {recap.headlines.slice(0, 3).map((item) => (
                <li className="min-w-0" key={item.url}>
                  <a
                    className="line-clamp-2 text-[13px] leading-[18px] underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
                    href={item.url}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {item.headline}
                  </a>
                  <p className="mt-0.5 font-money text-[11px] tabular-nums text-muted">
                    {[item.source, t("calendar.market.atTime", { time: formatClock(item.publishedAt, locale, NEW_YORK) })].filter(Boolean).join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
