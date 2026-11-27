import {
  PINNED_RELEASES,
  PINNED_SCHEDULE_COVERED_THROUGH,
  claimsReleases,
  gdpReference,
  isThursdayFederalHoliday,
  monthLabel,
  personalIncomeReference,
  previousMonth,
  previousQuarter,
  weekLabel,
} from './macro-schedule';
import { weekdayOf } from './us-equity-calendar';

describe('pinned BLS and Census schedules', () => {
  it('lists one weekday release per month, in order, through the coverage date', () => {
    for (const kind of [
      'cpi',
      'employment_situation',
      'ppi',
      'retail_sales',
    ] as const) {
      const rows = PINNED_RELEASES.filter((row) => row.kind === kind);
      expect(rows.length).toBeGreaterThanOrEqual(14);
      for (const [index, row] of rows.entries()) {
        expect(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']).toContain(
          weekdayOf(row.date),
        );
        // Each release covers an earlier month than its release date.
        expect(row.referencePeriod < row.date.slice(0, 7)).toBe(true);
        expect(row.date <= PINNED_SCHEDULE_COVERED_THROUGH).toBe(true);
        if (index > 0) {
          expect(row.date > rows[index - 1].date).toBe(true);
          expect(previousMonth(row.referencePeriod)).toBe(
            rows[index - 1].referencePeriod,
          );
        }
      }
    }
  });

  it('matches the published dates for the next releases', () => {
    const find = (kind: string, referencePeriod: string) =>
      PINNED_RELEASES.find(
        (row) => row.kind === kind && row.referencePeriod === referencePeriod,
      )?.date;
    expect(find('cpi', '2026-11')).toBe('2026-12-10');
    expect(find('employment_situation', '2026-11')).toBe('2026-12-04');
    expect(find('ppi', '2026-11')).toBe('2026-12-15');
    expect(find('retail_sales', '2026-11')).toBe('2026-12-16');
    expect(find('employment_situation', '2027-06')).toBe('2027-07-02');
  });
});

describe('weekly claims dates', () => {
  it('moves the report to Wednesday when Thursday is a federal holiday', () => {
    expect(isThursdayFederalHoliday('2026-11-26')).toBe(true);
    expect(isThursdayFederalHoliday('2025-06-19')).toBe(true);
    expect(isThursdayFederalHoliday('2027-11-11')).toBe(true);
    expect(isThursdayFederalHoliday('2026-12-24')).toBe(false);
    expect(isThursdayFederalHoliday('2026-12-25')).toBe(false);

    expect(claimsReleases('2026-11-16', '2026-12-06')).toEqual([
      { date: '2026-11-19', weekEnded: '2026-11-14' },
      { date: '2026-11-25', weekEnded: '2026-11-21' },
      { date: '2026-12-03', weekEnded: '2026-11-28' },
    ]);
    expect(claimsReleases('2027-11-08', '2027-11-12')).toEqual([
      { date: '2027-11-10', weekEnded: '2027-11-06' },
    ]);
    // A Wednesday release on the first day of the range is kept.
    expect(claimsReleases('2026-11-25', '2026-11-25')).toEqual([
      { date: '2026-11-25', weekEnded: '2026-11-21' },
    ]);
  });
});

describe('reference periods', () => {
  it('maps GDP releases to the quarter and estimate they carry', () => {
    expect(gdpReference('2026-10-29')).toEqual({
      period: '2026-Q3',
      label: 'Q3 2026, advance estimate',
      estimate: 'advance',
    });
    expect(gdpReference('2026-12-23')).toMatchObject({
      period: '2026-Q3',
      estimate: 'third',
    });
    expect(gdpReference('2027-01-28')).toMatchObject({
      period: '2026-Q4',
      estimate: 'advance',
    });
    expect(gdpReference('2027-02-25')).toMatchObject({ estimate: 'second' });
  });

  it('maps Personal Income and Outlays to the month before release', () => {
    expect(personalIncomeReference('2026-12-23')).toEqual({
      period: '2026-11',
      label: 'November 2026',
    });
    expect(personalIncomeReference('2027-01-28').period).toBe('2026-12');
  });

  it('labels and steps periods', () => {
    expect(monthLabel('2026-11')).toBe('November 2026');
    expect(weekLabel('2026-11-21')).toBe('Week ending Nov 21, 2026');
    expect(previousMonth('2027-01')).toBe('2026-12');
    expect(previousQuarter('2027-Q1')).toBe('2026-Q4');
    expect(previousQuarter('2026-Q3')).toBe('2026-Q2');
  });
});
