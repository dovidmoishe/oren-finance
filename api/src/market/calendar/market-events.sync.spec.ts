import { randomUUID } from 'node:crypto';
import { BLS_NOTICE } from './market-calendar.copy';
import { toMarketEvent } from './market-calendar.service';
import type {
  MarketEventResult,
  MarketEventScheduleRow,
  MarketEventStore,
  StoredMarketEvent,
} from './market-events.repository';
import { MarketEventsSync, roundTenth } from './market-events.sync';
import {
  OfficialSourceError,
  type BeaReleaseDates,
  type BeaTable,
  type ClaimsHeadline,
  type ClaimsWeek,
  type OfficialDataApi,
  type PeriodValue,
} from './official-data.client';

/** Mirrors the repository's SQL semantics closely enough for the refresh. */
class MemoryStore implements MarketEventStore {
  rows: StoredMarketEvent[] = [];

  upsertSchedule(rows: MarketEventScheduleRow[]) {
    for (const row of rows) {
      const existing = this.rows.find(
        (item) =>
          item.source === row.source &&
          item.sourceEventId === row.sourceEventId,
      );
      if (existing) {
        Object.assign(existing, {
          kind: row.kind,
          title: row.title,
          scheduledAt: row.scheduledAt,
          timePrecision: row.timePrecision,
          sourceUrl: row.sourceUrl,
          dateStatus:
            existing.dateStatus === 'released' ? 'released' : 'scheduled',
          raw: { ...existing.raw, ...row.raw },
        });
      } else {
        this.rows.push({
          id: randomUUID(),
          family: row.family ?? 'macro',
          kind: row.kind,
          title: row.title,
          country: row.country ?? 'US',
          scheduledAt: row.scheduledAt,
          timePrecision: row.timePrecision,
          dateStatus: 'scheduled',
          previous: null,
          actual: null,
          unit: null,
          source: row.source,
          sourceEventId: row.sourceEventId,
          sourceUrl: row.sourceUrl,
          fetchedAt: new Date(),
          updatedAt: new Date(),
          raw: row.raw ?? {},
        });
      }
    }
    return Promise.resolve();
  }

  cancelMissing(input: {
    source: string;
    kind: string;
    keep: string[];
    from: Date;
  }) {
    let count = 0;
    for (const row of this.rows) {
      if (
        row.source === input.source &&
        row.kind === input.kind &&
        row.dateStatus === 'scheduled' &&
        row.scheduledAt >= input.from &&
        !input.keep.includes(row.sourceEventId)
      ) {
        row.dateStatus = 'cancelled';
        count += 1;
      }
    }
    return Promise.resolve(count);
  }

  releaseHistory(input: { kinds: readonly string[]; from: Date; to: Date }) {
    return Promise.resolve(
      this.rows.filter(
        (row) =>
          input.kinds.includes(row.kind) &&
          (row.dateStatus === 'scheduled' || row.dateStatus === 'released') &&
          row.scheduledAt >= input.from &&
          row.scheduledAt <= input.to,
      ),
    );
  }

  recordResult(id: string, result: MarketEventResult) {
    const row = this.rows.find((item) => item.id === id)!;
    row.actual = result.actual === null ? null : String(result.actual);
    row.previous = result.previous === null ? null : String(result.previous);
    row.unit = result.unit;
    row.dateStatus = 'released';
    row.raw = { ...row.raw, ...result.raw };
    return Promise.resolve();
  }

  byDate(kindAndDate: string) {
    const [kind, date] = kindAndDate.split(':');
    return this.rows.find(
      (row) => row.kind === kind && row.raw.dateEt === date,
    );
  }
}

interface FakeAgencies {
  configured?: { bea?: boolean; census?: boolean };
  beaDates?: BeaReleaseDates | Error;
  bls?: Record<string, PeriodValue[]>;
  /** BLS refuses the configured key; only keyless requests are answered. */
  blsKeyRejected?: boolean;
  beaTables?: Record<string, BeaTable>;
  census?: PeriodValue[];
  claims?: ClaimsWeek[];
  claimsRelease?: ClaimsHeadline;
  statements?: Record<string, string>;
}

