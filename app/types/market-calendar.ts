import type { MarketSession } from "./market-session";

/**
 * US equity cash-session hours (NYSE schedule) and official US macro
 * releases, mirrored from `api/types/market-calendar.ts`. This is the US
 * cash market, not on-chain token availability: tokenized stocks can trade on
 * Solana while this session is closed.
 */

export type UsEquityWeekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

export type UsEquityCalendarSource = "official" | "computed";

export interface UsEquitySessionWindow {
  /** America/New_York wall clock, HH:mm. */
  startEt: string;
  endEt: string;
  startUtc: string;
  endUtc: string;
}

export interface UsEquityHours {
  /** New York civil date, YYYY-MM-DD. */
  date: string;
  weekday: UsEquityWeekday;
  timeZone: "America/New_York";
  tradingDay: boolean;
  earlyClose: boolean;
  holidayName: string | null;
  closedReason: "weekend" | "holiday" | null;
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
  weekday: UsEquityWeekday;
  kind: "full_close" | "early_close";
  name: string;
  /** Regular-session close on early-close days (13:00 ET); null for full closes. */
  closeEt: string | null;
  closeUtc: string | null;
  source: UsEquityCalendarSource;
  provisional: boolean;
}

export interface UsEquityClosuresResponse {
  year: number;
  timeZone: "America/New_York";
  source: UsEquityCalendarSource;
  provisional: boolean;
  closures: UsEquityClosure[];
  sourceUrl: string;
  note: string;
}

export interface UsEquitySessionResponse extends MarketSession {
  scope: "us_equity_cash_session";
  timeZone: "America/New_York";
  date: string;
  session: "regular" | "extended" | "any";
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

export type MacroEventKind =
  | "fomc_decision"
  | "cpi"
  | "employment_situation"
  | "gdp"
  | "pce"
  | "ppi"
  | "retail_sales"
  | "jobless_claims";

export type OfficialAgencyId = "bls" | "bea" | "census" | "dol" | "frb";

export interface MarketEvent {
  id: string;
  family: "macro" | "company";
  kind: MacroEventKind;
  title: string;
  country: string;
  agencyId: OfficialAgencyId;
  agency: string;
  scheduledAt: string;
  /** New York civil date of the release. */
  dateEt: string;
  /** New York wall clock, HH:mm. Null when only the date is known. */
  timeEt: string | null;
  timePrecision: "date" | "datetime";
  /** customary = the agency's standing release time; its calendar lists the date only. */
  timeBasis: "published" | "customary";
  /** computed = the agency's standing cadence, such as weekly claims on Thursday. */
  dateBasis: "published" | "computed";
  status: "scheduled" | "released" | "cancelled";
  actual: number | null;
  previous: number | null;
  unit: "percent_change" | "percent_saar" | "thousands_change" | "count" | "percent_range" | null;
  unitLabel: string | null;
  actualText: string | null;
  previousText: string | null;
  referencePeriod: string | null;
  referenceLabel: string | null;
  sourceUrl: string;
  dataSourceUrl: string | null;
  retrievedAt: string | null;
  updatedAt: string;
}

export interface OfficialSource {
  id: OfficialAgencyId;
  name: string;
  url: string;
}

/** The agencies' API terms require every notice, unchanged, wherever the data appears. */
export interface OfficialAttribution {
  sources: OfficialSource[];
  notices: string[];
}

export interface MarketEventsResponse {
  from: string;
  to: string;
  timeZone: "America/New_York";
  kinds: MacroEventKind[];
  events: MarketEvent[];
  /** False when the official release calendar has not been loaded. */
  available: boolean;
  reason: string | null;
  syncedAt: string | null;
  attribution: OfficialAttribution;
  note: string;
}

/** One asset's close on a New York date against the previous close, from Tokens prices. */
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
  ticker: string | null;
}

export type MarketDayStatus = "upcoming" | "in_progress" | "complete" | "closed";

/** What happened in US markets on one New York date. Deterministic: no model wrote it. */
export interface MarketDayRecap {
  date: string;
  timeZone: "America/New_York";
  status: MarketDayStatus;
  hours: UsEquityHours;
  indexes: MarketDayMove[];
  gainers: MarketDayMove[];
  losers: MarketDayMove[];
  releases: MarketEvent[];
  headlines: MarketDayHeadline[];
  headlinesAvailable: boolean;
  notes: string[];
  attribution: OfficialAttribution;
  generatedAt: string;
}
