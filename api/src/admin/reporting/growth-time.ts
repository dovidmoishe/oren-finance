/** Civil dates for reports. Africa/Lagos is WAT (UTC+1) and does not observe DST. */

export const REPORT_TIMEZONES = ['UTC', 'Africa/Lagos'] as const;
export type ReportTimezone = (typeof REPORT_TIMEZONES)[number];

const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;

export function isReportTimezone(value: string): value is ReportTimezone {
  return (REPORT_TIMEZONES as readonly string[]).includes(value);
}

export function assertTimezone(value: string | undefined): ReportTimezone {
  const timezone = value ?? 'UTC';
  if (!isReportTimezone(timezone)) {
    throw new Error('timezone must be UTC or Africa/Lagos');
  }
  return timezone;
}

function shift(instant: Date, timezone: ReportTimezone): number {
  return (
    instant.getTime() + (timezone === 'Africa/Lagos' ? LAGOS_OFFSET_MS : 0)
  );
}

/** YYYY-MM-DD of an instant in the report timezone. */
export function zonedDay(instant: Date, timezone: ReportTimezone): string {
  return new Date(shift(instant, timezone)).toISOString().slice(0, 10);
}

/** Inclusive start and exclusive end of a civil day, as UTC instants. */
export function dayBounds(
  day: string,
  timezone: ReportTimezone,
): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`bad day ${day}`);
  const utcMidnight = Date.parse(`${day}T00:00:00.000Z`);
  if (Number.isNaN(utcMidnight)) throw new Error(`bad day ${day}`);
  const start =
    timezone === 'Africa/Lagos' ? utcMidnight - LAGOS_OFFSET_MS : utcMidnight;
  return { start: new Date(start), end: new Date(start + DAY_MS) };
}

export function eachDay(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    throw new Error('from and to must be YYYY-MM-DD with from <= to');
  }
  const days: string[] = [];
  for (let cursor = start; cursor <= end; cursor += DAY_MS) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
    if (days.length > MAX_RANGE_DAYS) {
      throw new Error(`range exceeds ${MAX_RANGE_DAYS} days`);
    }
  }
  return days;
}

export function weekStart(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - (weekday - 1));
  return date.toISOString().slice(0, 10);
}
