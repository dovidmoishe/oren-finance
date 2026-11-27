import type { MarketSession } from './market-session';

/**
 * US equity cash-session calendar (NYSE schedule) and official US macro
 * releases. This is the US cash market, not on-chain token availability:
 * tokenized stocks can trade on Solana when this session is closed.
 */

export type UsEquityTimeZone = 'America/New_York';

/** regular = 09:30-16:00 ET (13:00 on early closes); extended = 04:00-20:00 ET; any = extended plus overnight. */
export type UsEquitySessionMode = 'regular' | 'extended' | 'any';

/** official = NYSE-published schedule or a pinned special closure; computed = holiday rules. */
export type UsEquityCalendarSource = 'official' | 'computed';

export type UsEquityClosureKind = 'full_close' | 'early_close';

export type Weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

export interface UsEquitySessionWindow {
  /** America/New_York wall clock, HH:mm. */
  startEt: string;
  endEt: string;
  startUtc: string;
  endUtc: string;
}

export interface UsEquityHours {
  /** ET civil date, YYYY-MM-DD. */
  date: string;
  weekday: Weekday;
  timeZone: UsEquityTimeZone;
  tradingDay: boolean;
  earlyClose: boolean;
  /** Full-close holiday or early-close occasion, when there is one. */
  holidayName: string | null;
  closedReason: 'weekend' | 'holiday' | null;
  sessions: {
    preMarket: UsEquitySessionWindow;
    regular: UsEquitySessionWindow;
    afterHours: UsEquitySessionWindow;
  } | null;
  regularOpenEt: string | null;
  regularCloseEt: string | null;
  regularOpenUtc: string | null;
  regularCloseUtc: string | null;
  source: UsEquityCalendarSource;
  provisional: boolean;
}

export interface UsEquityClosure {
  date: string;
  weekday: Weekday;
  kind: UsEquityClosureKind;
  name: string;
  /** Regular-session close on early-close days (13:00 ET); null for full closes. */
  closeEt: string | null;
  closeUtc: string | null;
  source: UsEquityCalendarSource;
  provisional: boolean;
}

export interface UsEquityClosuresResponse {
  year: number;
  timeZone: UsEquityTimeZone;
  source: UsEquityCalendarSource;
  provisional: boolean;
  closures: UsEquityClosure[];
  sourceUrl: string;
  note: string;
}

export interface UsEquitySessionResponse extends MarketSession {
  scope: 'us_equity_cash_session';
  timeZone: UsEquityTimeZone;
  /** ET civil date of `observedAt`. */
  date: string;
  session: UsEquitySessionMode;
  /** Whether `observedAt` falls inside the requested `session`. */
  isOpen: boolean;
  tradingDay: boolean;
  earlyClose: boolean;
  holidayName: string | null;
  nextRegularOpen: string;
  nextRegularClose: string;
  previousRegularClose: string;
  hours: UsEquityHours;
  source: UsEquityCalendarSource;
  provisional: boolean;
  note: string;
}

export interface UsEquityTradingDayResponse {
  /** The date the search started from (excluded). */
  date: string;
  direction: 'next' | 'previous';
  tradingDay: string;
  hours: UsEquityHours;
  source: UsEquityCalendarSource;
  provisional: boolean;
}

export type MarketEventFamily = 'macro' | 'company';

export type MacroEventKind =
  | 'fomc_decision'
  | 'cpi'
  | 'employment_situation'
  | 'gdp'
  | 'pce'
  | 'ppi'
  | 'retail_sales'
  | 'jobless_claims';

export type MarketEventStatus = 'scheduled' | 'released' | 'cancelled';

export type MarketEventTimePrecision = 'date' | 'datetime';

/**
 * The agency that publishes a release: Bureau of Labor Statistics, Bureau of
 * Economic Analysis, Census Bureau, Department of Labor, Federal Reserve Board.
 */
export type OfficialAgencyId = 'bls' | 'bea' | 'census' | 'dol' | 'frb';

/**
 * published = the clock time printed on the agency's release schedule.
 * customary = the agency's standing release time; its calendar lists the date only.
 */
export type MarketEventTimeBasis = 'published' | 'customary';

/**
 * published = the agency's schedule lists this date.
 * computed = the agency's standing cadence, e.g. weekly claims on Thursday, or
 * Wednesday when that Thursday is a federal holiday.
 */
export type MarketEventDateBasis = 'published' | 'computed';

/** Official result units. There is no consensus or forecast field, by design. */
export type MarketEventUnit =
  | 'percent_change'
  | 'percent_saar'
  | 'thousands_change'
  | 'count'
  | 'percent_range';

