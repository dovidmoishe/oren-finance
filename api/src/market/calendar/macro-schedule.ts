import { addDays, parseCivilDate, weekdayOf } from './us-equity-calendar';

export type PinnedKind =
  'cpi' | 'employment_situation' | 'ppi' | 'retail_sales';

export interface PinnedRelease {
  kind: PinnedKind;
  /** ET release date; every pinned release is at 8:30 a.m. ET. */
  date: string;
  /** The month the release covers, YYYY-MM. */
  referencePeriod: string;
}

/**
 * Release dates copied from the agencies' published schedules. bls.gov blocks
 * automated requests and the Census retail schedule is a plain web page, so
 * these are pinned like the NYSE holidays and FOMC meetings. Sources:
 * - BLS "Schedule of Releases" pages for CPI, the Employment Situation, and
 *   PPI (https://www.bls.gov/schedule/news_release/cpi.htm, empsit.htm,
 *   ppi.htm), all "08:30 AM", as published 15-24 Nov 2026.
 * - Census "Release Dates for 2026/2027", Advance Monthly Retail Trade
 *   Report, "Release Date at 8:30 am"
 *   (https://www.census.gov/retail/release_schedule.html).
 * Add the 2028 dates when the agencies publish them, and move a date here if
 * an agency reschedules one; the refresh cancels any future row this table
 * no longer lists.
 */
export const PINNED_SCHEDULE_VERIFIED_ON = '2026-11-27';
export const PINNED_SCHEDULE_COVERED_THROUGH = '2027-12-15';

const pinned = (
  kind: PinnedKind,
  rows: readonly (readonly [referencePeriod: string, date: string])[],
): PinnedRelease[] =>
  rows.map(([referencePeriod, date]) => ({ kind, date, referencePeriod }));

export const PINNED_RELEASES: readonly PinnedRelease[] = [
  ...pinned('cpi', [
    ['2026-10', '2026-11-10'],
    ['2026-11', '2026-12-10'],
    ['2026-12', '2027-01-13'],
    ['2027-01', '2027-02-11'],
    ['2027-02', '2027-03-10'],
    ['2027-03', '2027-04-13'],
    ['2027-04', '2027-05-12'],
    ['2027-05', '2027-06-10'],
    ['2027-06', '2027-07-14'],
    ['2027-07', '2027-08-11'],
    ['2027-08', '2027-09-14'],
    ['2027-09', '2027-10-14'],
    ['2027-10', '2027-11-10'],
    ['2027-11', '2027-12-10'],
  ]),
  ...pinned('employment_situation', [
    ['2026-10', '2026-11-06'],
    ['2026-11', '2026-12-04'],
    ['2026-12', '2027-01-08'],
    ['2027-01', '2027-02-05'],
    ['2027-02', '2027-03-05'],
    ['2027-03', '2027-04-02'],
    ['2027-04', '2027-05-07'],
    ['2027-05', '2027-06-04'],
    ['2027-06', '2027-07-02'],
    ['2027-07', '2027-08-06'],
    ['2027-08', '2027-09-03'],
    ['2027-09', '2027-10-08'],
    ['2027-10', '2027-11-05'],
    ['2027-11', '2027-12-03'],
  ]),
  ...pinned('ppi', [
    ['2026-10', '2026-11-13'],
    ['2026-11', '2026-12-15'],
    ['2026-12', '2027-01-14'],
    ['2027-01', '2027-02-12'],
    ['2027-02', '2027-03-12'],
    ['2027-03', '2027-04-14'],
    ['2027-04', '2027-05-13'],
    ['2027-05', '2027-06-11'],
    ['2027-06', '2027-07-15'],
    ['2027-07', '2027-08-10'],
    ['2027-08', '2027-09-10'],
    ['2027-09', '2027-10-15'],
    ['2027-10', '2027-11-12'],
    ['2027-11', '2027-12-15'],
  ]),
  ...pinned('retail_sales', [
    ['2026-09', '2026-10-15'],
    ['2026-10', '2026-11-17'],
    ['2026-11', '2026-12-16'],
    ['2026-12', '2027-01-15'],
    ['2027-01', '2027-02-17'],
    ['2027-02', '2027-03-16'],
    ['2027-03', '2027-04-16'],
    ['2027-04', '2027-05-14'],
    ['2027-05', '2027-06-16'],
    ['2027-06', '2027-07-16'],
    ['2027-07', '2027-08-16'],
    ['2027-08', '2027-09-16'],
    ['2027-09', '2027-10-15'],
    ['2027-10', '2027-11-16'],
    ['2027-11', '2027-12-15'],
  ]),
];

/** Federal holidays that can fall on a Thursday (5 U.S.C. 6103). */
const FIXED_THURSDAY_HOLIDAYS = new Set([
  '01-01',
  '06-19',
  '07-04',
  '11-11',
  '12-25',
]);

export function isThursdayFederalHoliday(date: string): boolean {
  if (weekdayOf(date) !== 'Thu') return false;
  const { month, day } = parseCivilDate(date);
  // Thanksgiving is the fourth Thursday of November: the 22nd to the 28th.
  if (month === 11 && day >= 22 && day <= 28) return true;
  return FIXED_THURSDAY_HOLIDAYS.has(date.slice(5));
}

export interface ClaimsRelease {
  /** ET release date. */
  date: string;
  /** The Saturday that ends the week the advance figure covers. */
  weekEnded: string;
}

/**
 * Weekly claims reports whose release date falls in [from, to]: Thursday, or
 * Wednesday when Thursday is a federal holiday (Thanksgiving week always).
 */
export function claimsReleases(from: string, to: string): ClaimsRelease[] {
  let thursday = addDays(from, -1);
  while (weekdayOf(thursday) !== 'Thu') thursday = addDays(thursday, 1);
  const releases: ClaimsRelease[] = [];
  for (; addDays(thursday, -1) <= to; thursday = addDays(thursday, 7)) {
    const date = isThursdayFederalHoliday(thursday)
      ? addDays(thursday, -1)
      : thursday;
    if (date >= from && date <= to)
      releases.push({ date, weekEnded: addDays(thursday, -5) });
  }
  return releases;
}

export interface ReferencePeriod {
  period: string;
  label: string;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "2026-11" -> "November 2026". */
export function monthLabel(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

/** "2026-11-21" -> "Week ending Nov 21, 2026". */
export function weekLabel(weekEnded: string): string {
  const { year, month, day } = parseCivilDate(weekEnded);
  return `Week ending ${MONTHS[month - 1].slice(0, 3)} ${day}, ${year}`;
}

/** "2026-12-10" -> "Dec 10, 2026". */
export function dayLabel(date: string): string {
  const { year, month, day } = parseCivilDate(date);
  return `${MONTHS[month - 1].slice(0, 3)} ${day}, ${year}`;
}

/** "2026-01" -> "2025-12". */
export function previousMonth(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, '0')}`;
}

/** "2026-Q1" -> "2025-Q4". */
export function previousQuarter(period: string): string {
  const [year, quarter] = period.split('-Q').map(Number);
  return quarter === 1 ? `${year - 1}-Q4` : `${year}-Q${quarter - 1}`;
}
