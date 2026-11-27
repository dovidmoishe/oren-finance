import type { MacroEventKind, MarketEvent, UsEquityClosure } from "@/types";

/**
 * Pure helpers that merge the US market calendar (NYSE hours and official
 * macro releases) into the trading calendar's month grid. The combined view groups all activity by New York date.
 */

export type CalendarLayer = "all" | "portfolio" | "market";
export const CALENDAR_LAYERS: readonly CalendarLayer[] = ["all", "portfolio", "market"];

export const NEW_YORK = "America/New_York";

export function calendarTimeZone(layer: CalendarLayer, viewerTimeZone: string) {
  return layer === "portfolio" ? viewerTimeZone : NEW_YORK;
}

export type MarketDayStatus = "open" | "early_close" | "holiday" | "weekend";

export interface MarketDay {
  date: string;
  status: MarketDayStatus;
  /** Holiday or early-close occasion. */
  name: string | null;
  /** Regular-session close on early-close days, as a UTC instant. */
  closeUtc: string | null;
  provisional: boolean;
}

/** Most market-moving first. Weekly claims sort last so they never crowd out CPI or FOMC. */
const KIND_ORDER: readonly MacroEventKind[] = [
  "fomc_decision",
  "employment_situation",
  "cpi",
  "pce",
  "gdp",
  "ppi",
  "retail_sales",
  "jobless_claims",
];

export function kindRank(kind: MacroEventKind) {
  const rank = KIND_ORDER.indexOf(kind);
  return rank === -1 ? KIND_ORDER.length : rank;
}

function parse(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function iso(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number) {
  return iso(parse(date) + days * 86_400_000);
}

/** 0 = Sunday. */
export function weekdayOf(date: string) {
  return new Date(parse(date)).getUTCDay();
}

/** Every date in a `YYYY-MM` month. */
export function monthDates(month: string) {
  const [year, index] = month.split("-").map(Number);
  const length = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return Array.from({ length }, (_, day) => `${month}-${String(day + 1).padStart(2, "0")}`);
}

/** The civil date of `at` in `timeZone`, YYYY-MM-DD. */
export function civilDate(timeZone: string, at: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/**
 * The release range to load for a month. The current month looks two weeks
 * past its end so "next release" still has an answer on the last days.
 */
export function eventsRange(month: string, today?: string) {
  const dates = monthDates(month);
  const from = dates[0];
  const end = dates[dates.length - 1];
  if (!today || !today.startsWith(month)) return { from, to: end };
  const ahead = addDays(today, 14);
  return { from, to: ahead > end ? ahead : end };
}

/** NYSE status for each date. Undefined until the year's closures load. */
export function marketDays(dates: readonly string[], closures: readonly UsEquityClosure[] | undefined, provisional = false) {
  if (!closures) return undefined;
  const byDate = new Map(closures.map((closure) => [closure.date, closure]));
  return new Map(
    dates.map((date): [string, MarketDay] => {
      const weekday = weekdayOf(date);
      const closure = byDate.get(date);
      if (weekday === 0 || weekday === 6) return [date, { date, status: "weekend", name: null, closeUtc: null, provisional }];
      if (closure?.kind === "full_close")
        return [date, { date, status: "holiday", name: closure.name, closeUtc: null, provisional: closure.provisional }];
      if (closure?.kind === "early_close")
        return [date, { date, status: "early_close", name: closure.name, closeUtc: closure.closeUtc, provisional: closure.provisional }];
      return [date, { date, status: "open", name: null, closeUtc: null, provisional }];
    }),
  );
}

/** Releases per New York date, in release order. */
export function eventsByDate(events: readonly MarketEvent[] | undefined) {
  const byDate = new Map<string, MarketEvent[]>();
  for (const event of events ?? []) {
    if (event.status === "cancelled") continue;
    const list = byDate.get(event.dateEt) ?? [];
    list.push(event);
    byDate.set(event.dateEt, list);
  }
  for (const list of byDate.values())
    list.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || kindRank(a.kind) - kindRank(b.kind));
  return byDate;
}

/** A clock time for an instant in one zone, for example "8:30 AM". */
export function formatClock(instant: string, locale: string, timeZone: string) {
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(instant));
}

/** A clock time that drops ":00" on the hour, for example "1 PM" or "8:30 AM". */
export function formatShortClock(instant: string, locale: string, timeZone: string) {
  const at = new Date(instant);
  const onHour = Number(new Intl.DateTimeFormat("en-US", { minute: "numeric", timeZone }).format(at)) === 0;
  return new Intl.DateTimeFormat(locale, { hour: "numeric", ...(onHour ? {} : { minute: "2-digit" }), timeZone }).format(at);
}

/** A weekday and clock time for an instant, for example "Mon 9:30 AM". */
export function formatWeekdayClock(instant: string, locale: string, timeZone: string) {
  return new Intl.DateTimeFormat(locale, { weekday: "short", hour: "numeric", minute: "2-digit", timeZone }).format(new Date(instant));
}

/** Whether the viewer's date and clock read the same as New York's at `instant`. */
export function sharesNewYorkClock(instant: string, timeZone: string) {
  const stamp = (zone: string) =>
    new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "short", timeZone: zone }).format(new Date(instant));
  return stamp(timeZone) === stamp(NEW_YORK);
}

/** Releases that move the whole market get a label in the month grid; the rest get a dot. */
const HIGH_IMPACT: ReadonlySet<MacroEventKind> = new Set(["fomc_decision", "employment_situation", "cpi", "pce", "gdp"]);

export function isHighImpact(kind: MacroEventKind) {
  return HIGH_IMPACT.has(kind);
}

/** Minutes past midnight on New York's wall clock. */
export function newYorkMinutes(instant: string) {
  const parts = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: NEW_YORK }).formatToParts(new Date(instant));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return value("hour") * 60 + value("minute");
}

const REGULAR_OPEN_MINUTES = 9 * 60 + 30;
const REGULAR_SESSION_MINUTES = 6 * 60 + 30;

/** Length of a day's regular session as a share of a full 6.5-hour day. 0 when closed. */
export function sessionShare(day: MarketDay | undefined) {
  if (!day || day.status === "weekend" || day.status === "holiday") return 0;
  if (day.status === "early_close" && day.closeUtc)
    return Math.max(0, Math.min(1, (newYorkMinutes(day.closeUtc) - REGULAR_OPEN_MINUTES) / REGULAR_SESSION_MINUTES));
  return 1;
}

/** Where `instant` falls between `start` and `end`, clamped to 0..1. */
export function progressBetween(instant: string | number, start: string, end: string) {
  const at = typeof instant === "number" ? instant : Date.parse(instant);
  const from = Date.parse(start);
  const to = Date.parse(end);
  if (!(to > from)) return 0;
  return Math.max(0, Math.min(1, (at - from) / (to - from)));
}
