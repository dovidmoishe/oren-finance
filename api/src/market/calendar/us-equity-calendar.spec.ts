import { NYSE_OFFICIAL_SCHEDULE, NYSE_SPECIAL_CLOSURES } from './nyse-schedule';
import {
  UsEquityCalendar,
  UsEquityCalendarRangeError,
  addDays,
  computeNyseRules,
  easterSunday,
  etInstant,
  isCivilDate,
  usEquityCalendar as calendar,
} from './us-equity-calendar';

const at = (iso: string) => new Date(iso);
const closureDates = (year: number, kind: 'full_close' | 'early_close') =>
  calendar
    .listClosures(year)
    .closures.filter((closure) => closure.kind === kind)
    .map((closure) => closure.date);

describe('US equity calendar: official NYSE schedule', () => {
  it.each([2026, 2027, 2028])(
    'computes exactly the NYSE-published %i schedule',
    (year) => {
      expect(computeNyseRules(year)).toEqual(NYSE_OFFICIAL_SCHEDULE[year]);
    },
  );

  it('matches the published full closes and early closes date for date', () => {
    expect(closureDates(2026, 'full_close')).toEqual([
      '2026-01-01',
      '2026-01-19',
      '2026-02-16',
      '2026-04-03',
      '2026-05-25',
      '2026-06-19',
      '2026-07-03',
      '2026-09-07',
      '2026-11-26',
      '2026-12-25',
    ]);
    expect(closureDates(2027, 'full_close')).toEqual([
      '2027-01-01',
      '2027-01-18',
      '2027-02-15',
      '2027-03-26',
      '2027-05-31',
      '2027-06-18',
      '2027-07-05',
      '2027-09-06',
      '2027-11-25',
      '2027-12-24',
    ]);
    expect(closureDates(2028, 'full_close')).toEqual([
      '2028-01-17',
      '2028-02-21',
      '2028-04-14',
      '2028-05-29',
      '2028-06-19',
      '2028-07-04',
      '2028-09-04',
      '2028-11-23',
      '2028-12-25',
    ]);
    expect(closureDates(2026, 'early_close')).toEqual([
      '2026-11-27',
      '2026-12-24',
    ]);
    expect(closureDates(2027, 'early_close')).toEqual(['2027-11-26']);
    expect(closureDates(2028, 'early_close')).toEqual([
      '2028-07-03',
      '2028-11-24',
    ]);
  });

  it('pins the edge cases the brief calls out', () => {
    // A Saturday New Year's Day is not observed, so 2027-12-31 trades.
    expect(calendar.day('2028-01-01')).toMatchObject({
      tradingDay: false,
      closedReason: 'weekend',
      holidayName: null,
    });
    expect(calendar.isTradingDay('2027-12-31')).toBe(true);
    expect(calendar.day('2027-06-18')).toMatchObject({
      tradingDay: false,
      holidayName: 'Juneteenth National Independence Day (observed)',
    });
    expect(calendar.day('2026-07-03').holidayName).toBe(
      'Independence Day (observed)',
    );
    expect(calendar.day('2027-07-05').holidayName).toBe(
      'Independence Day (observed)',
    );
    for (const date of ['2026-07-02', '2027-07-02']) {
      expect(calendar.day(date)).toMatchObject({
        tradingDay: true,
        earlyClose: false,
      });
    }
    expect(calendar.day('2027-12-24')).toMatchObject({
      tradingDay: false,
      earlyClose: false,
      holidayName: 'Christmas Day (observed)',
    });
    expect(calendar.isTradingDay('2027-12-23')).toBe(true);
    expect(calendar.day('2027-12-23').earlyClose).toBe(false);
    for (const date of [
      '2026-11-27',
      '2027-11-26',
      '2028-11-24',
      '2028-07-03',
    ]) {
      expect(calendar.day(date)).toMatchObject({
        tradingDay: true,
        earlyClose: true,
      });
    }
    expect(calendar.day('2028-12-24').closedReason).toBe('weekend');
  });

  it('labels published years official and later years computed and provisional', () => {
    expect(calendar.officialCoverage()).toEqual({
      firstYear: 2026,
      lastYear: 2028,
      through: '2028-12-31',
    });
    expect(calendar.listClosures(2027)).toMatchObject({
      source: 'official',
      provisional: false,
    });
    expect(calendar.getHours('2028-06-20')).toMatchObject({
      source: 'official',
      provisional: false,
    });
    expect(calendar.listClosures(2029)).toMatchObject({
      source: 'computed',
      provisional: true,
    });
    expect(calendar.getHours('2029-01-02')).toMatchObject({
      tradingDay: true,
      source: 'computed',
      provisional: true,
    });
    expect(calendar.day('2029-01-01').holidayName).toBe("New Year's Day");
    // July 4, 2029 is a Wednesday, so July 3 closes early under NYSE practice.
    expect(calendar.day('2029-07-03')).toMatchObject({
      earlyClose: true,
      provisional: true,
    });
  });
});