export interface MarketEvent {
  id: string;
  family: MarketEventFamily;
  kind: MacroEventKind;
  title: string;
  country: string;
  agencyId: OfficialAgencyId;
  /** The publishing agency's name, for credit. */
  agency: string;
  scheduledAt: string;
  /** ET civil date of the release. */
  dateEt: string;
  /** ET wall clock, HH:mm. Null when only the date is known. */
  timeEt: string | null;
  timePrecision: MarketEventTimePrecision;
  timeBasis: MarketEventTimeBasis;
  dateBasis: MarketEventDateBasis;
  status: MarketEventStatus;
  actual: number | null;
  previous: number | null;
  unit: MarketEventUnit | null;
  unitLabel: string | null;
  actualText: string | null;
  previousText: string | null;
  /**
   * Period the release covers: YYYY-MM for monthly data, YYYY-Qn for GDP,
   * the week-ending date for claims, the effective date for an FOMC range.
   */
  referencePeriod: string | null;
  /** The same period in words, e.g. "November 2026" or "Q3 2026, second estimate". */
  referenceLabel: string | null;
  /** Official agency page for this release's schedule. */
  sourceUrl: string;
  /** Official agency page for the published value, once there is one. */
  dataSourceUrl: string | null;
  /** When Oren retrieved the published value from the agency. */
  retrievedAt: string | null;
  updatedAt: string;
}

export interface OfficialSource {
  id: OfficialAgencyId;
  name: string;
  url: string;
}

/**
 * Credit for the agencies behind the events in a response. Show every notice
 * unchanged wherever the data appears; the agencies' API terms require them.
 */
export interface OfficialAttribution {
  sources: OfficialSource[];
  notices: string[];
}

export interface MarketEventsResponse {
  from: string;
  to: string;
  timeZone: UsEquityTimeZone;
  kinds: MacroEventKind[];
  events: MarketEvent[];
  /** False when the official release calendar has not been loaded. */
  available: boolean;
  /** Why `events` is empty, or null when there is nothing to explain. */
  reason: string | null;
  syncedAt: string | null;
  attribution: OfficialAttribution;
  note: string;
}

export interface MarketCalendarDay {
  date: string;
  weekday: Weekday;
  tradingDay: boolean;
  earlyClose: boolean;
  holidayName: string | null;
  regularOpenEt: string | null;
  regularCloseEt: string | null;
  regularOpenUtc: string | null;
  regularCloseUtc: string | null;
  provisional: boolean;
}

export interface MarketCalendarResponse {
  scope: 'us_equity_cash_session';
  timeZone: UsEquityTimeZone;
  from: string;
  to: string;
  now: UsEquitySessionResponse;
  days: MarketCalendarDay[];
  events: MarketEvent[];
  eventsAvailable: boolean;
  eventsReason: string | null;
  notes: string[];
  attribution: OfficialAttribution;
}

/**
 * One asset's move on a New York date: that day's close against the previous
 * trading day's close (or the previous on-chain close when the US session was
 * shut). Prices are the tokenized-stock prices Oren trades, from Tokens.
 */
export interface MarketDayMove {
  assetId: string;
  ticker: string;
  name: string;
  close: number;
  previousClose: number;
  previousDate: string;
  /** Percent, e.g. 1.25 for +1.25%. */
  changePct: number;
}

export interface MarketDayHeadline {
  headline: string;
  source: string | null;
  url: string;
  publishedAt: string;
  /** The ticker whose feed carried the story. */
  ticker: string | null;
}

/**
 * upcoming = a future date; in_progress = today before the regular close;
 * complete = a finished trading day; closed = a weekend or full holiday.
 */
export type MarketDayStatus =
  'upcoming' | 'in_progress' | 'complete' | 'closed';

/** What happened in US markets on one New York date. Deterministic: no model wrote any of it. */
export interface MarketDayRecap {
  date: string;
  timeZone: UsEquityTimeZone;
  status: MarketDayStatus;
  hours: UsEquityHours;
  /** S&P 500, Nasdaq 100 and Russell 2000 tracking ETFs. */
  indexes: MarketDayMove[];
  /** Biggest up and down moves among large US names, three each. */
  gainers: MarketDayMove[];
  losers: MarketDayMove[];
  releases: MarketEvent[];
  headlines: MarketDayHeadline[];
  /** False when the date is outside what the news feeds still carry. */
  headlinesAvailable: boolean;
  notes: string[];
  attribution: OfficialAttribution;
  generatedAt: string;
}
