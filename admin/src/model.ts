import type { Count, Day, Permission, Session, Slice } from "./types";

export function hasPermission(session: Session, permission: string) {
  return (
    !session.mustChangePassword &&
    session.permissions.includes(permission as Permission)
  );
}
export const missingValue = "?";

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
export function initialRange(timezone = "Africa/Lagos", now = new Date()) {
  const today = dateInZone(now, timezone);
  const end = new Date(`${today}T12:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 13);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
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