describe('US equity calendar: holiday rules', () => {
  it('moves Saturday holidays to Friday and Sunday holidays to Monday', () => {
    const fullCloses = (year: number) =>
      computeNyseRules(year)
        .filter((entry) => entry.kind === 'full_close')
        .map((entry) => entry.date);
    // New Year's Day on Saturday: not observed; on Sunday: Monday.
    expect(fullCloses(2022)).not.toContain('2021-12-31');
    expect(fullCloses(2022)[0]).toBe('2022-01-17');
    expect(computeNyseRules(2023)[0]).toEqual({
      date: '2023-01-02',
      kind: 'full_close',
      name: "New Year's Day (observed)",
    });
    expect(fullCloses(2020)).toContain('2020-07-03');
    expect(fullCloses(2021)).toEqual(
      expect.arrayContaining(['2021-07-05', '2021-12-24']),
    );
    expect(fullCloses(2022)).toEqual(
      expect.arrayContaining(['2022-06-20', '2022-12-26']),
    );
    expect(fullCloses(2021)).not.toContain('2021-06-18');
    expect(fullCloses(2017)).toContain('2017-01-02');
  });

  it('reproduces the published 2024 and 2025 schedules, including the pinned mourning day', () => {
    expect(computeNyseRules(2024)).toEqual([
      { date: '2024-01-01', kind: 'full_close', name: "New Year's Day" },
      {
        date: '2024-01-15',
        kind: 'full_close',
        name: 'Martin Luther King, Jr. Day',
      },
      { date: '2024-02-19', kind: 'full_close', name: "Washington's Birthday" },
      { date: '2024-03-29', kind: 'full_close', name: 'Good Friday' },
      { date: '2024-05-27', kind: 'full_close', name: 'Memorial Day' },
      {
        date: '2024-06-19',
        kind: 'full_close',
        name: 'Juneteenth National Independence Day',
      },
      {
        date: '2024-07-03',
        kind: 'early_close',
        name: 'Day before Independence Day',
      },
      { date: '2024-07-04', kind: 'full_close', name: 'Independence Day' },
      { date: '2024-09-02', kind: 'full_close', name: 'Labor Day' },
      { date: '2024-11-28', kind: 'full_close', name: 'Thanksgiving Day' },
      {
        date: '2024-11-29',
        kind: 'early_close',
        name: 'Day after Thanksgiving',
      },
      { date: '2024-12-24', kind: 'early_close', name: 'Christmas Eve' },
      { date: '2024-12-25', kind: 'full_close', name: 'Christmas Day' },
    ]);
    expect(closureDates(2025, 'full_close')).toEqual([
      '2025-01-01',
      '2025-01-09',
      '2025-01-20',
      '2025-02-17',
      '2025-04-18',
      '2025-05-26',
      '2025-06-19',
      '2025-07-04',
      '2025-09-01',
      '2025-11-27',
      '2025-12-25',
    ]);
    expect(closureDates(2025, 'early_close')).toEqual([
      '2025-07-03',
      '2025-11-28',
      '2025-12-24',
    ]);
    expect(calendar.day('2025-01-09')).toMatchObject({
      tradingDay: false,
      source: 'official',
      provisional: false,
    });
  });

  it('puts Good Friday two days before Western Easter', () => {
    const easter: Record<number, string> = {
      2011: '2011-04-24',
      2019: '2019-04-21',
      2020: '2020-04-12',
      2021: '2021-04-04',
      2022: '2022-04-17',
      2023: '2023-04-09',
      2024: '2024-03-31',
      2025: '2025-04-20',
      2026: '2026-04-05',
      2027: '2027-03-28',
      2028: '2028-04-16',
      2029: '2029-04-01',
      2030: '2030-04-21',
      2038: '2038-04-25',
    };
    for (const [year, sunday] of Object.entries(easter)) {
      expect(easterSunday(Number(year))).toBe(sunday);
      const goodFriday = addDays(sunday, -2);
      expect(calendar.day(goodFriday)).toMatchObject({
        weekday: 'Fri',
        tradingDay: false,
        holidayName: 'Good Friday',
      });
    }
    expect(easterSunday(2285)).toBe('2285-03-22');
  });

  it('rejects malformed dates and years it cannot answer', () => {
    expect(isCivilDate('2026-11-27')).toBe(true);
    for (const value of ['2026-02-30', '2026-2-3', '20261127', 'today']) {
      expect(isCivilDate(value)).toBe(false);
      expect(() => calendar.day(value)).toThrow(UsEquityCalendarRangeError);
    }
    expect(() => calendar.day('2009-12-31')).toThrow(
      UsEquityCalendarRangeError,
    );
    expect(() => calendar.listClosures(2100)).toThrow(
      UsEquityCalendarRangeError,
    );
    expect(() => calendar.nextTradingDay('2099-12-31')).toThrow(
      UsEquityCalendarRangeError,
    );
  });
});

