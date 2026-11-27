import type { OfficialAgencyId } from '../../../types/market-calendar';
import {
  FOMC_DECISION,
  FOMC_MEETINGS,
  MACRO_EVENT_KINDS,
  RELEASES,
  releaseSpec,
  type BeaResult,
  type BlsResult,
  type CensusResult,
  type FomcMeeting,
  type ReleaseSpec,
} from './macro-catalog';
import {
  PINNED_RELEASES,
  PINNED_SCHEDULE_COVERED_THROUGH,
  claimsReleases,
  dayLabel,
  gdpReference,
  monthLabel,
  personalIncomeReference,
  previousMonth,
  previousQuarter,
  weekLabel,
  type ReferencePeriod,
} from './macro-schedule';
import { OFFICIAL_AGENCIES } from './market-calendar.copy';
import type {
  MarketEventScheduleRow,
  MarketEventStore,
  StoredMarketEvent,
} from './market-events.repository';
import {
  OfficialSourceError,
  parseFomcDecision,
  type ClaimsHeadline,
  type ClaimsWeek,
  type OfficialDataApi,
  type PeriodValue,
} from './official-data.client';
import {
  UsEquityCalendar,
  addDays,
  etInstant,
  usEquityCalendar,
} from './us-equity-calendar';

export const MARKET_EVENTS_SYNC_JOB = 'us-macro-calendar';

/** Released events this recent still get their published value filled in. */
export const RESULT_LOOKBACK_DAYS = 35;

/** Weekly claims dates are computed this far ahead. */
export const CLAIMS_HORIZON_DAYS = 100;

/** Warn this long before the pinned BLS and Census dates run out. */
export const SCHEDULE_WARNING_DAYS = 60;

/**
 * BEA's second and third GDP estimates revise a quarter that already has a
 * value. Without a revision date in the table notes, wait this long after
 * the release before trusting the table.
 */
const BEA_REVISION_WAIT_MS = 24 * 3_600_000;

export interface MarketEventsSyncReport {
  scheduled: number;
  cancelled: number;
  released: number;
  waiting: number;
  /**
   * Releases not read before the next release of the same kind. The BLS, BEA
   * and Census APIs serve only the latest figures, so these keep no value.
   */
  missed: number;
  /** Kinds whose values need a key this server does not have. */
  skipped: string[];
  failures: string[];
  warnings: string[];
}

/**
 * One refresh pass: the schedule from each agency (pinned, computed, or
 * fetched), then published values for releases that have happened. Values
 * come only from the agency that publishes them, are stored at the agency's
 * published precision, and never include a consensus or forecast.
 */
export class MarketEventsSync {
  constructor(
    private readonly api: OfficialDataApi,
    private readonly store: MarketEventStore,
    private readonly calendar: UsEquityCalendar = usEquityCalendar,
  ) {}