/** An agency double that records every call. */
function fakeAgencies(input: FakeAgencies = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const log = (method: string, ...args: unknown[]) =>
    calls.push({ method, args });
  const api: OfficialDataApi = {
    configured: {
      bea: input.configured?.bea ?? false,
      census: input.configured?.census ?? false,
    },
    beaReleaseDates: () => {
      log('beaReleaseDates');
      return input.beaDates instanceof Error
        ? Promise.reject(input.beaDates)
        : Promise.resolve(
            input.beaDates ?? { gdp: [], personalIncomeAndOutlays: [] },
          );
    },
    blsSeries: (seriesIds, years) => {
      log('blsSeries', [...seriesIds], years);
      if (input.blsKeyRejected && !years.keyless)
        return Promise.reject(new OfficialSourceError('bls', 'key_rejected'));
      return Promise.resolve(
        new Map(seriesIds.map((id) => [id, input.bls?.[id] ?? []])),
      );
    },
    beaTable: (request) => {
      log('beaTable', request);
      return Promise.resolve(
        input.beaTables?.[request.table] ?? { rows: [], lastRevised: null },
      );
    },
    censusRetail: (request) => {
      log('censusRetail', request);
      return Promise.resolve(input.census ?? []);
    },
    weeklyClaims: (year) => {
      log('weeklyClaims', year);
      return Promise.resolve(
        (input.claims ?? []).filter((week) =>
          week.weekEnded.startsWith(String(year)),
        ),
      );
    },
    latestClaimsRelease: () => {
      log('latestClaimsRelease');
      return Promise.resolve(input.claimsRelease ?? null);
    },
    fomcStatement: (date) => {
      log('fomcStatement', date);
      return Promise.resolve(input.statements?.[date] ?? null);
    },
  };
  return { api, calls };
}

const monthly = (values: Record<string, number>): PeriodValue[] =>
  Object.entries(values).map(([period, value]) => ({ period, value }));

const NOV_27 = new Date('2026-11-27T20:00:00Z');
const AFTER_DEC_CPI = new Date('2026-12-10T20:00:00Z');

const BEA_DATES: BeaReleaseDates = {
  gdp: [
    { at: '2026-11-25T13:30:00.000Z', period: '2026-Q3', estimate: 'second' },
    { at: '2026-12-23T13:30:00.000Z', period: '2026-Q3', estimate: 'third' },
    { at: '2027-01-28T13:30:00.000Z', period: '2026-Q4', estimate: 'advance' },
  ],
  personalIncomeAndOutlays: [
    { at: '2026-11-25T13:30:00.000Z', period: '2026-10' },
    { at: '2026-12-23T13:30:00.000Z', period: '2026-11' },
  ],
};

