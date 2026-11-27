import { Temporal } from '@js-temporal/polyfill';
import type { UsMarketSessionState } from '../../../types/market-session';
import type {
  UsEquityCalendarSource,
  UsEquityClosure,
  UsEquityHours,
  UsEquitySessionMode,
  UsEquitySessionWindow,
  Weekday,
} from '../../../types/market-calendar';
import {
  NYSE_OFFICIAL_SCHEDULE,
  NYSE_SPECIAL_CLOSURES,
  type NyseScheduleEntry,
} from './nyse-schedule';

/**
 * US equity cash-session calendar: NYSE holidays, 1:00 p.m. ET early closes,
 * and the session clock Oren uses to stamp quotes.
 *
 * This answers "is the US cash market open", not "can this token be swapped
 * right now". Tokenized stocks trade on Solana around the clock; the cash
 * session still drives the reference price, on-chain liquidity, RFQ issuers,
 * and issuer mint/redeem windows. See us-equity-calendar.service.ts for the
 * issuer notes. Do not fork this table per issuer.
 *
 * Every date here is an America/New_York civil date (YYYY-MM-DD). Instants are
 * converted with Intl (instant -> New York clock) and Temporal (New York clock
 * -> instant), so DST is always handled by the tz database, never by a fixed
 * UTC offset.
 */
export const US_EQUITY_TIME_ZONE = 'America/New_York' as const;

/**
 * Holiday rules match NYSE practice from 2010 on (MLK Day since 1998,
 * Juneteenth since 2022, the 1:00 p.m. early-close pattern). Earlier years had
 * one-off early closes the rules do not model, so they are rejected.
 */
export const FIRST_SUPPORTED_YEAR = 2010;
export const LAST_SUPPORTED_YEAR = 2099;

/** Minutes after New York midnight. */
export const PRE_MARKET_OPEN_MINUTE = 4 * 60;
export const REGULAR_OPEN_MINUTE = 9 * 60 + 30;
export const REGULAR_CLOSE_MINUTE = 16 * 60;
export const EARLY_CLOSE_MINUTE = 13 * 60;
/** End of Oren's after-hours display window, also on early-close days. */
export const AFTER_HOURS_CLOSE_MINUTE = 20 * 60;

/** A date or year outside what the calendar can answer. HTTP maps this to 400. */
export class UsEquityCalendarRangeError extends RangeError {}

export interface UsEquityCalendarOptions {
  /** NYSE-published years. Defaults to NYSE_OFFICIAL_SCHEDULE. */
  official?: Readonly<Record<number, readonly NyseScheduleEntry[]>>;
  /** Pinned one-off closures. Defaults to NYSE_SPECIAL_CLOSURES. */
  specialClosures?: readonly NyseScheduleEntry[];
}

/** One New York civil date, classified. */
export interface UsEquityDay {
  date: string;
  weekday: Weekday;
  tradingDay: boolean;
  earlyClose: boolean;
  holidayName: string | null;
  closedReason: 'weekend' | 'holiday' | null;
  source: UsEquityCalendarSource;
  provisional: boolean;
}

export interface UsEquityYearClosures {
  year: number;
  source: UsEquityCalendarSource;
  provisional: boolean;
  closures: UsEquityClosure[];
}

interface ResolvedEntry extends NyseScheduleEntry {
  source: UsEquityCalendarSource;
}

interface YearSchedule {
  source: UsEquityCalendarSource;
  entries: Map<string, ResolvedEntry>;
}

const WEEKDAYS: readonly Weekday[] = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
];
const SUNDAY = 0;
const MONDAY = 1;
const THURSDAY = 4;
const SATURDAY = 6;
const MAX_ADJACENT_SEARCH_DAYS = 14;

export class UsEquityCalendar {
  private readonly official: Readonly<
    Record<number, readonly NyseScheduleEntry[]>
  >;
  private readonly specialClosures: readonly NyseScheduleEntry[];
  private readonly years = new Map<number, YearSchedule>();

  constructor(options: UsEquityCalendarOptions = {}) {
    this.official = options.official ?? NYSE_OFFICIAL_SCHEDULE;
    this.specialClosures = options.specialClosures ?? NYSE_SPECIAL_CLOSURES;
    for (const entry of [
      ...Object.values(this.official).flat(),
      ...this.specialClosures,
    ]) {
      parseCivilDate(entry.date);
    }
  }

  /** First and last NYSE-published year. Later years are computed and provisional. */
  officialCoverage(): { firstYear: number; lastYear: number; through: string } {
    const years = Object.keys(this.official).map(Number);
    const firstYear = Math.min(...years);
    const lastYear = Math.max(...years);
    return { firstYear, lastYear, through: `${lastYear}-12-31` };
  }