  async run(now: Date = new Date()): Promise<MarketEventsSyncReport> {
    const report: MarketEventsSyncReport = {
      scheduled: 0,
      cancelled: 0,
      released: 0,
      waiting: 0,
      missed: 0,
      skipped: [],
      failures: [],
      warnings: [],
    };
    const today = this.calendar.etDate(now);
    const startOfToday = etInstant(today, 0);
    const lookback = addDays(today, -RESULT_LOOKBACK_DAYS);
    // Pinned and computed schedules are authoritative: a future row they no
    // longer list is cancelled.
    await this.seed(
      report,
      FOMC_MEETINGS.filter((meeting) => meeting.end >= lookback).map(fomcRow),
      startOfToday,
    );
    for (const spec of RELEASES) {
      if (spec.result.source === 'bea') continue;
      const rows =
        spec.result.source === 'dol'
          ? claimsReleases(lookback, addDays(today, CLAIMS_HORIZON_DAYS)).map(
              (release) =>
                releaseRow(spec, release.date, {
                  period: release.weekEnded,
                  label: weekLabel(release.weekEnded),
                }),
            )
          : PINNED_RELEASES.filter(
              (release) =>
                release.kind === spec.kind && release.date >= lookback,
            ).map((release) =>
              releaseRow(spec, release.date, {
                period: release.referencePeriod,
                label: monthLabel(release.referencePeriod),
              }),
            );
      await this.seed(report, rows, startOfToday);
    }

    // BEA publishes its schedule as JSON with exact times.
    try {
      const dates = await this.api.beaReleaseDates();
      for (const spec of RELEASES) {
        if (spec.result.source !== 'bea') continue;
        const rows = (
          spec.kind === 'gdp' ? dates.gdp : dates.personalIncomeAndOutlays
        )
          .map((instant) => beaRow(spec, new Date(instant), this.calendar))
          .filter((row) => row.raw.dateEt >= lookback);
        // Only an answer that still lists future dates can retire one; an
        // empty or truncated answer never cancels the calendar.
        await this.seed(
          report,
          rows,
          startOfToday,
          rows.some((row) => row.scheduledAt >= startOfToday),
        );
      }
    } catch (error) {
      report.failures.push(`bea-schedule:${failureCode(error)}`);
    }

    const history = await this.store.releaseHistory({
      kinds: MACRO_EVENT_KINDS,
      from: etInstant(lookback, 0),
      to: now,
    });
    const latest = new Map<string, number>();
    for (const event of history) {
      latest.set(
        event.kind,
        Math.max(
          latest.get(event.kind) ?? -Infinity,
          event.scheduledAt.getTime(),
        ),
      );
    }
    const byAgency = new Map<OfficialAgencyId, StoredMarketEvent[]>();
    for (const event of history) {
      if (event.dateStatus !== 'scheduled') continue;
      const agency =
        event.kind === FOMC_DECISION.kind
          ? 'frb'
          : releaseSpec(event.kind)?.agencyId;
      if (!agency) continue;
      // The BLS, BEA and Census APIs serve only the latest figures. Read after
      // the next release of its kind, a release would show revised numbers as
      // its own (a second GDP estimate as the advance one), so it keeps no
      // value. FOMC statements stay as issued, and older claims weeks are
      // backfilled with revised levels, labeled by week.
      if (
        agency !== 'frb' &&
        agency !== 'dol' &&
        (latest.get(event.kind) ?? -Infinity) > event.scheduledAt.getTime()
      ) {
        report.missed += 1;
        continue;
      }
      byAgency.set(agency, [...(byAgency.get(agency) ?? []), event]);
    }
    await this.fillFomc(byAgency.get('frb') ?? [], now, report);
    await this.fillBls(byAgency.get('bls') ?? [], now, report);
    await this.fillBea(byAgency.get('bea') ?? [], now, report);
    await this.fillCensus(byAgency.get('census') ?? [], now, report);
    await this.fillClaims(byAgency.get('dol') ?? [], now, report);

    if (addDays(today, SCHEDULE_WARNING_DAYS) > PINNED_SCHEDULE_COVERED_THROUGH)
      report.warnings.push(
        `pinned_schedule_ends_${PINNED_SCHEDULE_COVERED_THROUGH}`,
      );
    return report;
  }

  private async seed(
    report: MarketEventsSyncReport,
    rows: MarketEventScheduleRow[],
    startOfToday: Date,
    mayCancel = true,
  ): Promise<void> {
    if (!rows.length) return;
    await this.store.upsertSchedule(rows);
    report.scheduled += rows.length;
    if (mayCancel)
      report.cancelled += await this.store.cancelMissing({
        source: rows[0].source,
        kind: rows[0].kind,
        keep: rows.map((row) => row.sourceEventId),
        from: startOfToday,
      });
  }

  /** The decision and the range it set, read from the FOMC statement. */
  private async fillFomc(
    events: StoredMarketEvent[],
    now: Date,
    report: MarketEventsSyncReport,
  ): Promise<void> {
    for (const event of events) {
      const date =
        text(event.raw.dateEt) ?? this.calendar.etDate(event.scheduledAt);
      let statement: string | null;
      try {
        statement = await this.api.fomcStatement(date);
      } catch (error) {
        report.failures.push(`fomc_decision-result:${failureCode(error)}`);
        report.waiting += 1;
        continue;
      }
      // Not published yet. Try again on the next pass.
      if (statement === null) {
        report.waiting += 1;
        continue;
      }
      const decision = parseFomcDecision(statement);
      if (!decision) {
        report.failures.push('fomc_decision-result:unparsed');
        report.waiting += 1;
        continue;
      }
      // The new range takes effect the day after the decision.
      const effective = addDays(date, 1);
      await this.store.recordResult(event.id, {
        actual: decision.upper,
        previous: decision.previousUpper,
        unit: 'percent_range',
        raw: {
          result: {
            agencyId: FOMC_DECISION.agencyId,
            label: 'Federal funds target range',
            action: decision.action,
            lowerActual: decision.lower,
            lowerPrevious: decision.previousLower,
            effectiveDate: effective,
            referencePeriod: effective,
            referenceLabel: `Effective ${dayLabel(effective)}`,
            url: FOMC_DECISION.statementUrl(date),
            retrievedAt: now.toISOString(),
          },
        },
      });
      report.released += 1;
    }
  }

