"use client";

import { ArrowUpRight as ArrowUpRightIcon, Sparkles as SparklesIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/components/ui/utils";
import { useI18n, type Translate } from "@/i18n/i18n";
import type {
  MarketEvent,
  MarketEventsResponse,
  TradingCalendarDayResponse,
  TradingCalendarDaySummary,
  TradingCalendarEvent,
  TradingCalendarTrade,
  UsEquityHours,
} from "@/types";
import { NEW_YORK, formatClock, formatShortClock, progressBetween, sharesNewYorkClock, type MarketDay } from "./market-layer";

type TimelineItem =
  | { id: string; at: string | null; kind: "release"; event: MarketEvent }
  | { id: string; at: string; kind: "trade"; trade: TradingCalendarTrade }
  | { id: string; at: string; kind: "activity"; event: TradingCalendarEvent };

function money(value: number, locale: string, signed = false) {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", signDisplay: signed ? "exceptZero" : "auto" }).format(value);
}

function percent(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2, signDisplay: "exceptZero" }).format(value / 100);
}

function tradeLabel(trade: TradingCalendarTrade, t: Translate) {
  const ticker = trade.ticker ?? "";
  switch (trade.type) {
    case "stock_purchase":
      return t("calendar.day.bought", { ticker });
    case "stock_sale":
      return t("calendar.day.sold", { ticker });
    case "basket_purchase":
      return t("calendar.day.basket");
    case "lock":
      return t("calendar.day.locked", { ticker });
    case "unlock":
      return t("calendar.day.unlocked", { ticker });
  }
}