  day(date: string): UsEquityDay {
    const { year } = parseCivilDate(date);
    const schedule = this.schedule(year);
    const weekday = weekdayOf(date);
    const entry = schedule.entries.get(date);
    if (weekday === 'Sat' || weekday === 'Sun') {
      return {
        date,
        weekday,
        tradingDay: false,
        earlyClose: false,
        holidayName: null,
        closedReason: 'weekend',
        source: schedule.source,
        provisional: schedule.source === 'computed',
      };
    }
    const source = entry?.source ?? schedule.source;
    const full = entry?.kind === 'full_close';
    return {
      date,
      weekday,
      tradingDay: !full,
      earlyClose: entry?.kind === 'early_close',
      holidayName: entry?.name ?? null,
      closedReason: full ? 'holiday' : null,
      source,
      provisional: source === 'computed',
    };
  }

  /** Early-close days are trading days. Weekends and full closes are not. */
  isTradingDay(date: string): boolean {
    return this.day(date).tradingDay;
  }

  /** New York civil date and wall-clock minute for an instant. */
  etClock(at: Date): { date: string; minute: number; weekday: Weekday } {
    const bag: Record<string, string> = {};
    for (const part of newYorkClock.formatToParts(at)) {
      if (part.type !== 'literal') bag[part.type] = part.value;
    }
    let hour = Number(bag.hour);
    if (hour === 24) hour = 0;
    const date = `${bag.year}-${bag.month}-${bag.day}`;
    return {
      date,
      minute: hour * 60 + Number(bag.minute),
      weekday: weekdayOf(date),
    };
  }

  /** The ET civil date an instant falls on. */
  etDate(at: Date): string {
    return this.etClock(at).date;
  }

  /**
   * Session state at an instant, exactly as Oren has always stamped quotes:
   * weekend and holiday calendar days are `closed` from midnight to midnight
   * (Sunday evening included). On a trading day 00:00-04:00 and 20:00-24:00 ET
   * are `overnight`. After a 13:00 early close the state is `early_close`
   * until 20:00.
   */
  sessionStateAt(at: Date): UsMarketSessionState {
    const { date, minute } = this.etClock(at);
    const day = this.day(date);
    if (!day.tradingDay) return 'closed';
    const close = day.earlyClose ? EARLY_CLOSE_MINUTE : REGULAR_CLOSE_MINUTE;
    if (minute >= REGULAR_OPEN_MINUTE && minute < close) return 'regular';
    if (minute >= PRE_MARKET_OPEN_MINUTE && minute < REGULAR_OPEN_MINUTE)
      return 'pre_market';
    if (minute >= close && minute < AFTER_HOURS_CLOSE_MINUTE)
      return day.earlyClose ? 'early_close' : 'after_hours';
    return 'overnight';
  }

  isRegularOpen(at: Date): boolean {
    return this.sessionStateAt(at) === 'regular';
  }

  /** 04:00-20:00 ET on a trading day: pre-market, regular, and after-hours. */
  isExtendedOpen(at: Date): boolean {
    return this.isOpen(at, 'extended');
  }

  /** `any` also counts the overnight window; only `closed` days are shut. */
  isOpen(at: Date, mode: UsEquitySessionMode = 'regular'): boolean {
    const state = this.sessionStateAt(at);
    if (mode === 'regular') return state === 'regular';
    if (mode === 'extended') return state !== 'overnight' && state !== 'closed';
    return state !== 'closed';
  }

  getHours(date: string): UsEquityHours {
    const day = this.day(date);
    const base = {
      date,
      weekday: day.weekday,
      timeZone: US_EQUITY_TIME_ZONE,
      tradingDay: day.tradingDay,
      earlyClose: day.earlyClose,
      holidayName: day.holidayName,
      closedReason: day.closedReason,
      source: day.source,
      provisional: day.provisional,
    };
    if (!day.tradingDay) {
      return {
        ...base,
        sessions: null,
        regularOpenEt: null,
        regularCloseEt: null,
        regularOpenUtc: null,
        regularCloseUtc: null,
      };
    }
    const close = day.earlyClose ? EARLY_CLOSE_MINUTE : REGULAR_CLOSE_MINUTE;
    const window = (start: number, end: number): UsEquitySessionWindow => ({
      startEt: clock(start),
      endEt: clock(end),
      startUtc: etInstantIso(date, start),
      endUtc: etInstantIso(date, end),
    });
    const regular = window(REGULAR_OPEN_MINUTE, close);
    return {
      ...base,
      sessions: {
        preMarket: window(PRE_MARKET_OPEN_MINUTE, REGULAR_OPEN_MINUTE),
        regular,
        afterHours: window(close, AFTER_HOURS_CLOSE_MINUTE),
      },
      regularOpenEt: regular.startEt,
      regularCloseEt: regular.endEt,
      regularOpenUtc: regular.startUtc,
      regularCloseUtc: regular.endUtc,
    };
  }