  /** CPI, payrolls, and PPI from the BLS Public Data API, in one request. */
  private async fillBls(
    events: StoredMarketEvent[],
    now: Date,
    report: MarketEventsSyncReport,
  ): Promise<void> {
    const work = this.withSpecs(events, report);
    if (!work.length) return;
    const years = work.map(({ period }) => Number(period.slice(0, 4)));
    const seriesIds = [
      ...new Set(work.map(({ spec }) => (spec.result as BlsResult).seriesId)),
    ];
    const range = { start: Math.min(...years) - 1, end: Math.max(...years) };
    let series: Map<string, PeriodValue[]>;
    try {
      series = await this.api
        .blsSeries(seriesIds, range)
        .catch((error: unknown) => {
          // BLS keys expire yearly. Keyless access covers this one request a
          // run, so a rejected key must not stop CPI, payrolls and PPI.
          if (
            !(error instanceof OfficialSourceError) ||
            error.code !== 'key_rejected'
          )
            throw error;
          report.warnings.push('bls_key_rejected');
          return this.api.blsSeries(seriesIds, { ...range, keyless: true });
        });
    } catch (error) {
      report.failures.push(`bls-result:${failureCode(error)}`);
      report.waiting += work.length;
      return;
    }
    for (const { event, spec, period } of work) {
      const result = spec.result as BlsResult;
      const value = valueAt(series.get(result.seriesId) ?? []);
      const prior = previousMonth(period);
      const before = previousMonth(prior);
      // BLS adds the month only when the release is out.
      if (value(period) === null) {
        report.waiting += 1;
        continue;
      }
      const change = (current: number | null, base: number | null) =>
        current === null || base === null || base === 0
          ? null
          : result.measure === 'percent_change'
            ? roundTenth((current / base - 1) * 100)
            : Math.round(current - base);
      await this.record(event, spec, now, {
        actual: change(value(period), value(prior)),
        previous: change(value(prior), value(before)),
        period,
        previousPeriod: prior,
        extra: { seriesId: result.seriesId },
      });
      report.released += 1;
    }
  }

  /** GDP and PCE prices from the BEA Data API. Needs BEA_API_KEY. */
  private async fillBea(
    events: StoredMarketEvent[],
    now: Date,
    report: MarketEventsSyncReport,
  ): Promise<void> {
    const work = this.withSpecs(events, report);
    if (!work.length) return;
    if (!this.api.configured.bea) {
      this.skip(report, work);
      return;
    }
    const tables = new Map<string, typeof work>();
    for (const item of work) {
      const { table } = item.spec.result as BeaResult;
      tables.set(table, [...(tables.get(table) ?? []), item]);
    }
    for (const [table, items] of tables) {
      const { frequency, line } = items[0].spec.result as BeaResult;
      const years = items.flatMap(({ period }) => {
        const year = Number(period.slice(0, 4));
        return [year - 1, year];
      });
      let data: Awaited<ReturnType<OfficialDataApi['beaTable']>>;
      try {
        data = await this.api.beaTable({
          table,
          frequency,
          years: [...new Set(years)].sort(),
        });
      } catch (error) {
        report.failures.push(
          `${items[0].spec.kind}-result:${failureCode(error)}`,
        );
        report.waiting += items.length;
        continue;
      }
      const { rows, lastRevised } = data;
      const value = (period: string) =>
        rows.find((row) => row.line === line && row.period === period)?.value ??
        null;
      for (const { event, spec, period } of items) {
        const prior =
          frequency === 'Q' ? previousQuarter(period) : previousMonth(period);
        const actual = value(period);
        if (actual === null || !beaTableCurrent(event, lastRevised, now)) {
          report.waiting += 1;
          continue;
        }
        await this.record(event, spec, now, {
          actual,
          previous: value(prior),
          period,
          previousPeriod: prior,
          extra: { table, line, ...(lastRevised ? { lastRevised } : {}) },
        });
        report.released += 1;
      }
    }
  }

