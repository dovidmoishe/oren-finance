import type { UsEquityClosureKind } from '../../../types/market-calendar';

/** One NYSE cash-session exception on an America/New_York civil date. */
export interface NyseScheduleEntry {
  date: string;
  kind: UsEquityClosureKind;
  name: string;
}

export const NYSE_HOURS_URL = 'https://www.nyse.com/trade/hours-calendars';

/**
 * NYSE Group's published equity holidays and 1:00 p.m. ET early closes,
 * announced 23 Dec 2025 and listed on the NYSE hours page:
 * https://ir.theice.com/press/news-details/2025/NYSE-Group-Announces-2026-2027-and-2028-Holiday-and-Early-Closings-Calendar/
 *
 * Inside these years this table is authoritative. The computed rules must
 * reproduce it exactly (see us-equity-calendar.spec.ts), which is how we know
 * the rules are trustworthy for later, provisional years. Add a year here only
 * from an NYSE publication, never from the rules.
 */
export const NYSE_OFFICIAL_SCHEDULE: Readonly<
  Record<number, readonly NyseScheduleEntry[]>
> = {
  2026: [
    { date: '2026-01-01', kind: 'full_close', name: "New Year's Day" },
    {
      date: '2026-01-19',
      kind: 'full_close',
      name: 'Martin Luther King, Jr. Day',
    },
    { date: '2026-02-16', kind: 'full_close', name: "Washington's Birthday" },
    { date: '2026-04-03', kind: 'full_close', name: 'Good Friday' },
    { date: '2026-05-25', kind: 'full_close', name: 'Memorial Day' },
    {
      date: '2026-06-19',
      kind: 'full_close',
      name: 'Juneteenth National Independence Day',
    },
    {
      date: '2026-07-03',
      kind: 'full_close',
      name: 'Independence Day (observed)',
    },
    { date: '2026-09-07', kind: 'full_close', name: 'Labor Day' },
    { date: '2026-11-26', kind: 'full_close', name: 'Thanksgiving Day' },
    { date: '2026-11-27', kind: 'early_close', name: 'Day after Thanksgiving' },
    { date: '2026-12-24', kind: 'early_close', name: 'Christmas Eve' },
    { date: '2026-12-25', kind: 'full_close', name: 'Christmas Day' },
  ],
  2027: [
    { date: '2027-01-01', kind: 'full_close', name: "New Year's Day" },
    {
      date: '2027-01-18',
      kind: 'full_close',
      name: 'Martin Luther King, Jr. Day',
    },
    { date: '2027-02-15', kind: 'full_close', name: "Washington's Birthday" },
    { date: '2027-03-26', kind: 'full_close', name: 'Good Friday' },
    { date: '2027-05-31', kind: 'full_close', name: 'Memorial Day' },
    {
      date: '2027-06-18',
      kind: 'full_close',
      name: 'Juneteenth National Independence Day (observed)',
    },
    {
      date: '2027-07-05',
      kind: 'full_close',
      name: 'Independence Day (observed)',
    },
    { date: '2027-09-06', kind: 'full_close', name: 'Labor Day' },
    { date: '2027-11-25', kind: 'full_close', name: 'Thanksgiving Day' },
    { date: '2027-11-26', kind: 'early_close', name: 'Day after Thanksgiving' },
    {
      date: '2027-12-24',
      kind: 'full_close',
      name: 'Christmas Day (observed)',
    },
  ],
  // New Year's Day 2028 is a Saturday and is not observed (NYSE Rule 7.2).
  2028: [
    {
      date: '2028-01-17',
      kind: 'full_close',
      name: 'Martin Luther King, Jr. Day',
    },
    { date: '2028-02-21', kind: 'full_close', name: "Washington's Birthday" },
    { date: '2028-04-14', kind: 'full_close', name: 'Good Friday' },
    { date: '2028-05-29', kind: 'full_close', name: 'Memorial Day' },
    {
      date: '2028-06-19',
      kind: 'full_close',
      name: 'Juneteenth National Independence Day',
    },
    {
      date: '2028-07-03',
      kind: 'early_close',
      name: 'Day before Independence Day',
    },
    { date: '2028-07-04', kind: 'full_close', name: 'Independence Day' },
    { date: '2028-09-04', kind: 'full_close', name: 'Labor Day' },
    { date: '2028-11-23', kind: 'full_close', name: 'Thanksgiving Day' },
    { date: '2028-11-24', kind: 'early_close', name: 'Day after Thanksgiving' },
    { date: '2028-12-25', kind: 'full_close', name: 'Christmas Day' },
  ],
};

/**
 * One-off closures NYSE announced outside the regular holiday rules: national
 * days of mourning, storms, and similar. Each entry replaces whatever the
 * rules or the published table say for that date. The 2026-2028 publication
 * has none. Add a new one here as soon as NYSE announces it.
 */
export const NYSE_SPECIAL_CLOSURES: readonly NyseScheduleEntry[] = [
  { date: '2012-10-29', kind: 'full_close', name: 'Hurricane Sandy' },
  { date: '2012-10-30', kind: 'full_close', name: 'Hurricane Sandy' },
  {
    date: '2018-12-05',
    kind: 'full_close',
    name: 'National Day of Mourning for President George H.W. Bush',
  },
  {
    date: '2025-01-09',
    kind: 'full_close',
    name: 'National Day of Mourning for President Jimmy Carter',
  },
];