describe('macro calendar refresh', () => {
  it('seeds each release from its agency schedule', async () => {
    const store = new MemoryStore();
    const { api } = fakeAgencies({ beaDates: BEA_DATES });
    const report = await new MarketEventsSync(api, store).run(NOV_27);
    expect(report.failures).toEqual([]);

    const cpi = store.byDate('cpi:2026-12-10')!;
    expect(cpi.source).toBe('bls');
    expect(cpi.scheduledAt.toISOString()).toBe('2026-12-10T13:30:00.000Z');
    expect(toMarketEvent(cpi, NOV_27)).toMatchObject({
      kind: 'cpi',
      agencyId: 'bls',
      agency: 'U.S. Bureau of Labor Statistics',
      dateEt: '2026-12-10',
      timeEt: '08:30',
      timeBasis: 'published',
      dateBasis: 'published',
      status: 'scheduled',
      actual: null,
      referencePeriod: '2026-11',
      referenceLabel: 'November 2026',
      sourceUrl: 'https://www.bls.gov/schedule/news_release/cpi.htm',
      dataSourceUrl: null,
      retrievedAt: null,
    });
    // The pinned table starts at the result lookback (35 days back).
    expect(store.byDate('retail_sales:2026-10-15')).toBeUndefined();
    expect(store.byDate('retail_sales:2026-11-17')!.source).toBe('census');

    // Claims: Thanksgiving moves the report to Wednesday.
    expect(store.byDate('jobless_claims:2026-11-26')).toBeUndefined();
    expect(
      toMarketEvent(store.byDate('jobless_claims:2026-11-25')!, NOV_27),
    ).toMatchObject({
      agencyId: 'dol',
      agency: 'U.S. Department of Labor',
      timeBasis: 'customary',
      dateBasis: 'computed',
      referencePeriod: '2026-11-21',
      referenceLabel: 'Week ending Nov 21, 2026',
    });
    expect(store.byDate('jobless_claims:2026-12-03')).toBeDefined();

    // BEA: exact instants, with the quarter or month each release covers.
    expect(store.byDate('gdp:2026-12-23')!.raw).toMatchObject({
      agencyId: 'bea',
      timeEt: '08:30',
      referencePeriod: '2026-Q3',
      referenceLabel: 'Q3 2026, third estimate',
      estimate: 'third',
    });
    expect(store.byDate('pce:2026-12-23')!.raw).toMatchObject({
      referencePeriod: '2026-11',
      referenceLabel: 'November 2026',
    });

    // FOMC from the Fed calendar, from the lookback on.
    expect(store.byDate('fomc_decision:2026-09-16')).toBeUndefined();
    const december = store.byDate('fomc_decision:2026-12-09')!;
    expect(december.source).toBe('frb');
    expect(toMarketEvent(december, NOV_27)).toMatchObject({
      agency: 'Federal Reserve Board',
      timeEt: '14:00',
      timeBasis: 'customary',
      scheduledAt: '2026-12-09T19:00:00.000Z',
      sourceUrl:
        'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
    });
    expect(december.raw).toMatchObject({
      meetingStart: '2026-12-08',
      summaryOfEconomicProjections: true,
    });
    expect(store.byDate('fomc_decision:2027-10-27')!.raw).toMatchObject({
      tentative: true,
      label: 'Monetary Policy Strategy Meeting',
    });
  });

  it('computes BLS changes from index levels at the published precision', async () => {
    const store = new MemoryStore();
    const { api, calls } = fakeAgencies({
      bls: {
        CUSR0000SA0: monthly({
          '2026-08': 334.131,
          '2026-09': 336.298,
          '2026-10': 337.476,
          '2026-11': 338.4,
        }),
        CES0000000001: monthly({
          '2026-08': 159068,
          '2026-09': 159128,
          '2026-10': 159293,
          '2026-11': 159412,
        }),
        WPSFD4: monthly({
          '2026-08': 157.482,
          '2026-09': 159.699,
          '2026-10': 160.254,
        }),
      },
    });
    const report = await new MarketEventsSync(api, store).run(AFTER_DEC_CPI);
    const blsCalls = calls.filter((call) => call.method === 'blsSeries');
    expect(blsCalls).toHaveLength(1);
    expect(blsCalls[0].args[0]).toEqual(
      expect.arrayContaining(['CUSR0000SA0', 'CES0000000001', 'WPSFD4']),
    );
    expect(blsCalls[0].args[1]).toEqual({ start: 2025, end: 2026 });
    // CPI and payrolls have come out again since their 10 Nov and 6 Nov
    // releases, so those keep no value; October PPI is still the latest.
    expect(report.released).toBe(3);
    expect(report.missed).toBe(2);
    for (const id of ['cpi:2026-11-10', 'employment_situation:2026-11-06'])
      expect(store.byDate(id)).toMatchObject({
        dateStatus: 'scheduled',
        actual: null,
      });

    const cpi = toMarketEvent(store.byDate('cpi:2026-12-10')!, AFTER_DEC_CPI);
    expect(cpi).toMatchObject({
      status: 'released',
      // (338.4 / 337.476 - 1) * 100 = 0.2738 -> 0.3; October was 0.3503 -> 0.4.
      actual: 0.3,
      previous: 0.4,
      unit: 'percent_change',
      actualText: '+0.3%',
      previousText: '+0.4%',
      referencePeriod: '2026-11',
      dataSourceUrl: 'https://data.bls.gov/timeseries/CUSR0000SA0',
      retrievedAt: AFTER_DEC_CPI.toISOString(),
    });
    expect(
      toMarketEvent(store.byDate('employment_situation:2026-12-04')!),
    ).toMatchObject({
      actual: 119,
      previous: 165,
      actualText: '+119K',
      previousText: '+165K',
      unit: 'thousands_change',
    });
    expect(toMarketEvent(store.byDate('ppi:2026-11-13')!)).toMatchObject({
      actual: 0.3,
      previous: 1.4,
      referencePeriod: '2026-10',
    });

    // A second pass keeps the stored values and does not ask BLS again.
    calls.length = 0;
    await new MarketEventsSync(api, store).run(AFTER_DEC_CPI);
    expect(store.byDate('cpi:2026-12-10')!.actual).toBe('0.3');
    expect(calls.some((call) => call.method === 'blsSeries')).toBe(false);
  });

  it('asks BLS again without the key when BLS refuses it', async () => {
    const store = new MemoryStore();
    const { api, calls } = fakeAgencies({
      blsKeyRejected: true,
      bls: {
        CUSR0000SA0: monthly({
          '2026-09': 336.298,
          '2026-10': 337.476,
          '2026-11': 338.4,
        }),
      },
    });
    const report = await new MarketEventsSync(api, store).run(AFTER_DEC_CPI);
    expect(
      calls
        .filter((call) => call.method === 'blsSeries')
        .map((call) => call.args[1]),
    ).toEqual([
      { start: 2025, end: 2026 },
      { start: 2025, end: 2026, keyless: true },
    ]);
    expect(report.warnings).toContain('bls_key_rejected');
    expect(report.failures.filter((code) => code.startsWith('bls'))).toEqual(
      [],
    );
    expect(store.byDate('cpi:2026-12-10')!.actual).toBe('0.3');
  });

  it('waits until the agency publishes the month', async () => {
    const store = new MemoryStore();
    const { api } = fakeAgencies({
      bls: {
        CUSR0000SA0: monthly({ '2026-09': 336.298, '2026-10': 337.476 }),
      },
    });
    const report = await new MarketEventsSync(api, store).run(AFTER_DEC_CPI);
    expect(report.waiting).toBeGreaterThan(0);
    const row = store.byDate('cpi:2026-12-10')!;
    expect(row).toMatchObject({ dateStatus: 'scheduled', actual: null });
    // Publicly it has been released; the value is just not loaded yet.
    expect(toMarketEvent(row, AFTER_DEC_CPI)).toMatchObject({
      status: 'released',
      actual: null,
      actualText: null,
    });
  });

  it('reads GDP and PCE from BEA only with a key, and waits for the revised table', async () => {
    const releaseDay = new Date('2026-11-25T16:00:00Z');
    const keyless = fakeAgencies({ beaDates: BEA_DATES });
    const store = new MemoryStore();
    const first = await new MarketEventsSync(keyless.api, store).run(
      releaseDay,
    );
    expect(first.skipped).toEqual([
      'gdp:no_key',
      'pce:no_key',
      'retail_sales:no_key',
    ]);
    expect(keyless.calls.some((call) => call.method === 'beaTable')).toBe(
      false,
    );

    const tables = (lastRevised: string | null): Record<string, BeaTable> => ({
      T10101: {
        rows: [
          { line: '1', period: '2026-Q2', value: 3.8 },
          { line: '1', period: '2026-Q3', value: 4.3 },
          { line: '2', period: '2026-Q3', value: 9.9 },
        ],
        lastRevised,
      },
      T20807: {
        rows: [
          { line: '1', period: '2026-09', value: 0.3 },
          { line: '1', period: '2026-10', value: 0.2 },
        ],
        lastRevised,
      },
    });
    // The table still dates from the advance estimate: GDP waits, while
    // PCE's new month proves its table is current.
    const stale = fakeAgencies({
      configured: { bea: true },
      beaDates: BEA_DATES,
      beaTables: tables('2026-10-29'),
    });
    await new MarketEventsSync(stale.api, store).run(releaseDay);
    expect(store.byDate('gdp:2026-11-25')).toMatchObject({
      dateStatus: 'scheduled',
      actual: null,
    });
    expect(toMarketEvent(store.byDate('pce:2026-11-25')!)).toMatchObject({
      status: 'released',
      actual: 0.2,
      previous: 0.3,
      referencePeriod: '2026-10',
      referenceLabel: 'October 2026',
      agencyId: 'bea',
    });
    expect(
      stale.calls.find((call) => call.method === 'beaTable')?.args[0],
    ).toMatchObject({ frequency: 'Q', years: [2025, 2026] });

    const nextDay = new Date('2026-11-26T15:00:00Z');
    await new MarketEventsSync(stale.api, store).run(nextDay);
    expect(store.byDate('gdp:2026-11-25')).toMatchObject({
      dateStatus: 'scheduled',
      actual: null,
    });

    const revised = fakeAgencies({
      configured: { bea: true },
      beaDates: BEA_DATES,
      beaTables: tables('2026-11-25'),
    });
    await new MarketEventsSync(revised.api, store).run(nextDay);
    expect(toMarketEvent(store.byDate('gdp:2026-11-25')!)).toMatchObject({
      actual: 4.3,
      previous: 3.8,
      unit: 'percent_saar',
      actualText: '+4.3%',
      referenceLabel: 'Q3 2026, second estimate',
      dataSourceUrl: 'https://www.bea.gov/data/gdp/gross-domestic-product',
    });

    // With no revision date in the notes, a day's wait is enough.
    const undated = new MemoryStore();
    const noNotes = fakeAgencies({
      configured: { bea: true },
      beaDates: BEA_DATES,
      beaTables: tables(null),
    });
    await new MarketEventsSync(noNotes.api, undated).run(releaseDay);
    expect(undated.byDate('gdp:2026-11-25')!.actual).toBeNull();
    await new MarketEventsSync(noNotes.api, undated).run(
      new Date('2026-11-26T15:00:00Z'),
    );
    expect(undated.byDate('gdp:2026-11-25')!.actual).toBe('4.3');
  });

  it('leaves a release without a value once a later one of its kind is out', async () => {
    // Read after 25 Nov, BEA's Q3 number is the second estimate and
    // September PCE is as revised on 25 Nov, not what 29 Oct published.
    const store = new MemoryStore();
    const { api } = fakeAgencies({
      configured: { bea: true },
      beaDates: {
        gdp: [
          {
            at: '2026-10-29T12:30:00.000Z',
            period: '2026-Q3',
            estimate: 'advance',
          },
          {
            at: '2026-11-25T13:30:00.000Z',
            period: '2026-Q3',
            estimate: 'second',
          },
        ],
        personalIncomeAndOutlays: [
          { at: '2026-10-29T12:30:00.000Z', period: '2026-09' },
          { at: '2026-11-25T13:30:00.000Z', period: '2026-10' },
        ],
      },
      beaTables: {
        T10101: {
          rows: [
            { line: '1', period: '2026-Q2', value: 3.8 },
            { line: '1', period: '2026-Q3', value: 4.3 },
          ],
          lastRevised: '2026-11-25',
        },
        T20807: {
          rows: [
            { line: '1', period: '2026-09', value: 0.3 },
            { line: '1', period: '2026-10', value: 0.2 },
          ],
          lastRevised: '2026-11-25',
        },
      },
    });
    const report = await new MarketEventsSync(api, store).run(NOV_27);
    expect(report.missed).toBe(2);
    jest.spyOn(api, 'beaReleaseDates').mockRejectedValue(new Error('offline'));
    const retry = await new MarketEventsSync(api, store).run(NOV_27);
    expect(retry.failures).toContain('bea-schedule:error');
    expect(retry.missed).toBe(2);
    for (const id of ['gdp:2026-10-29', 'pce:2026-10-29'])
      expect(toMarketEvent(store.byDate(id)!, NOV_27)).toMatchObject({
        status: 'released',
        actual: null,
      });
    expect(toMarketEvent(store.byDate('gdp:2026-10-29')!)).toMatchObject({
      referenceLabel: 'Q3 2026, advance estimate',
    });
    expect(toMarketEvent(store.byDate('gdp:2026-11-25')!)).toMatchObject({
      actual: 4.3,
      previous: 3.8,
      referenceLabel: 'Q3 2026, second estimate',
    });
    expect(toMarketEvent(store.byDate('pce:2026-11-25')!)).toMatchObject({
      actual: 0.2,
      previous: 0.3,
      referencePeriod: '2026-10',
    });
  });

  it('reads retail sales from Census only with a key', async () => {
    const after = new Date('2026-11-17T16:00:00Z');
    const keyless = new MemoryStore();
    const report = await new MarketEventsSync(fakeAgencies().api, keyless).run(
      after,
    );
    expect(report.skipped).toContain('retail_sales:no_key');

    const store = new MemoryStore();
    const { api, calls } = fakeAgencies({
      configured: { census: true },
      census: monthly({ '2026-09': 0.4, '2026-10': 0.6 }),
    });
    const filled = await new MarketEventsSync(api, store).run(after);
    // The 15 Oct release (September data) is inside the lookback, but 17 Nov
    // superseded it, so only October is read.
    expect(filled.missed).toBe(1);
    expect(store.byDate('retail_sales:2026-10-15')).toMatchObject({
      dateStatus: 'scheduled',
      actual: null,
    });
    expect(
      calls.find((call) => call.method === 'censusRetail')?.args[0],
    ).toEqual({ category: '44X72', dataType: 'MPCSM', from: '2026-09' });
    expect(
      toMarketEvent(store.byDate('retail_sales:2026-11-17')!),
    ).toMatchObject({
      agencyId: 'census',
      actual: 0.6,
      previous: 0.4,
      actualText: '+0.6%',
      referencePeriod: '2026-10',
    });
  });

  it("takes this week's claims from the release and backfills older weeks", async () => {
    const store = new MemoryStore();
    const { api } = fakeAgencies({
      // The 25 Nov release covers the week ending 21 Nov.
      claimsRelease: {
        weekEnded: '11-21',
        initialClaims: 189000,
        previous: 202000,
      },
      // ETA's weekly data trails by a few weeks.
      claims: [
        { weekEnded: '2026-10-24', initialClaims: 195000 },
        { weekEnded: '2026-10-31', initialClaims: 191000 },
        { weekEnded: '2026-11-07', initialClaims: null },
      ],
    });
    await new MarketEventsSync(api, store).run(NOV_27);
    const latest = store.byDate('jobless_claims:2026-11-25')!;
    expect(toMarketEvent(latest)).toMatchObject({
      status: 'released',
      actual: 189000,
      previous: 202000,
      actualText: '189,000',
      previousText: '202,000',
      unit: 'count',
      referenceLabel: 'Week ending Nov 21, 2026',
      dataSourceUrl: 'https://www.dol.gov/ui/data.pdf',
    });
    expect(latest.raw.result).toMatchObject({ figure: 'advance' });

    const backfilled = store.byDate('jobless_claims:2026-11-05')!;
    expect(toMarketEvent(backfilled)).toMatchObject({
      actual: 191000,
      previous: 195000,
      referencePeriod: '2026-10-31',
    });
    expect(backfilled.raw.result).toMatchObject({ figure: 'revised' });
    // Weeks in neither source wait for the weekly data to catch up.
    expect(store.byDate('jobless_claims:2026-11-19')).toMatchObject({
      dateStatus: 'scheduled',
      actual: null,
    });
  });

  it('reads the FOMC decision from the statement once it is out', async () => {
    const store = new MemoryStore();
    const decisionDay = new Date('2026-12-09T21:00:00Z');
    await new MarketEventsSync(
      fakeAgencies({
        statements: {
          '2026-10-28':
            'The Committee decided to maintain the target range for the federal funds rate at 3-3/4 to 4 percent.',
        },
      }).api,
      store,
    ).run(NOV_27);
    expect(
      toMarketEvent(store.byDate('fomc_decision:2026-10-28')!),
    ).toMatchObject({
      actual: 4,
      previous: 4,
      actualText: '3.75%–4.00%',
      previousText: '3.75%–4.00%',
    });

    // Not published yet: the December decision waits.
    const early = await new MarketEventsSync(fakeAgencies().api, store).run(
      decisionDay,
    );
    expect(early.waiting).toBeGreaterThan(0);
    expect(store.byDate('fomc_decision:2026-12-09')).toMatchObject({
      dateStatus: 'scheduled',
      actual: null,
    });

    await new MarketEventsSync(
      fakeAgencies({
        statements: {
          '2026-12-09':
            'The Committee decided to lower the target range for the federal funds rate by 1/4 percentage point to 3-1/2 to 3‑3/4 percent. Voting against this action was a member who preferred to lower the target range for the federal funds rate by 1/2 percentage point at this meeting.',
        },
      }).api,
      store,
    ).run(decisionDay);
    expect(
      toMarketEvent(store.byDate('fomc_decision:2026-12-09')!),
    ).toMatchObject({
      status: 'released',
      actual: 3.75,
      previous: 4,
      unit: 'percent_range',
      actualText: '3.50%–3.75%',
      previousText: '3.75%–4.00%',
      referencePeriod: '2026-12-10',
      referenceLabel: 'Effective Dec 10, 2026',
      dataSourceUrl:
        'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261209a.htm',
    });
  });

  it('keeps the same event UUID when a release moves across months and cancels a withdrawn release', async () => {
    const store = new MemoryStore();
    const run = (beaDates: BeaReleaseDates) =>
      new MarketEventsSync(fakeAgencies({ beaDates }).api, store).run(NOV_27);
    await run(BEA_DATES);
    const id = store.byDate('gdp:2026-12-23')!.id;
    const report = await run({
      ...BEA_DATES,
      gdp: [{ ...BEA_DATES.gdp[1], at: '2027-01-04T13:30:00.000Z' }],
    });
    expect(report.cancelled).toBe(1);
    expect(store.byDate('gdp:2026-12-23')).toBeUndefined();
    expect(store.byDate('gdp:2027-01-04')).toMatchObject({
      id,
      dateStatus: 'scheduled',
      raw: { referencePeriod: '2026-Q3', estimate: 'third' },
    });
    expect(store.byDate('gdp:2027-01-28')!.dateStatus).toBe('cancelled');

    await run({ gdp: [], personalIncomeAndOutlays: [] });
    expect(store.byDate('gdp:2027-01-04')!.dateStatus).toBe('scheduled');
    await run(BEA_DATES);
    expect(store.byDate('gdp:2026-12-23')).toMatchObject({
      id,
      dateStatus: 'scheduled',
    });
  });

  it('reports a failing source without stopping the others', async () => {
    const store = new MemoryStore();
    const { api } = fakeAgencies({
      beaDates: new OfficialSourceError('bea', 'rate_limited', 429),
    });
    const report = await new MarketEventsSync(api, store).run(NOV_27);
    expect(report.failures).toEqual(['bea-schedule:rate_limited_429']);
    expect(store.byDate('cpi:2026-12-10')).toBeDefined();
    expect(store.byDate('gdp:2026-12-23')).toBeUndefined();
  });

  it('warns before the pinned schedules run out', async () => {
    const report = await new MarketEventsSync(
      fakeAgencies().api,
      new MemoryStore(),
    ).run(new Date('2027-11-01T15:00:00Z'));
    expect(report.warnings).toEqual(['pinned_schedule_ends_2027-12-15']);
  });

  it('rounds half away from zero, without a negative zero', () => {
    expect(roundTenth(0.35)).toBe(0.4);
    expect(roundTenth(0.3499)).toBe(0.3);
    expect(roundTenth(-0.35)).toBe(-0.4);
    expect(Object.is(roundTenth(-0.04), 0)).toBe(true);
  });

  it('never stores or exposes a consensus or forecast value', async () => {
    const store = new MemoryStore();
    const { api } = fakeAgencies({
      bls: {
        CUSR0000SA0: monthly({
          '2026-09': 336.298,
          '2026-10': 337.476,
          '2026-11': 338.4,
        }),
      },
    });
    await new MarketEventsSync(api, store).run(AFTER_DEC_CPI);
    const stored = JSON.stringify(store.rows);
    const exposed = JSON.stringify(
      store.rows.map((row) => toMarketEvent(row, AFTER_DEC_CPI)),
    );
    for (const text of [stored, exposed]) {
      expect(text).not.toMatch(/consensus|forecast|expected/i);
    }
    expect(exposed).not.toContain(BLS_NOTICE);
    // The public shape is an explicit field list, never the raw payload.
    const event = toMarketEvent(store.byDate('cpi:2026-12-10')!, AFTER_DEC_CPI);
    expect(Object.keys(event).sort()).toEqual(
      [
        'id',
        'family',
        'kind',
        'title',
        'country',
        'agencyId',
        'agency',
        'scheduledAt',
        'dateEt',
        'timeEt',
        'timePrecision',
        'timeBasis',
        'dateBasis',
        'status',
        'actual',
        'previous',
        'unit',
        'unitLabel',
        'actualText',
        'previousText',
        'referencePeriod',
        'referenceLabel',
        'sourceUrl',
        'dataSourceUrl',
        'retrievedAt',
        'updatedAt',
      ].sort(),
    );
  });
});