  /** Advance retail sales from the Census Data API. Needs CENSUS_API_KEY. */
  private async fillCensus(
    events: StoredMarketEvent[],
    now: Date,
    report: MarketEventsSyncReport,
  ): Promise<void> {
    const work = this.withSpecs(events, report);
    if (!work.length) return;
    if (!this.api.configured.census) {
      this.skip(report, work);
      return;
    }
    const { category, dataType } = work[0].spec.result as CensusResult;
    const earliest = work.map(({ period }) => period).sort()[0];
    let values: PeriodValue[];
    try {
      values = await this.api.censusRetail({
        category,
        dataType,
        from: previousMonth(earliest),
      });
    } catch (error) {
      report.failures.push(`retail_sales-result:${failureCode(error)}`);
      report.waiting += work.length;
      return;
    }
    const value = valueAt(values);
    for (const { event, spec, period } of work) {
      const actual = value(period);
      if (actual === null) {
        report.waiting += 1;
        continue;
      }
      const prior = previousMonth(period);
      await this.record(event, spec, now, {
        actual,
        previous: value(prior),
        period,
        previousPeriod: prior,
        extra: { category, dataType },
      });
      report.released += 1;
    }
  }

  /**
   * Seasonally adjusted initial claims. This week's report comes from the
   * Labor Department's news release (the advance figure, and the prior week
   * as revised in it). ETA's weekly data trails the release by a few weeks,
   * so it only backfills older weeks, with their revised levels.
   */
  private async fillClaims(
    events: StoredMarketEvent[],
    now: Date,
    report: MarketEventsSyncReport,
  ): Promise<void> {
    const work = this.withSpecs(events, report);
    if (!work.length) return;
    let headline: ClaimsHeadline | null = null;
    try {
      headline = await this.api.latestClaimsRelease();
    } catch (error) {
      report.failures.push(`jobless_claims-release:${failureCode(error)}`);
    }
    const fromRelease = (period: string) =>
      headline && period.slice(5) === headline.weekEnded ? headline : null;
    const older = work.filter(({ period }) => !fromRelease(period));
    const weeks: ClaimsWeek[] = [];
    const years = new Set(
      older.flatMap(({ period }) => [
        Number(period.slice(0, 4)),
        Number(addDays(period, -7).slice(0, 4)),
      ]),
    );
    try {
      for (const year of [...years].sort())
        weeks.push(...(await this.api.weeklyClaims(year)));
    } catch (error) {
      report.failures.push(`jobless_claims-result:${failureCode(error)}`);
    }
    const value = (weekEnded: string) =>
      weeks.find((week) => week.weekEnded === weekEnded)?.initialClaims ?? null;
    for (const { event, spec, period } of work) {
      const prior = addDays(period, -7);
      const release = fromRelease(period);
      const actual = release ? release.initialClaims : value(period);
      if (actual === null) {
        report.waiting += 1;
        continue;
      }
      await this.record(event, spec, now, {
        actual,
        previous: release ? release.previous : value(prior),
        period,
        previousPeriod: prior,
        extra: { figure: release ? 'advance' : 'revised' },
      });
      report.released += 1;
    }
  }

  private withSpecs(
    events: StoredMarketEvent[],
    report: MarketEventsSyncReport,
  ) {
    return events.flatMap((event) => {
      const spec = releaseSpec(event.kind);
      const period = text(event.raw.referencePeriod);
      if (spec && period) return [{ event, spec, period }];
      report.waiting += 1;
      return [];
    });
  }

  private skip(
    report: MarketEventsSyncReport,
    work: { spec: ReleaseSpec }[],
  ): void {
    for (const { spec } of work) {
      const reason = `${spec.kind}:no_key`;
      if (!report.skipped.includes(reason)) report.skipped.push(reason);
    }
    report.waiting += work.length;
  }

