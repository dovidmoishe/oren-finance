import type {
  MacroEventKind,
  MarketEventDateBasis,
  MarketEventTimeBasis,
  MarketEventUnit,
  OfficialAgencyId,
} from '../../../types/market-calendar';

/**
 * The curated official US macro calendar. Every date, time, and published
 * value comes from the agency that publishes it, never from an aggregator:
 *
 * - BLS (CPI, Employment Situation, PPI): dates from BLS's release schedule,
 *   pinned in macro-schedule.ts because bls.gov blocks automated requests;
 *   values from the BLS Public Data API.
 * - BEA (GDP, PCE prices): periods and times from BEA's iCalendar release schedule;
 *   values from the BEA Data API, which needs BEA_API_KEY.
 * - Census Bureau (retail sales): dates from the Census retail release
 *   schedule, pinned; values from the Census Data API, which needs
 *   CENSUS_API_KEY.
 * - Labor Department (initial claims): the weekly Thursday 8:30 a.m. ET
 *   cadence; values from the ETA weekly claims data.
 * - Federal Reserve Board (FOMC): meeting dates pinned from the Fed calendar;
 *   the decision read from the FOMC statement.
 *
 * Release times were checked 27 Nov 2026 against each schedule: BLS "08:30
 * AM", BEA 13:30 UTC in winter (8:30 ET), Census "Release Date at 8:30 am".
 * No consensus, forecasts, ISM, or Conference Board data.
 */

export interface BlsResult {
  source: 'bls';
  seriesId: string;
  /** percent_change: from index levels. level_change: difference of levels. */
  measure: 'percent_change' | 'level_change';
}

export interface BeaResult {
  source: 'bea';
  /** NIPA table: T10101 = Table 1.1.1, T20807 = Table 2.8.7. */
  table: string;
  frequency: 'Q' | 'M';
  line: string;
}

export interface CensusResult {
  source: 'census';
  /** Advance Monthly Retail Trade: 44X72 = retail and food services, total. */
  category: string;
  /** MPCSM = monthly percent change in sales. */
  dataType: string;
}

export interface DolResult {
  source: 'dol';
}

export type ReleaseResult = (
  BlsResult | BeaResult | CensusResult | DolResult
) & {
  unit: MarketEventUnit;
  label: string;
  /** Agency page for people to check the published value. */
  dataUrl: string;
};

export interface ReleaseSpec {
  kind: Exclude<MacroEventKind, 'fomc_decision'>;
  title: string;
  agencyId: OfficialAgencyId;
  /** America/New_York release time, HH:mm. */
  timeEt: string;
  timeBasis: MarketEventTimeBasis;
  dateBasis: MarketEventDateBasis;
  /** The agency page that lists this release's dates. */
  scheduleUrl: string;
  result: ReleaseResult;
}

export const RELEASES: readonly ReleaseSpec[] = [
  {
    kind: 'cpi',
    title: 'Consumer Price Index (CPI)',
    agencyId: 'bls',
    timeEt: '08:30',
    timeBasis: 'published',
    dateBasis: 'published',
    scheduleUrl: 'https://www.bls.gov/schedule/news_release/cpi.htm',
    result: {
      source: 'bls',
      seriesId: 'CUSR0000SA0',
      measure: 'percent_change',
      unit: 'percent_change',
      label: 'CPI-U all items, change from prior month, seasonally adjusted',
      dataUrl: 'https://data.bls.gov/timeseries/CUSR0000SA0',
    },
  },
  {
    kind: 'employment_situation',
    title: 'Employment Situation (nonfarm payrolls)',
    agencyId: 'bls',
    timeEt: '08:30',
    timeBasis: 'published',
    dateBasis: 'published',
    scheduleUrl: 'https://www.bls.gov/schedule/news_release/empsit.htm',
    result: {
      source: 'bls',
      seriesId: 'CES0000000001',
      measure: 'level_change',
      unit: 'thousands_change',
      label:
        'Total nonfarm payrolls, change from prior month, seasonally adjusted',
      dataUrl: 'https://data.bls.gov/timeseries/CES0000000001',
    },
  },
  {
    kind: 'ppi',
    title: 'Producer Price Index (PPI)',
    agencyId: 'bls',
    timeEt: '08:30',
    timeBasis: 'published',
    dateBasis: 'published',
    scheduleUrl: 'https://www.bls.gov/schedule/news_release/ppi.htm',
    result: {
      source: 'bls',
      seriesId: 'WPSFD4',
      measure: 'percent_change',
      unit: 'percent_change',
      label: 'PPI final demand, change from prior month, seasonally adjusted',
      dataUrl: 'https://data.bls.gov/timeseries/WPSFD4',
    },
  },
  {
    kind: 'gdp',
    title: 'Gross Domestic Product (GDP)',
    agencyId: 'bea',
    timeEt: '08:30',
    timeBasis: 'published',
    dateBasis: 'published',
    scheduleUrl: 'https://www.bea.gov/news/schedule',
    result: {
      source: 'bea',
      table: 'T10101',
      frequency: 'Q',
      line: '1',
      unit: 'percent_saar',
      label:
        'Real GDP, change from prior quarter, seasonally adjusted annual rate',
      dataUrl: 'https://www.bea.gov/data/gdp/gross-domestic-product',
    },
  },
  {
    kind: 'pce',
    title: 'PCE price index (Personal Income and Outlays)',
    agencyId: 'bea',
    timeEt: '08:30',
    timeBasis: 'published',
    dateBasis: 'published',
    scheduleUrl: 'https://www.bea.gov/news/schedule',
    result: {
      source: 'bea',
      table: 'T20807',
      frequency: 'M',
      line: '1',
      unit: 'percent_change',
      label: 'PCE price index, change from prior month',
      dataUrl:
        'https://www.bea.gov/data/personal-consumption-expenditures-price-index',
    },
  },
  {
    kind: 'retail_sales',
    title: 'Retail sales (advance estimate)',
    agencyId: 'census',
    timeEt: '08:30',
    timeBasis: 'published',
    dateBasis: 'published',
    scheduleUrl: 'https://www.census.gov/retail/release_schedule.html',
    result: {
      source: 'census',
      category: '44X72',
      dataType: 'MPCSM',
      unit: 'percent_change',
      label:
        'Retail and food services sales, change from prior month, seasonally adjusted',
      dataUrl: 'https://www.census.gov/retail/index.html',
    },
  },
  {
    // The weekly claims report comes out Thursday at 8:30 a.m. ET, or the
    // Wednesday before when Thursday is a federal holiday. The Labor
    // Department publishes no calendar, so dates are computed and labeled.
    kind: 'jobless_claims',
    title: 'Initial jobless claims',
    agencyId: 'dol',
    timeEt: '08:30',
    timeBasis: 'customary',
    dateBasis: 'computed',
    scheduleUrl: 'https://oui.doleta.gov/unemploy/claims.asp',
    result: {
      source: 'dol',
      unit: 'count',
      label: 'Initial claims, seasonally adjusted',
      dataUrl: 'https://www.dol.gov/ui/data.pdf',
    },
  },
];