  /** Full closes and early closes for a year, in date order. */
  listClosures(year: number): UsEquityYearClosures {
    const schedule = this.schedule(year);
    const closures = [...schedule.entries.values()]
      .filter((entry) => !isWeekend(entry.date))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((entry): UsEquityClosure => {
        const early = entry.kind === 'early_close';
        return {
          date: entry.date,
          weekday: weekdayOf(entry.date),
          kind: entry.kind,
          name: entry.name,
          closeEt: early ? clock(EARLY_CLOSE_MINUTE) : null,
          closeUtc: early ? etInstantIso(entry.date, EARLY_CLOSE_MINUTE) : null,
          source: entry.source,
          provisional: entry.source === 'computed',
        };
      });
    return {
      year,
      source: schedule.source,
      provisional: schedule.source === 'computed',
      closures,
    };
  }

  /** Next trading day strictly after `date`. Skips weekends and full closes only. */
  nextTradingDay(date: string): string {
    return this.adjacentTradingDay(date, 1);
  }

  /** Previous trading day strictly before `date`. */
  previousTradingDay(date: string): string {
    return this.adjacentTradingDay(date, -1);
  }

  /** The first regular-session open strictly after `at`. */
  nextRegularOpen(at: Date): Date {
    const date = this.etDate(at);
    if (this.isTradingDay(date)) {
      const open = etInstant(date, REGULAR_OPEN_MINUTE);
      if (at.getTime() < open.getTime()) return open;
    }
    return etInstant(this.nextTradingDay(date), REGULAR_OPEN_MINUTE);
  }

  /** The first regular-session close strictly after `at`. */
  nextRegularClose(at: Date): Date {
    const date = this.etDate(at);
    if (this.isTradingDay(date)) {
      const close = this.regularClose(date);
      if (at.getTime() < close.getTime()) return close;
    }
    return this.regularClose(this.nextTradingDay(date));
  }

  /** The latest regular-session close at or before `at`. */
  previousRegularClose(at: Date): Date {
    const date = this.etDate(at);
    if (this.isTradingDay(date)) {
      const close = this.regularClose(date);
      if (close.getTime() <= at.getTime()) return close;
    }
    return this.regularClose(this.previousTradingDay(date));
  }

  private regularClose(date: string): Date {
    return etInstant(
      date,
      this.day(date).earlyClose ? EARLY_CLOSE_MINUTE : REGULAR_CLOSE_MINUTE,
    );
  }

  private adjacentTradingDay(date: string, step: 1 | -1): string {
    let cursor = date;
    for (let i = 0; i < MAX_ADJACENT_SEARCH_DAYS; i += 1) {
      cursor = addDays(cursor, step);
      if (this.isTradingDay(cursor)) return cursor;
    }
    throw new UsEquityCalendarRangeError(`No trading day near ${date}`);
  }

  private schedule(year: number): YearSchedule {
    assertSupportedYear(year);
    const cached = this.years.get(year);
    if (cached) return cached;
    const published = this.official[year];
    const source: UsEquityCalendarSource = published ? 'official' : 'computed';
    const entries = new Map<string, ResolvedEntry>();
    for (const entry of published ?? computeNyseRules(year)) {
      entries.set(entry.date, { ...entry, source });
    }
    for (const entry of this.specialClosures) {
      if (parseCivilDate(entry.date).year === year)
        entries.set(entry.date, { ...entry, source: 'official' });
    }
    const schedule = { source, entries };
    this.years.set(year, schedule);
    return schedule;
  }
}

/**
 * NYSE holiday and early-close rules for one year, evaluated on New York
 * civil dates. NYSE_OFFICIAL_SCHEDULE overrides these inside published years.
 *
 * - New Year's Day, Juneteenth (from 2022), Independence Day, Christmas:
 *   Saturday is observed on Friday and Sunday on Monday, except that a
 *   Saturday New Year's Day is not observed at all (NYSE Rule 7.2).
 * - MLK Day 3rd Monday of January, Washington's Birthday 3rd Monday of
 *   February, Memorial Day last Monday of May, Labor Day 1st Monday of
 *   September, Thanksgiving 4th Thursday of November, Good Friday two days
 *   before Western Easter.
 * - 1:00 p.m. early closes on the Friday after Thanksgiving, on Christmas Eve
 *   when it is a weekday and not itself the observed holiday, and on July 3
 *   when it is a weekday and not itself the observed holiday. For July 3 that
 *   means whenever July 4 falls Tuesday to Friday (2018, 2019, 2024, 2025,
 *   2028), not only on Tuesdays.
 */