  private async record(
    event: StoredMarketEvent,
    spec: ReleaseSpec,
    now: Date,
    input: {
      actual: number | null;
      previous: number | null;
      period: string;
      previousPeriod: string;
      extra: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.store.recordResult(event.id, {
      actual: input.actual,
      previous: input.previous,
      unit: spec.result.unit,
      raw: {
        result: {
          agencyId: spec.agencyId,
          label: spec.result.label,
          referencePeriod: input.period,
          referenceLabel:
            text(event.raw.referenceLabel) ??
            referenceLabel(spec, input.period),
          previousPeriod: input.previousPeriod,
          url: spec.result.dataUrl,
          retrievedAt: now.toISOString(),
          ...input.extra,
        },
      },
    });
  }
}

export function releaseRow(
  spec: ReleaseSpec,
  date: string,
  reference: ReferencePeriod & { estimate?: string },
  at?: Date,
): MarketEventScheduleRow {
  const scheduledAt = at ?? etInstant(date, minutes(spec.timeEt));
  return {
    family: 'macro',
    kind: spec.kind,
    title: spec.title,
    country: 'US',
    scheduledAt,
    timePrecision: 'datetime',
    source: spec.agencyId,
    sourceEventId: `${spec.kind}:${date}`,
    sourceUrl: spec.scheduleUrl,
    raw: {
      agencyId: spec.agencyId,
      agency: OFFICIAL_AGENCIES[spec.agencyId].name,
      dateEt: date,
      timeEt: clock(usEquityCalendar.etClock(scheduledAt).minute),
      timeBasis: spec.timeBasis,
      dateBasis: spec.dateBasis,
      referencePeriod: reference.period,
      referenceLabel: reference.label,
      ...(reference.estimate ? { estimate: reference.estimate } : {}),
    },
  };
}

/** A BEA release from its schedule's exact instant. */
export function beaRow(
  spec: ReleaseSpec,
  at: Date,
  calendar: UsEquityCalendar = usEquityCalendar,
): MarketEventScheduleRow & { raw: { dateEt: string } } {
  const date = calendar.etDate(at);
  const reference =
    spec.kind === 'gdp' ? gdpReference(date) : personalIncomeReference(date);
  return releaseRow(spec, date, reference, at) as MarketEventScheduleRow & {
    raw: { dateEt: string };
  };
}

export function fomcRow(meeting: FomcMeeting): MarketEventScheduleRow {
  return {
    family: 'macro',
    kind: FOMC_DECISION.kind,
    title: FOMC_DECISION.title,
    country: 'US',
    scheduledAt: etInstant(meeting.end, minutes(FOMC_DECISION.timeEt)),
    timePrecision: 'datetime',
    source: FOMC_DECISION.agencyId,
    sourceEventId: `${FOMC_DECISION.kind}:${meeting.end}`,
    sourceUrl: FOMC_DECISION.sourceUrl,
    raw: {
      agencyId: FOMC_DECISION.agencyId,
      agency: OFFICIAL_AGENCIES[FOMC_DECISION.agencyId].name,
      dateEt: meeting.end,
      timeEt: FOMC_DECISION.timeEt,
      timeBasis: FOMC_DECISION.timeBasis,
      dateBasis: FOMC_DECISION.dateBasis,
      meetingStart: meeting.start,
      meetingEnd: meeting.end,
      ...(meeting.summaryOfEconomicProjections
        ? { summaryOfEconomicProjections: true }
        : {}),
      ...(meeting.tentative ? { tentative: true } : {}),
      ...(meeting.label ? { label: meeting.label } : {}),
    },
  };
}

/**
 * Whether a BEA table already reflects this release. A new period (GDP
 * advance estimate, a PCE month) proves it by appearing. The second and third
 * GDP estimates need the table's revision date, or a day's wait.
 */
function beaTableCurrent(
  event: StoredMarketEvent,
  lastRevised: string | null,
  now: Date,
): boolean {
  const estimate = event.raw.estimate;
  if (estimate !== 'second' && estimate !== 'third') return true;
  const date = text(event.raw.dateEt);
  if (lastRevised && date && lastRevised >= date) return true;
  return now.getTime() - event.scheduledAt.getTime() >= BEA_REVISION_WAIT_MS;
}

function referenceLabel(spec: ReleaseSpec, period: string): string {
  if (spec.result.source === 'dol') return weekLabel(period);
  return /^\d{4}-\d{2}$/.test(period) ? monthLabel(period) : period;
}

function valueAt(values: PeriodValue[]) {
  return (period: string) =>
    values.find((item) => item.period === period)?.value ?? null;
}

/** Agency rounding for percent changes: one decimal, half away from zero. */
export function roundTenth(value: number): number {
  const rounded = Math.round(Math.abs(value) * 10 + 1e-9) / 10;
  return (value < 0 ? -rounded : rounded) || 0;
}

function minutes(time: string): number {
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}

function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/** A short code for logs and sync state. Never the provider text or a URL. */
export function failureCode(error: unknown): string {
  if (error instanceof OfficialSourceError)
    return error.status ? `${error.code}_${error.status}` : error.code;
  return 'error';
}