describe('US equity calendar: special closures', () => {
  const mourning = {
    date: '2030-01-10',
    kind: 'full_close' as const,
    name: 'National Day of Mourning (fixture)',
  };

  it('forces a one-off full close while the rest of that year stays provisional', () => {
    const custom = new UsEquityCalendar({ specialClosures: [mourning] });
    expect(calendar.isTradingDay('2030-01-10')).toBe(true);
    expect(custom.day('2030-01-10')).toMatchObject({
      tradingDay: false,
      closedReason: 'holiday',
      holidayName: mourning.name,
      source: 'official',
      provisional: false,
    });
    expect(custom.nextTradingDay('2030-01-09')).toBe('2030-01-11');
    expect(custom.listClosures(2030)).toMatchObject({
      source: 'computed',
      provisional: true,
    });
    expect(
      custom.listClosures(2030).closures.find((c) => c.date === mourning.date),
    ).toMatchObject({ kind: 'full_close', source: 'official' });
    expect(custom.getHours('2030-01-11')).toMatchObject({
      tradingDay: true,
      provisional: true,
    });
    expect(custom.sessionStateAt(at('2030-01-10T16:00:00Z'))).toBe('closed');
  });

  it('applies inside a published year too, without making the year provisional', () => {
    const custom = new UsEquityCalendar({
      specialClosures: [
        { date: '2027-03-03', kind: 'full_close', name: 'Mourning fixture' },
        { date: '2026-11-27', kind: 'full_close', name: 'Storm fixture' },
      ],
    });
    expect(custom.isTradingDay('2027-03-03')).toBe(false);
    expect(custom.listClosures(2027)).toMatchObject({
      source: 'official',
      provisional: false,
    });
    // The override replaces the published early close on the same date.
    expect(custom.day('2026-11-27')).toMatchObject({
      tradingDay: false,
      earlyClose: false,
      holidayName: 'Storm fixture',
    });
    expect(custom.nextTradingDay('2026-11-25')).toBe('2026-11-30');
  });

  it('keeps the built-in table to real NYSE announcements', () => {
    expect(NYSE_SPECIAL_CLOSURES.map((entry) => entry.date)).toEqual([
      '2012-10-29',
      '2012-10-30',
      '2018-12-05',
      '2025-01-09',
    ]);
    for (const year of [2026, 2027, 2028]) {
      expect(
        NYSE_SPECIAL_CLOSURES.some((entry) => entry.date.startsWith(`${year}`)),
      ).toBe(false);
    }
  });
});