/** Vault, agent and wallet moments that aren't already a trade row. */
function activityEvents(day: TradingCalendarDayResponse | undefined, summary: TradingCalendarDaySummary | undefined) {
  const seen = new Set<string>();
  return [...(day?.summary.significantEvents ?? summary?.significantEvents ?? []), ...(day?.walletActivity ?? [])].filter((event) => {
    if (event.type === "trade" || event.type === "movement" || seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

/** Apple Weather's daylight strip, for the US session: extended hours as track, regular hours in ink. */
function SessionStrip({ hours, releases, trades, now }: { hours: UsEquityHours; releases: MarketEvent[]; trades: TradingCalendarTrade[]; now?: number }) {
  const { locale, t } = useI18n();
  const sessions = hours.sessions!;
  const start = sessions.preMarket.startUtc;
  const end = sessions.afterHours.endUtc;
  const at = (instant: string | number) => `${progressBetween(instant, start, end) * 100}%`;
  const open = progressBetween(sessions.regular.startUtc, start, end) * 100;
  const close = progressBetween(sessions.regular.endUtc, start, end) * 100;
  const live = now !== undefined && now > Date.parse(start) && now < Date.parse(end);
  const clock = (instant: string) => formatShortClock(instant, locale, NEW_YORK);
  return (
    <figure
      aria-label={t("calendar.market.strip", { open: clock(sessions.regular.startUtc), close: clock(sessions.regular.endUtc) })}
      className="mt-6"
      role="img"
    >
      <div className="relative h-5">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-panel-subtle" />
        <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground" style={{ left: `${open}%`, width: `${close - open}%` }} />
        {live ? <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-brand" style={{ left: at(now) }} /> : null}
        {releases.filter((event) => event.timePrecision === "datetime").map((event) => (
          <span
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel bg-brand"
            key={event.id}
            style={{ left: at(event.scheduledAt) }}
          />
        ))}
        {trades.map((trade) => (
          <span className="absolute -bottom-1 size-1.5 -translate-x-1/2 rounded-full bg-foreground/70" key={trade.id} style={{ left: at(trade.occurredAt) }} />
        ))}
      </div>
      <div aria-hidden className="relative mt-2 h-4 font-money text-[10px] tabular-nums text-muted">
        <span className="absolute left-0">{clock(start)}</span>
        <span className="absolute -translate-x-1/2 text-foreground" style={{ left: `${open}%` }}>{clock(sessions.regular.startUtc)}</span>
        <span className="absolute -translate-x-1/2 text-foreground" style={{ left: `${close}%` }}>{clock(sessions.regular.endUtc)}</span>
        <span className="absolute right-0">{t("calendar.market.atTime", { time: clock(end) })}</span>
      </div>
    </figure>
  );
}

function TimelineRow({ item, zone, timeZone, reminder }: { item: TimelineItem; zone: string; timeZone: string; reminder?: (event: MarketEvent) => ReactNode }) {
  const { locale, t } = useI18n();
  const time = item.at ? formatClock(item.at, locale, zone) : t("calendar.day.allDay");
  const localTitle =
    item.at && zone !== timeZone && !sharesNewYorkClock(item.at, timeZone) ? t("calendar.market.yourTime", { time: formatClock(item.at, locale, timeZone) }) : undefined;

  let dot = "bg-foreground/70";
  let title: React.ReactNode;
  let detail: string | null = null;
  let value: string | null = null;
  let note: string | null = null;
  let action: ReactNode = null;

  if (item.kind === "release") {
    const event = item.event;
    dot = "bg-brand";
    title = (
      <a
        aria-label={`${t(`calendar.market.kind.${event.kind}`)}, ${t("calendar.market.officialRelease")}`}
        className="group/link inline-flex items-center gap-1 underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
        href={event.dataSourceUrl ?? event.sourceUrl}
        rel="noopener noreferrer"
        target="_blank"
      >
        {t(`calendar.market.kind.${event.kind}`)}
        <ArrowUpRightIcon aria-hidden className="text-muted opacity-0 transition-opacity group-hover/link:opacity-100 group-focus-visible/link:opacity-100" color="currentColor" size={12} strokeWidth={2} />
      </a>
    );
    detail = event.referenceLabel;
    if (event.status === "scheduled") action = reminder?.(event) ?? null;
    if (event.status === "released" && event.actualText) {
      value = event.actualText;
      note = event.previousText ? t("calendar.market.previous", { value: event.previousText }) : null;
    } else if (event.status === "released") {
      note = t("calendar.market.pending");
    }
  } else if (item.kind === "trade") {
    dot = "bg-accent-yellow";
    title = tradeLabel(item.trade, t);
    value = item.trade.amountUsd ? money(item.trade.amountUsd, locale) : null;
    detail = item.trade.route ?? null;
  } else {
    dot = item.event.type === "agent" ? "bg-accent-lavender" : item.event.type === "lock" || item.event.type === "unlock" ? "bg-accent-pink" : "bg-foreground/70";
    title = item.event.title;
    detail = item.event.detail ?? null;
    value = item.event.amountUsd ? money(item.event.amountUsd, locale) : null;
  }

  return (
    <li className="grid grid-cols-[4.25rem_minmax(0,1fr)_auto] items-baseline gap-x-3 py-2">
      <time className="font-money text-xs tabular-nums text-muted" dateTime={item.at ?? undefined} title={localTitle}>{time}</time>
      <div className="min-w-0">
        <p className="flex items-baseline gap-2 text-sm font-medium leading-5">
          <span aria-hidden className={cn("size-1.5 shrink-0 -translate-y-0.5 rounded-full", dot)} />
          <span className="min-w-0">{title}</span>
        </p>
        {detail ? <p className="pl-3.5 text-xs leading-4 text-muted">{detail}</p> : null}
      </div>
      {value || note ? (
        <div className="text-right">
          {value ? <p className="font-money text-sm font-medium leading-5 tabular-nums">{value}</p> : null}
          {note ? <p className={cn("font-money text-[11px] leading-4 tabular-nums text-muted", !value && "text-xs leading-5")}>{note}</p> : null}
        </div>
      ) : action ? (
        <div className="self-center">{action}</div>
      ) : null}
    </li>
  );
}

function statusLine(day: MarketDay | undefined, hours: UsEquityHours | undefined, t: Translate) {
  const status = day?.status ?? (hours ? (hours.closedReason === "weekend" ? "weekend" : hours.closedReason ? "holiday" : hours.earlyClose ? "early_close" : "open") : undefined);
  const name = day?.name ?? hours?.holidayName;
  if (status === "weekend") return { text: t("calendar.market.weekend"), closed: true };
  if (status === "holiday") return { text: t("calendar.market.closedFor", { name: name ?? "" }), closed: true };
  if (status === "early_close") return { text: name ? `${t("calendar.market.earlyClose")} · ${name}` : t("calendar.market.earlyClose"), closed: false };
  if (status === "open") return { text: t("calendar.market.regularHours"), closed: false };
  return undefined;
}

/**
 * One selected day as a single timeline: the US session, official releases,
 * and the viewer's own trades and vault moments, in time order.
 */
export function DayPanel({
  date,
  timeZone,
  showMarket,
  showPortfolio,
  marketDay,
  hours,
  releases,
  releasesUnavailable,
  summary,
  day,
  now,
  reminder,
  onAsk,
  askBusy,
}: {
  date: string;
  timeZone: string;
  showMarket: boolean;
  showPortfolio: boolean;
  marketDay?: MarketDay;
  hours?: UsEquityHours;
  releases: MarketEvent[];
  releasesUnavailable?: boolean;
  summary?: TradingCalendarDaySummary;
  day?: TradingCalendarDayResponse;
  /** The latest session check, so the "now" line moves with each refresh. */
  now?: number;
  /** A reminder control for an upcoming release row. */
  reminder?: (event: MarketEvent) => ReactNode;
  /** Opens Copilot about this day. Absent when the viewer can't ask. */
  onAsk?: () => void;
  askBusy?: boolean;
}) {
  const { locale, t } = useI18n();
  const status = showMarket ? statusLine(marketDay, hours, t) : undefined;
  const trades = showPortfolio ? day?.trades ?? [] : [];
  const activity = showPortfolio ? activityEvents(day, summary) : [];
  const sessions = showMarket ? hours?.sessions : null;
  const zone = showMarket ? NEW_YORK : timeZone;

  // The strip already draws the open and close, so the list holds only events.
  const items: TimelineItem[] = [
    ...(showMarket ? releases.map((event) => ({ id: event.id, at: event.timePrecision === "datetime" ? event.scheduledAt : null, kind: "release" as const, event })) : []),
    ...trades.map((trade) => ({ id: trade.id, at: trade.occurredAt, kind: "trade" as const, trade })),
    ...activity.map((event) => ({ id: event.id, at: event.occurredAt, kind: "activity" as const, event })),
  ].sort((a, b) => (a.at === null ? -1 : b.at === null ? 1 : a.at.localeCompare(b.at)));
  const movers = showPortfolio ? (day?.contributors ?? []).slice(0, 3) : [];
  const pnl = showPortfolio && summary?.hasData ? summary : undefined;

  return (
    <div>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-medium tracking-tight">
            {new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`))}
          </h2>
          {status ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
              <span aria-hidden className={cn("size-1.5 rounded-full", status.closed ? "bg-muted-2" : "bg-foreground")} />
              <span className="truncate">{status.text}</span>
            </p>
          ) : null}
        </div>
        {pnl ? (
          <div className="shrink-0 text-right">
            <p className={cn("font-money text-2xl font-medium tabular-nums tracking-tight", pnl.pnlUsd > 0 ? "text-positive" : pnl.pnlUsd < 0 ? "text-negative" : "")}>
              {money(pnl.pnlUsd, locale, true)}
            </p>
            <p className="font-money text-xs tabular-nums text-muted">{percent(pnl.returnPct, locale)}</p>
          </div>
        ) : null}
      </header>

      {sessions && hours ? <SessionStrip hours={hours} now={now} releases={releases} trades={trades} /> : null}
      {showMarket && status?.closed ? <p className="mt-5 rounded-[14px] bg-panel-subtle px-4 py-3 text-xs leading-5 text-muted">{t("calendar.market.onChain")}</p> : null}

      {items.length ? <ol className="mt-4">{items.map((item) => <TimelineRow item={item} key={`${item.kind}-${item.id}`} reminder={reminder} timeZone={timeZone} zone={zone} />)}</ol> : null}
      {!items.length && !status?.closed ? (
        <p className="mt-3 text-xs text-muted">{showMarket && releasesUnavailable ? t("calendar.market.unavailable") : t("calendar.day.quiet")}</p>
      ) : null}

      {movers.length ? (
        <section className="mt-5 border-t border-border pt-4">
          <h3 className="text-xs font-medium text-muted">{t("calendar.day.topMovers")}</h3>
          <ul className="mt-2 space-y-1">
            {movers.map((item) => (
              <li className="flex items-center justify-between gap-3 py-0.5 text-sm" key={item.assetId}>
                <span className="font-medium">{item.ticker}</span>
                <span className={cn("font-money tabular-nums", item.valueChangeUsd > 0 ? "text-positive" : item.valueChangeUsd < 0 ? "text-negative" : "text-muted")}>
                  {money(item.valueChangeUsd, locale, true)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {showMarket && marketDay?.provisional ? <p className="mt-5 text-[11px] leading-4 text-muted">{t("calendar.market.provisional")}</p> : null}

      {onAsk ? (
        <button
          className="mt-5 inline-flex h-9 w-full items-center justify-center gap-2 rounded-full bg-panel-subtle text-sm font-medium transition-colors hover:bg-tone-lavender hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50"
          disabled={askBusy}
          onClick={onAsk}
          type="button"
        >
          <SparklesIcon aria-hidden color="currentColor" size={14} strokeWidth={1.8} />
          {t("calendar.day.ask")}
        </button>
      ) : null}
    </div>
  );
}

/** Agency credit and the notices the BLS, BEA and Census API terms require, shown unchanged. */
export function MarketSources({ response }: { response?: MarketEventsResponse }) {
  const { locale, t } = useI18n();
  if (!response?.attribution.sources.length) return null;
  const agencies = new Intl.ListFormat(locale, { type: "conjunction" }).format(response.attribution.sources.map((source) => source.name));
  return (
    <footer className="space-y-1 text-[11px] leading-4 text-muted">
      <p>{t("calendar.market.sources", { agencies })}</p>
      {response.attribution.notices.length ? <p lang="en">{response.attribution.notices.join(" ")}</p> : null}
    </footer>
  );
}