export interface FomcMeeting {
  /** Original decision date; keep this ID when rescheduling the meeting. */
  id: string;
  start: string;
  /** Decision day: the statement is released at the end of the meeting. */
  end: string;
  summaryOfEconomicProjections?: true;
  tentative?: true;
  label?: string;
}

/**
 * FOMC meetings, copied from the Fed calendar (last updated there
 * 18 Nov 2026). The Fed lists dates only; the policy statement is
 * customarily released at 2:00 p.m. ET on the final day. The Fed marks 2027
 * dates tentative until each is confirmed at the meeting before it.
 * https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
 */
export const FOMC_MEETINGS: readonly FomcMeeting[] = [
  { id: '2026-01-28', start: '2026-01-27', end: '2026-01-28' },
  {
    id: '2026-03-18',
    start: '2026-03-17',
    end: '2026-03-18',
    summaryOfEconomicProjections: true,
  },
  { id: '2026-04-29', start: '2026-04-28', end: '2026-04-29' },
  {
    id: '2026-06-17',
    start: '2026-06-16',
    end: '2026-06-17',
    summaryOfEconomicProjections: true,
  },
  { id: '2026-07-29', start: '2026-07-28', end: '2026-07-29' },
  {
    id: '2026-09-16',
    start: '2026-09-15',
    end: '2026-09-16',
    summaryOfEconomicProjections: true,
  },
  { id: '2026-10-28', start: '2026-10-27', end: '2026-10-28' },
  {
    id: '2026-12-09',
    start: '2026-12-08',
    end: '2026-12-09',
    summaryOfEconomicProjections: true,
  },
  { id: '2027-01-27', start: '2027-01-26', end: '2027-01-27', tentative: true },
  { id: '2027-03-17', start: '2027-03-16', end: '2027-03-17', tentative: true },
  { id: '2027-04-28', start: '2027-04-27', end: '2027-04-28', tentative: true },
  { id: '2027-06-09', start: '2027-06-08', end: '2027-06-09', tentative: true },
  { id: '2027-07-28', start: '2027-07-27', end: '2027-07-28', tentative: true },
  { id: '2027-09-15', start: '2027-09-14', end: '2027-09-15', tentative: true },
  {
    id: '2027-10-27',
    start: '2027-10-26',
    end: '2027-10-27',
    tentative: true,
    label: 'Monetary Policy Strategy Meeting',
  },
  { id: '2027-11-17', start: '2027-11-16', end: '2027-11-17', tentative: true },
  { id: '2028-01-26', start: '2028-01-25', end: '2028-01-26', tentative: true },
];

export const FOMC_DECISION = {
  kind: 'fomc_decision' as const,
  title: 'FOMC rate decision',
  agencyId: 'frb' as const,
  timeEt: '14:00',
  timeBasis: 'customary' as const,
  dateBasis: 'published' as const,
  sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  /** The statement for a decision day, e.g. monetary20261209a.htm. */
  statementUrl: (date: string) =>
    `https://www.federalreserve.gov/newsevents/pressreleases/monetary${date.split('-').join('')}a.htm`,
};

export const MACRO_EVENT_KINDS: readonly MacroEventKind[] = [
  FOMC_DECISION.kind,
  ...RELEASES.map((release) => release.kind),
];

export const MACRO_EVENT_TITLES: Readonly<Record<MacroEventKind, string>> =
  Object.fromEntries([
    [FOMC_DECISION.kind, FOMC_DECISION.title],
    ...RELEASES.map((release) => [release.kind, release.title]),
  ]) as Record<MacroEventKind, string>;

export function isMacroEventKind(value: string): value is MacroEventKind {
  return (MACRO_EVENT_KINDS as readonly string[]).includes(value);
}

export function releaseSpec(kind: string): ReleaseSpec | undefined {
  return RELEASES.find((release) => release.kind === kind);
}
