import { BLS_NOTICE } from './market-calendar.copy';
import {
  MarketCalendarService,
  formatValue,
  parseEventKinds,
  parseInstant,
} from './market-calendar.service';
import { FOMC_MEETINGS, RELEASES } from './macro-catalog';
import { fomcRow, releaseRow } from './market-events.sync';
import { UsEquityCalendarRangeError } from './us-equity-calendar';
import { UsEquityCalendarService } from './us-equity-calendar.service';

const stored = (row: ReturnType<typeof releaseRow>) => ({
  ...row,
  id: row.sourceEventId,
  family: 'macro',
  country: 'US',
  dateStatus: 'scheduled',
  actual: null,
  previous: null,
  unit: null,
  fetchedAt: new Date('2026-11-26T15:15:00Z'),
  updatedAt: new Date('2026-11-26T15:15:00Z'),
});

function service(rows: unknown[] = []) {
  const events = {
    listRange: jest.fn().mockResolvedValue(rows),
    syncState: jest.fn().mockResolvedValue({
      lastSuccessAt: new Date('2026-11-26T15:15:00Z'),
      lastAttemptAt: new Date('2026-11-26T15:14:00Z'),
      lastErrorCode: null,
    }),
  };
  return {
    events,
    calendar: new MarketCalendarService(
      new UsEquityCalendarService(),
      events as never,
    ),
  };
}

describe('MarketCalendarService', () => {
  it('answers "is the market open" for now or a given instant', () => {
    const { calendar } = service();
    expect(calendar.isMarketOpen({ at: '2026-11-24T15:00:00Z' })).toMatchObject(
      { state: 'regular', isOpen: true, session: 'regular' },
    );
    expect(
      calendar.isMarketOpen({
        at: '2026-11-25T02:00:00Z',
        session: 'any',
      }),
    ).toMatchObject({ state: 'overnight', isOpen: true, regular: false });
    expect(calendar.isMarketOpen().observedAt).toEqual(expect.any(String));
    expect(() => calendar.isMarketOpen({ at: 'soon' })).toThrow(
      UsEquityCalendarRangeError,
    );
  });

  it('builds a week of trading days with holidays and early closes', async () => {
    const { calendar, events } = service();
    const week = await calendar.getMarketCalendar({
      now: new Date('2026-11-24T15:00:00Z'),
    });
    expect(week).toMatchObject({
      scope: 'us_equity_cash_session',
      from: '2026-11-24',
      to: '2026-11-30',
      eventsAvailable: true,
      eventsReason: 'No official US releases are scheduled in this range.',
    });
    expect(
      week.days.map((day) => [day.date, day.tradingDay, day.earlyClose]),
    ).toEqual([
      ['2026-11-24', true, false],
      ['2026-11-25', true, false],
      ['2026-11-26', false, false],
      ['2026-11-27', true, true],
      ['2026-11-28', false, false],
      ['2026-11-29', false, false],
      ['2026-11-30', true, false],
    ]);
    expect(week.days[2].holidayName).toBe('Thanksgiving Day');
    expect(week.now.state).toBe('regular');
    expect(week.notes.join(' ')).toMatch(/on-chain/);
    expect(week.notes.join(' ')).toMatch(
      /consensus estimates are not included/,
    );
    // No events, so no agency to credit.
    expect(week.attribution).toEqual({ sources: [], notices: [] });
    const [from, to] = events.listRange.mock.calls[0] as [Date, Date];
    expect(from.toISOString()).toBe('2026-11-24T05:00:00.000Z');
    expect(to.toISOString()).toBe('2026-12-01T05:00:00.000Z');

    const today = await calendar.getMarketCalendar({
      window: 'today',
      now: new Date('2026-11-27T15:00:00Z'),
    });
    expect(today.days).toHaveLength(1);
    expect(today.days[0]).toMatchObject({
      date: '2026-11-27',
      earlyClose: true,
      regularCloseEt: '13:00',
    });

    await expect(
      calendar.getMarketCalendar({ from: '2026-12-01', to: '2027-01-15' }),
    ).rejects.toThrow(UsEquityCalendarRangeError);
  });

  it('credits exactly the agencies behind the events it returns', async () => {
    const cpi = RELEASES.find((release) => release.kind === 'cpi')!;
    const { calendar } = service([
      stored(fomcRow(FOMC_MEETINGS.find((m) => m.end === '2026-12-09')!)),
      stored(
        releaseRow(cpi, '2026-12-10', {
          period: '2026-11',
          label: 'November 2026',
        }),
      ),
    ]);
    const week = await calendar.getMarketCalendar({
      from: '2026-12-07',
      to: '2026-12-13',
      now: new Date('2026-12-08T15:00:00Z'),
    });
    expect(week.events.map((event) => [event.kind, event.status])).toEqual([
      ['fomc_decision', 'scheduled'],
      ['cpi', 'scheduled'],
    ]);
    expect(week.attribution).toEqual({
      sources: [
        {
          id: 'frb',
          name: 'Federal Reserve Board',
          url: 'https://www.federalreserve.gov/',
        },
        {
          id: 'bls',
          name: 'U.S. Bureau of Labor Statistics',
          url: 'https://www.bls.gov/',
        },
      ],
      notices: [BLS_NOTICE],
    });

    // Once its time passes, a release reads as released even before its
    // value is stored.
    const later = await calendar.getEvents({
      from: '2026-12-07',
      to: '2026-12-13',
      now: new Date('2026-12-10T14:00:00Z'),
    });
    expect(later.events.map((event) => event.status)).toEqual([
      'released',
      'released',
    ]);
  });

  it('formats official values the way the agencies round them', () => {
    expect(formatValue(0.27333, 'percent_change')).toBe('+0.3%');
    expect(formatValue(-0.04, 'percent_change')).toBe('0.0%');
    expect(formatValue(-0.12, 'percent_change')).toBe('-0.1%');
    expect(formatValue(4.3, 'percent_saar')).toBe('+4.3%');
    expect(formatValue(119, 'thousands_change')).toBe('+119K');
    expect(formatValue(-33, 'thousands_change')).toBe('-33K');
    expect(formatValue(216000, 'count')).toBe('216,000');
    expect(formatValue(3.75, 'percent_range', 3.5)).toBe('3.50%–3.75%');
    expect(formatValue(3.75, 'percent_range')).toBe('3.75% (upper limit)');
    expect(formatValue(null, 'count')).toBeNull();
    expect(formatValue(1, null)).toBeNull();
  });

  it('parses strict instants and known event kinds only', () => {
    expect(parseInstant(undefined)).toBeUndefined();
    expect(parseInstant('2026-11-27T09:30:00-05:00')?.toISOString()).toBe(
      '2026-11-27T14:30:00.000Z',
    );
    expect(() => parseInstant('2026-11-27 09:30')).toThrow(
      UsEquityCalendarRangeError,
    );
    expect(parseEventKinds('cpi, fomc_decision')).toEqual([
      'cpi',
      'fomc_decision',
    ]);
    expect(parseEventKinds(undefined)).toEqual([]);
    expect(() => parseEventKinds('earnings')).toThrow(/Unknown event kind/);
  });
});
