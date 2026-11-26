import { brandIcons, type BrandIcon } from "./brand-icons";
import type { Count, Day, Permission, Session, Slice } from "./types";

export function hasPermission(session: Session, permission: string) {
  return (
    !session.mustChangePassword &&
    session.permissions.includes(permission as Permission)
  );
}
export const missingValue = "—";

export function hasObservation<T extends Count>(
  count: T | undefined,
): count is T & { value: number } {
  return count != null && count.status !== "unavailable" && count.value != null;
}

export function trafficCoverage(days: Day[]) {
  const observed = days.filter(hasObservation);
  return {
    recordedPageviews: observed.length
      ? observed.reduce((total, day) => total + day.value, 0)
      : null,
    partial: observed.some((day) => day.status === "partial"),
    missing: days.length - observed.length,
  };
}

export function formatCount(value?: Count) {
  return hasObservation(value) ? value.value.toLocaleString() : missingValue;
}
export function percent(value: number | null | undefined) {
  return value == null || !Number.isFinite(value)
    ? missingValue
    : `${(value * 100).toFixed(1)}%`;
}
export function dateInZone(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
/** The last `days` report days, including today in the report timezone. */
export function initialRange(
  timezone = "Africa/Lagos",
  now = new Date(),
  days = 14,
) {
  const today = dateInZone(now, timezone);
  const end = new Date(`${today}T12:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}
export const rangePresets = [7, 14, 30, 90] as const;
/** The preset that matches the selected dates, if any. */
export function activePreset(
  from: string,
  to: string,
  timezone: string,
  now = new Date(),
) {
  return rangePresets.find((days) => {
    const range = initialRange(timezone, now, days);
    return range.from === from && range.to === to;
  });
}

/** Round axis steps (1, 2, 2.5 or 5 × 10ⁿ) covering `max`. Counts never get fractional ticks. */
export function niceScale(max: number, count = 4) {
  if (!(max > 0)) return { max: count, step: 1 };
  const rough = max / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10]
    .map((m) => m * power)
    .find((s) => s >= rough && Number.isInteger(s))!;
  return { max: Math.ceil(max / step) * step, step };
}
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
/** Axis ticks stay in full below 10,000 and compact on an axis that reaches it. */
export function axisLabel(value: number, axisMax: number) {
  return axisMax >= 10_000
    ? compact.format(value)
    : value.toLocaleString("en-US");
}
/** Stat values in full below 100,000, then compact (128.4K, 1.2M). */
export function formatMetric(value: number) {
  return Math.abs(value) >= 100_000
    ? compact.format(value)
    : value.toLocaleString("en-US");
}
export function formatUsd(value: number) {
  const size = Math.abs(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    ...(size >= 100_000
      ? { notation: "compact", maximumFractionDigits: 1 }
      : { maximumFractionDigits: size >= 10_000 ? 0 : 2 }),
  }).format(value);
}
export const exactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
/** "Tue, 18 Nov 2026" for a report day. */
export function dayLabel(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
/** "7 Nov, 18:30" in Lagos time, for compact activity rows. */
export function shortDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? missingValue
    : new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Africa/Lagos",
      }).format(date);
}
export function validRange(from: string, to: string) {
  const validDay = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  return (
    validDay(from) &&
    validDay(to) &&
    from <= to &&
    (Date.parse(to) - Date.parse(from)) / 86400000 < 366
  );
}
export function totalSlice(slices: Slice[]): Slice | undefined {
  // An ungrouped report has one slice. Grouped distinct-account counts are not additive.
  return slices.length === 1 ? slices[0] : undefined;
}
const regions =
  typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : undefined;

/** "Nigeria" for NG. Unknown codes stay as the code. */
export function countryName(code: string) {
  try {
    return regions?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Flag emoji from regional indicators, drawn with the bundled Twemoji flag font (`font-flag`). */
export function countryFlag(code: string) {
  return /^[A-Z]{2}$/.test(code)
    ? String.fromCodePoint(
        ...[...code].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65),
      )
    : "";
}

const referrerNames: Record<string, string> = {
  "t.co": "X (t.co)",
  "com.google.android.gm": "Gmail app",
  "com.google.android.googlequicksearchbox": "Google app",
  "org.telegram.messenger": "Telegram app",
  "com.linkedin.android": "LinkedIn app",
};

/** Hosts as recorded, with names for the few that hide where a visit came from. */
export function referrerLabel(host: string) {
  return referrerNames[host] ?? host;
}
/** The letter shown in a referrer's badge: "X" for X (t.co), "G" for google.com. */
export function referrerInitial(host: string) {
  return (referrerLabel(host).match(/[a-z0-9]/i)?.[0] ?? "#").toUpperCase();
}
const googleCountry = /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/;
/** The bundled brand logo for a referrer host or any of its subdomains, if there is one. */
export function referrerBrand(host: string): BrandIcon | undefined {
  const name = host.toLowerCase();
  return (
    brandIcons.find((brand) =>
      brand.hosts.some((item) => name === item || name.endsWith(`.${item}`)),
    ) ??
    (googleCountry.test(name)
      ? brandIcons.find((brand) => brand.title === "Google")
      : undefined)
  );
}
export function isOrenHost(host: string) {
  return /(^|\.)oren\.finance$/.test(host.toLowerCase());
}
export const badgeTones = ["violet", "blue", "green", "orange", "pink"] as const;
/** A stable tint for a referrer without a logo, so neighbouring sites look different. */
export function referrerTone(host: string) {
  let hash = 0;
  for (const letter of host) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
  return badgeTones[hash % badgeTones.length];
}
/** "13 Nov – 26 Nov 2026", with both years when the range crosses one. */
export function rangeLabel(from: string, to: string) {
  if (!validRange(from, to)) return "Choose dates";
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  const format = (date: Date, year: boolean) =>
    date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      ...(year ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });
  if (from === to) return format(end, true);
  return `${format(start, start.getUTCFullYear() !== end.getUTCFullYear())} – ${format(end, true)}`;
}

export function readable(value?: string | null) {
  return value ? value.replaceAll("_", " ") : missingValue;
}
export function shortId(value?: string | null) {
  return value
    ? value.length > 18
      ? `${value.slice(0, 8)}…${value.slice(-6)}`
      : value
    : missingValue;
}