export function computeNyseRules(year: number): NyseScheduleEntry[] {
  assertSupportedYear(year);
  const full: NyseScheduleEntry[] = [];
  const add = (date: string, name: string) =>
    full.push({ date, kind: 'full_close', name });
  const addObserved = (date: string, name: string) => {
    const weekday = weekdayIndex(date);
    if (weekday === SATURDAY) add(addDays(date, -1), `${name} (observed)`);
    else if (weekday === SUNDAY) add(addDays(date, 1), `${name} (observed)`);
    else add(date, name);
  };

  const newYear = civilDate(year, 1, 1);
  if (weekdayIndex(newYear) !== SATURDAY)
    addObserved(newYear, "New Year's Day");
  add(nthWeekday(year, 1, MONDAY, 3), 'Martin Luther King, Jr. Day');
  add(nthWeekday(year, 2, MONDAY, 3), "Washington's Birthday");
  add(addDays(easterSunday(year), -2), 'Good Friday');
  add(lastWeekday(year, 5, MONDAY), 'Memorial Day');
  if (year >= 2022)
    addObserved(civilDate(year, 6, 19), 'Juneteenth National Independence Day');
  addObserved(civilDate(year, 7, 4), 'Independence Day');
  add(nthWeekday(year, 9, MONDAY, 1), 'Labor Day');
  const thanksgiving = nthWeekday(year, 11, THURSDAY, 4);
  add(thanksgiving, 'Thanksgiving Day');
  addObserved(civilDate(year, 12, 25), 'Christmas Day');

  const closed = new Set(full.map((entry) => entry.date));
  const early: NyseScheduleEntry[] = [];
  const addEarly = (date: string, name: string) => {
    if (!isWeekend(date) && !closed.has(date))
      early.push({ date, kind: 'early_close', name });
  };
  addEarly(civilDate(year, 7, 3), 'Day before Independence Day');
  addEarly(addDays(thanksgiving, 1), 'Day after Thanksgiving');
  addEarly(civilDate(year, 12, 24), 'Christmas Eve');

  return [...full, ...early].sort((a, b) => a.date.localeCompare(b.date));
}

/** Western (Gregorian) Easter Sunday, anonymous Gregorian computus. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return civilDate(year, month, day);
}

/** Strict YYYY-MM-DD for a real calendar date. */
export function isCivilDate(value: string): boolean {
  try {
    parseCivilDate(value);
    return true;
  } catch {
    return false;
  }
}

export function parseCivilDate(value: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new UsEquityCalendarRangeError(`Invalid date: ${value}`);
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  )
    throw new UsEquityCalendarRangeError(`Invalid date: ${value}`);
  return { year, month, day };
}

/** Civil-date arithmetic. No time zone is involved, so UTC math is exact. */
export function addDays(date: string, days: number): string {
  const { year, month, day } = parseCivilDate(date);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[weekdayIndex(date)];
}

/** The instant a New York wall-clock minute on `date` occurs. */
export function etInstant(date: string, minute: number): Date {
  const instant = Temporal.PlainDate.from(date)
    .toZonedDateTime({
      timeZone: US_EQUITY_TIME_ZONE,
      plainTime: new Temporal.PlainTime(Math.floor(minute / 60), minute % 60),
    })
    .toInstant();
  return new Date(instant.epochMilliseconds);
}

function etInstantIso(date: string, minute: number): string {
  return etInstant(date, minute).toISOString();
}

function clock(minute: number): string {
  const hours = String(Math.floor(minute / 60)).padStart(2, '0');
  const minutes = String(minute % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function assertSupportedYear(year: number) {
  if (
    !Number.isInteger(year) ||
    year < FIRST_SUPPORTED_YEAR ||
    year > LAST_SUPPORTED_YEAR
  )
    throw new UsEquityCalendarRangeError(
      `The US market calendar covers ${FIRST_SUPPORTED_YEAR}-${LAST_SUPPORTED_YEAR}`,
    );
}

function civilDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function weekdayIndex(date: string): number {
  const { year, month, day } = parseCivilDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function isWeekend(date: string): boolean {
  const weekday = weekdayIndex(date);
  return weekday === SATURDAY || weekday === SUNDAY;
}

function nthWeekday(
  year: number,
  month: number,
  weekday: number,
  n: number,
): string {
  const first = civilDate(year, month, 1);
  const offset = (weekday - weekdayIndex(first) + 7) % 7;
  return addDays(first, offset + (n - 1) * 7);
}

function lastWeekday(year: number, month: number, weekday: number): string {
  const nextMonthFirst =
    month === 12 ? civilDate(year + 1, 1, 1) : civilDate(year, month + 1, 1);
  const last = addDays(nextMonthFirst, -1);
  const offset = (weekdayIndex(last) - weekday + 7) % 7;
  return addDays(last, -offset);
}

const newYorkClock = new Intl.DateTimeFormat('en-US', {
  timeZone: US_EQUITY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export const usEquityCalendar = new UsEquityCalendar();