describe('US equity calendar: trading days', () => {
  it('walks Thanksgiving week 2026', () => {
    expect(calendar.nextTradingDay('2026-11-25')).toBe('2026-11-27');
    expect(calendar.day('2026-11-27').earlyClose).toBe(true);
    expect(calendar.nextTradingDay('2026-11-27')).toBe('2026-11-30');
    expect(calendar.previousTradingDay('2026-11-30')).toBe('2026-11-27');
    expect(calendar.previousTradingDay('2026-11-27')).toBe('2026-11-25');
    expect(calendar.previousTradingDay('2026-11-26')).toBe('2026-11-25');
    let fullSession = calendar.nextTradingDay('2026-11-25');
    while (calendar.day(fullSession).earlyClose)
      fullSession = calendar.nextTradingDay(fullSession);
    expect(fullSession).toBe('2026-11-30');
  });

  it('skips long weekends and crosses year ends', () => {
    expect(calendar.nextTradingDay('2026-04-02')).toBe('2026-04-06');
    expect(calendar.previousTradingDay('2026-01-02')).toBe('2025-12-31');
    expect(calendar.nextTradingDay('2026-12-31')).toBe('2027-01-04');
    expect(calendar.nextTradingDay('2027-12-30')).toBe('2027-12-31');
    expect(calendar.nextTradingDay('2027-12-31')).toBe('2028-01-03');
    expect(calendar.nextTradingDay('2028-12-29')).toBe('2029-01-02');
  });

  it('finds the next open and the previous close around holidays', () => {
    const afterClose = at('2026-11-25T21:00:00Z');
    expect(calendar.previousRegularClose(afterClose).toISOString()).toBe(
      '2026-11-25T21:00:00.000Z',
    );
    expect(calendar.nextRegularOpen(afterClose).toISOString()).toBe(
      '2026-11-27T14:30:00.000Z',
    );
    expect(calendar.nextRegularClose(afterClose).toISOString()).toBe(
      '2026-11-27T18:00:00.000Z',
    );
    const atOpen = at('2026-11-27T14:30:00Z');
    expect(calendar.nextRegularOpen(atOpen).toISOString()).toBe(
      '2026-11-30T14:30:00.000Z',
    );
    expect(calendar.previousRegularClose(atOpen).toISOString()).toBe(
      '2026-11-25T21:00:00.000Z',
    );
    const beforeOpen = at('2026-11-30T09:00:00Z');
    expect(calendar.nextRegularOpen(beforeOpen).toISOString()).toBe(
      '2026-11-30T14:30:00.000Z',
    );
    expect(calendar.previousRegularClose(beforeOpen).toISOString()).toBe(
      '2026-11-27T18:00:00.000Z',
    );
  });
});

describe('US equity calendar: session clock and DST', () => {
  it.each([
    ['2026-03-06', '2026-03-06T14:30:00.000Z', '2026-03-06T21:00:00.000Z'],
    ['2026-03-09', '2026-03-09T13:30:00.000Z', '2026-03-09T20:00:00.000Z'],
    ['2026-10-30', '2026-10-30T13:30:00.000Z', '2026-10-30T20:00:00.000Z'],
    ['2026-11-02', '2026-11-02T14:30:00.000Z', '2026-11-02T21:00:00.000Z'],
    ['2027-03-12', '2027-03-12T14:30:00.000Z', '2027-03-12T21:00:00.000Z'],
    ['2027-03-15', '2027-03-15T13:30:00.000Z', '2027-03-15T20:00:00.000Z'],
    ['2027-11-05', '2027-11-05T13:30:00.000Z', '2027-11-05T20:00:00.000Z'],
    ['2027-11-08', '2027-11-08T14:30:00.000Z', '2027-11-08T21:00:00.000Z'],
  ])('opens %s at %s and closes at %s', (date, openUtc, closeUtc) => {
    expect(calendar.getHours(date)).toMatchObject({
      tradingDay: true,
      regularOpenEt: '09:30',
      regularCloseEt: '16:00',
      regularOpenUtc: openUtc,
      regularCloseUtc: closeUtc,
    });
  });

  it('has no trading on DST switch Sundays and a correct clock the next morning', () => {
    for (const sunday of [
      '2026-03-08',
      '2026-11-01',
      '2027-03-14',
      '2027-11-07',
    ]) {
      expect(calendar.getHours(sunday)).toMatchObject({
        tradingDay: false,
        sessions: null,
      });
    }
    expect(calendar.sessionStateAt(at('2026-03-08T15:00:00Z'))).toBe('closed');
    expect(calendar.sessionStateAt(at('2026-03-09T07:59:00Z'))).toBe(
      'overnight',
    );
    expect(calendar.sessionStateAt(at('2026-03-09T08:00:00Z'))).toBe(
      'pre_market',
    );
    expect(calendar.sessionStateAt(at('2026-11-02T08:59:00Z'))).toBe(
      'overnight',
    );
    expect(calendar.sessionStateAt(at('2026-11-02T09:00:00Z'))).toBe(
      'pre_market',
    );
  });

  it('never skips or duplicates an hour in any 2026-2027 trading day', () => {
    const hour = 3_600_000;
    let date = '2026-01-01';
    let tradingDays = 0;
    while (date <= '2027-12-31') {
      const hours = calendar.getHours(date);
      if (hours.sessions) {
        tradingDays += 1;
        const { preMarket, regular, afterHours } = hours.sessions;
        const span = (window: { startUtc: string; endUtc: string }) =>
          Date.parse(window.endUtc) - Date.parse(window.startUtc);
        expect(preMarket.endUtc).toBe(regular.startUtc);
        expect(regular.endUtc).toBe(afterHours.startUtc);
        expect(span(preMarket)).toBe(5.5 * hour);
        expect(span(regular)).toBe((hours.earlyClose ? 3.5 : 6.5) * hour);
        expect(span(afterHours)).toBe((hours.earlyClose ? 7 : 4) * hour);
        expect(calendar.etDate(new Date(preMarket.startUtc))).toBe(date);
        expect(
          calendar.etDate(new Date(Date.parse(afterHours.endUtc) - 1)),
        ).toBe(date);
      }
      date = addDays(date, 1);
    }
    expect(tradingDays).toBe(251 + 251);
  });

  it('reports hours in New York time and UTC for an early close', () => {
    expect(calendar.getHours('2026-11-27')).toEqual({
      date: '2026-11-27',
      weekday: 'Fri',
      timeZone: 'America/New_York',
      tradingDay: true,
      earlyClose: true,
      holidayName: 'Day after Thanksgiving',
      closedReason: null,
      source: 'official',
      provisional: false,
      sessions: {
        preMarket: {
          startEt: '04:00',
          endEt: '09:30',
          startUtc: '2026-11-27T09:00:00.000Z',
          endUtc: '2026-11-27T14:30:00.000Z',
        },
        regular: {
          startEt: '09:30',
          endEt: '13:00',
          startUtc: '2026-11-27T14:30:00.000Z',
          endUtc: '2026-11-27T18:00:00.000Z',
        },
        afterHours: {
          startEt: '13:00',
          endEt: '20:00',
          startUtc: '2026-11-27T18:00:00.000Z',
          endUtc: '2026-11-28T01:00:00.000Z',
        },
      },
      regularOpenEt: '09:30',
      regularCloseEt: '13:00',
      regularOpenUtc: '2026-11-27T14:30:00.000Z',
      regularCloseUtc: '2026-11-27T18:00:00.000Z',
    });
    expect(calendar.getHours('2026-11-26')).toMatchObject({
      tradingDay: false,
      closedReason: 'holiday',
      holidayName: 'Thanksgiving Day',
      sessions: null,
      regularOpenUtc: null,
    });
    const early = calendar
      .listClosures(2028)
      .closures.find((closure) => closure.date === '2028-07-03');
    expect(early).toMatchObject({
      kind: 'early_close',
      closeEt: '13:00',
      closeUtc: '2028-07-03T17:00:00.000Z',
    });
    expect(etInstant('2028-07-03', 13 * 60).toISOString()).toBe(
      '2028-07-03T17:00:00.000Z',
    );
  });

  it('answers regular, extended, and any sessions', () => {
    const cases: [string, boolean, boolean, boolean][] = [
      // instant, regular, extended, any
      ['2026-11-24T13:00:00Z', false, true, true], // 08:00 pre-market
      ['2026-11-24T15:00:00Z', true, true, true], // 10:00 regular
      ['2026-11-24T22:00:00Z', false, true, true], // 17:00 after hours
      ['2026-11-25T02:00:00Z', false, false, true], // 21:00 overnight
      ['2026-11-26T15:00:00Z', false, false, false], // Thanksgiving
      ['2026-11-27T18:30:00Z', false, true, true], // after the 13:00 close
      ['2026-11-28T01:30:00Z', false, false, true], // Friday night overnight
      ['2026-11-28T15:00:00Z', false, false, false], // Saturday
      ['2026-11-30T02:00:00Z', false, false, false], // Sunday evening
      ['2026-11-30T05:00:00Z', false, false, true], // Monday 00:00 overnight
    ];
    for (const [instant, regular, extended, any] of cases) {
      const when = at(instant);
      expect([
        calendar.isRegularOpen(when),
        calendar.isExtendedOpen(when),
        calendar.isOpen(when, 'any'),
      ]).toEqual([regular, extended, any]);
    }
    expect(calendar.sessionStateAt(at('2026-11-27T18:30:00Z'))).toBe(
      'early_close',
    );
  });
});
