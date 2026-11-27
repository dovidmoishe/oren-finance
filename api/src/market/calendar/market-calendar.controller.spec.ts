import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import type {
  MarketEventsResponse,
  UsEquityClosuresResponse,
  UsEquityHours,
  UsEquitySessionResponse,
  UsEquityTradingDayResponse,
} from '../../../types/market-calendar';
import { BLS_NOTICE } from './market-calendar.copy';
import {
  MarketCalendarController,
  MarketHoursController,
} from './market-calendar.controller';
import { MarketCalendarService } from './market-calendar.service';
import { MarketEventsRepository } from './market-events.repository';
import { releaseRow } from './market-events.sync';
import { RELEASES } from './macro-catalog';
import { previousMonth } from './macro-schedule';
import { UsEquityCalendarService } from './us-equity-calendar.service';
import { MarketDayRecapService } from './market-day-recap.service';
import {
  UsEquityCalendarRangeError,
  usEquityCalendar,
} from './us-equity-calendar';

const cpi = RELEASES.find((release) => release.kind === 'cpi')!;

function storedCpi(date: string, actual: string | null) {
  const period = previousMonth(date.slice(0, 7));
  const row = releaseRow(cpi, date, { period, label: period });
  return {
    ...row,
    id: `id-${date}`,
    family: 'macro' as const,
    country: 'US',
    dateStatus: actual ? ('released' as const) : ('scheduled' as const),
    actual,
    previous: actual ? '0.2' : null,
    unit: actual ? 'percent_change' : null,
    fetchedAt: new Date('2026-11-26T15:15:00Z'),
    updatedAt: new Date('2026-11-26T15:15:00Z'),
    raw: {
      ...row.raw,
      ...(actual
        ? {
            result: {
              referencePeriod: period,
              url: 'https://data.bls.gov/timeseries/CUSR0000SA0',
              retrievedAt: '2026-11-13T15:15:00.000Z',
              consensus: 0.4,
            },
          }
        : {}),
    },
  };
}

/** Freeze the clock only; HTTP and Nest keep real timers. */
function freezeDate(iso: string) {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
}

async function start(
  options: {
    rows?: unknown[];
    synced?: Date | null;
    failRead?: boolean;
  } = {},
) {
  const repository = {
    listRange: jest.fn(() =>
      options.failRead
        ? Promise.reject(new Error('relation "market_events" does not exist'))
        : Promise.resolve(options.rows ?? []),
    ),
    syncState: jest.fn(() =>
      Promise.resolve(
        options.synced
          ? {
              lastSuccessAt: options.synced,
              lastAttemptAt: options.synced,
              lastErrorCode: null,
            }
          : null,
      ),
    ),
  };
  const recaps = {
    getRecap: jest.fn((date: string) => {
      if (date === '2099-12-31')
        throw new UsEquityCalendarRangeError(
          'Pick a date within the next year',
        );
      return {
        date,
        status: 'complete',
        generatedAt: new Date().toISOString(),
      };
    }),
  };
  const module = await Test.createTestingModule({
    controllers: [MarketHoursController, MarketCalendarController],
    providers: [
      UsEquityCalendarService,
      MarketCalendarService,
      { provide: MarketEventsRepository, useValue: repository },
      { provide: MarketDayRecapService, useValue: recaps },
    ],
  }).compile();
  const app = module.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();
  return {
    app,
    repository,
    recaps,
    http: () => request(app.getHttpServer() as Server),
  };
}

describe('US market hours HTTP API', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;

  beforeAll(async () => {
    ({ app, http } = await start());
  });
  afterAll(() => app.close());

  it('answers the live session with a 30-second public cache', async () => {
    const response = await http().get('/markets/session').expect(200);
    expect(response.headers['cache-control']).toBe('public, max-age=30');
    expect(response.body).toMatchObject({
      scope: 'us_equity_cash_session',
      timeZone: 'America/New_York',
      session: 'regular',
    });
    const body = response.body as UsEquitySessionResponse;
    expect(body.note).toMatch(/can still trade on-chain/);
    expect(typeof body.isOpen).toBe('boolean');
  });

  it('answers a fixed instant with a long cache, per session mode', async () => {
    const regular = await http()
      .get('/markets/session')
      .query({ at: '2026-11-27T18:30:00Z' })
      .expect(200);
    expect(regular.headers['cache-control']).toBe(
      'public, max-age=3600, stale-while-revalidate=86400',
    );
    expect(regular.body).toMatchObject({
      state: 'early_close',
      regular: false,
      isOpen: false,
      date: '2026-11-27',
      earlyClose: true,
      holidayName: 'Day after Thanksgiving',
      nextRegularOpen: '2026-11-30T14:30:00.000Z',
      previousRegularClose: '2026-11-27T18:00:00.000Z',
      source: 'official',
      provisional: false,
    });
    const extended = await http()
      .get('/markets/session')
      .query({ at: '2026-11-27T18:30:00Z', session: 'extended' })
      .expect(200);
    expect(extended.body).toMatchObject({ session: 'extended', isOpen: true });
    const thanksgiving = await http()
      .get('/markets/session')
      .query({ at: '2026-11-26T12:00:00-05:00', session: 'any' })
      .expect(200);
    expect(thanksgiving.body).toMatchObject({
      state: 'closed',
      isOpen: false,
      tradingDay: false,
      holidayName: 'Thanksgiving Day',
    });
  });

  it('rejects instants without an offset and unknown sessions', async () => {
    for (const at of ['2026-11-27T14:30:00', '2026-11-27', 'tomorrow']) {
      await http().get('/markets/session').query({ at }).expect(400);
    }
    await http()
      .get('/markets/session')
      .query({ session: 'overnight' })
      .expect(400);
    await http()
      .get('/markets/session')
      .query({ at: '2005-06-01T15:00:00Z' })
      .expect(400);
  });

  it('serves a day of hours in New York time and UTC', async () => {
    const response = await http()
      .get('/markets/hours')
      .query({ date: '2026-03-09' })
      .expect(200);
    expect(response.headers['cache-control']).toBe(
      'public, max-age=3600, stale-while-revalidate=86400',
    );
    expect(response.body).toMatchObject({
      date: '2026-03-09',
      tradingDay: true,
      earlyClose: false,
      holidayName: null,
      timeZone: 'America/New_York',
      regularOpenEt: '09:30',
      regularCloseEt: '16:00',
      regularOpenUtc: '2026-03-09T13:30:00.000Z',
      regularCloseUtc: '2026-03-09T20:00:00.000Z',
      source: 'official',
      provisional: false,
    });
    expect(Object.keys((response.body as UsEquityHours).sessions!)).toEqual([
      'preMarket',
      'regular',
      'afterHours',
    ]);
    for (const date of ['2026-02-30', '26-03-09', '']) {
      await http().get('/markets/hours').query({ date }).expect(400);
    }
    await http().get('/markets/hours').expect(400);
  });

  it('lists a year of closures and marks later years provisional', async () => {
    const official = await http()
      .get('/markets/closures')
      .query({ year: 2028 })
      .expect(200);
    expect(official.body).toMatchObject({
      year: 2028,
      source: 'official',
      provisional: false,
      sourceUrl: 'https://www.nyse.com/trade/hours-calendars',
    });
    const { closures } = official.body as UsEquityClosuresResponse;
    expect(closures).toHaveLength(11);
    expect(closures[0]).toEqual({
      date: '2028-01-17',
      weekday: 'Mon',
      kind: 'full_close',
      name: 'Martin Luther King, Jr. Day',
      closeEt: null,
      closeUtc: null,
      source: 'official',
      provisional: false,
    });
    const later = await http()
      .get('/markets/closures')
      .query({ year: 2031 })
      .expect(200);
    expect(later.body).toMatchObject({ source: 'computed', provisional: true });
    for (const year of ['2009', '2100', 'next']) {
      await http().get('/markets/closures').query({ year }).expect(400);
    }
  });

  it('finds the adjacent trading day in either direction', async () => {
    const next = await http()
      .get('/markets/trading-day')
      .query({ date: '2026-11-25' })
      .expect(200);
    expect(next.body).toMatchObject({
      date: '2026-11-25',
      direction: 'next',
      tradingDay: '2026-11-27',
      hours: { earlyClose: true, regularCloseEt: '13:00' },
    });
    const previous = await http()
      .get('/markets/trading-day')
      .query({ date: '2026-11-30', direction: 'previous' })
      .expect(200);
    expect((previous.body as UsEquityTradingDayResponse).tradingDay).toBe(
      '2026-11-27',
    );
    await http()
      .get('/markets/trading-day')
      .query({ date: '2026-11-30', direction: 'back' })
      .expect(400);
  });
});

describe('official macro events HTTP API', () => {
  it('returns stored events with source links and the BLS notice, never a consensus', async () => {
    freezeDate('2026-11-27T12:00:00Z');
    const { app, http, repository } = await start({
      rows: [storedCpi('2026-11-13', '0.31'), storedCpi('2026-12-10', null)],
      synced: new Date('2026-11-26T15:15:00Z'),
    });
    try {
      const response = await http()
        .get('/calendar/events')
        .query({ from: '2026-11-01', to: '2026-12-31', kinds: 'cpi' })
        .expect(200);
      expect(response.headers['cache-control']).toBe(
        'public, max-age=3600, stale-while-revalidate=86400',
      );
      const [from, to, kinds] = repository.listRange.mock
        .calls[0] as unknown as [Date, Date, string[]];
      expect(from.toISOString()).toBe('2026-11-01T04:00:00.000Z');
      expect(to.toISOString()).toBe('2027-01-01T05:00:00.000Z');
      expect(kinds).toEqual(['cpi']);
      expect(response.body).toMatchObject({
        from: '2026-11-01',
        to: '2026-12-31',
        available: true,
        reason: null,
        syncedAt: '2026-11-26T15:15:00.000Z',
        attribution: {
          sources: [
            {
              id: 'bls',
              name: 'U.S. Bureau of Labor Statistics',
              url: 'https://www.bls.gov/',
            },
          ],
          notices: [BLS_NOTICE],
        },
      });
      const body = response.body as MarketEventsResponse;
      expect(body.events).toHaveLength(2);
      expect(body.events[0]).toMatchObject({
        kind: 'cpi',
        agencyId: 'bls',
        agency: 'U.S. Bureau of Labor Statistics',
        status: 'released',
        actual: 0.31,
        actualText: '+0.3%',
        previousText: '+0.2%',
        referencePeriod: '2026-10',
        sourceUrl: 'https://www.bls.gov/schedule/news_release/cpi.htm',
        dataSourceUrl: 'https://data.bls.gov/timeseries/CUSR0000SA0',
        retrievedAt: '2026-11-13T15:15:00.000Z',
      });
      expect(body.events[1]).toMatchObject({
        status: 'scheduled',
        actual: null,
        timeEt: '08:30',
        dateBasis: 'published',
      });
      // The planted raw `consensus` never reaches the response as a field.
      expect(JSON.stringify(body)).not.toMatch(/"consensus"\s*:/i);
      expect(JSON.stringify(body.events)).not.toMatch(/consensus/i);
      expect(body.note).toMatch(/consensus estimates are not included/);
      expect(JSON.stringify(body)).not.toMatch(/tokens\.xyz|fred/i);
    } finally {
      await app.close();
      jest.useRealTimers();
    }
  });

  it('explains an empty calendar instead of failing', async () => {
    const cases = [
      { options: {}, reason: /not been loaded yet/, available: false },
      {
        options: { synced: new Date() },
        reason: /No official US releases/,
        available: true,
      },
      {
        options: { failRead: true },
        reason: /unavailable right now/,
        available: false,
      },
    ];
    for (const { options, reason, available } of cases) {
      const { app, http } = await start(options);
      try {
        const response = await http()
          .get('/calendar/events')
          .query({ from: '2026-12-01', to: '2026-12-07' })
          .expect(200);
        const body = response.body as MarketEventsResponse;
        expect(body.events).toEqual([]);
        expect(body.available).toBe(available);
        expect(body.reason).toMatch(reason);
        expect(body.attribution).toEqual({ sources: [], notices: [] });
      } finally {
        await app.close();
      }
    }
  });

  it('validates the range and the kinds', async () => {
    const { app, http, repository } = await start();
    try {
      await http()
        .get('/calendar/events')
        .query({ from: '2026-12-07', to: '2026-12-01' })
        .expect(400);
      await http()
        .get('/calendar/events')
        .query({ from: '2026-01-01', to: '2026-12-31' })
        .expect(400);
      await http()
        .get('/calendar/events')
        .query({ from: '2026-12-01', to: '2026-12-07', kinds: 'cpi,ism' })
        .expect(400);
      await http()
        .get('/calendar/events')
        .query({ from: '2026-12-01' })
        .expect(400);
      expect(repository.listRange).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('lets another module replace the injectable hours service', async () => {
    const hours = {
      getHours: jest.fn().mockReturnValue({ date: '2026-12-01', mocked: true }),
    };
    const module = await Test.createTestingModule({
      controllers: [MarketHoursController],
      providers: [
        UsEquityCalendarService,
        { provide: MarketCalendarService, useValue: {} },
      ],
    })
      .overrideProvider(UsEquityCalendarService)
      .useValue(hours)
      .compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      const response = await request(app.getHttpServer() as Server)
        .get('/markets/hours')
        .query({ date: '2026-12-01' })
        .expect(200);
      expect(response.body).toEqual({ date: '2026-12-01', mocked: true });
      expect(hours.getHours).toHaveBeenCalledWith('2026-12-01');
    } finally {
      await app.close();
    }
  });
});

describe('market day recap HTTP API', () => {
  it('caches a finished day for an hour and today for 30 seconds', async () => {
    const { app, http, recaps } = await start();
    try {
      const past = await http().get('/calendar/days/2026-11-10').expect(200);
      expect(past.body).toMatchObject({
        date: '2026-11-10',
        status: 'complete',
      });
      expect(past.headers['cache-control']).toBe(
        'public, max-age=3600, stale-while-revalidate=86400',
      );
      const today = usEquityCalendar.etDate(new Date());
      const live = await http().get(`/calendar/days/${today}`).expect(200);
      expect(live.headers['cache-control']).toBe('public, max-age=30');
      expect(recaps.getRecap).toHaveBeenCalledWith('2026-11-10');
    } finally {
      await app.close();
    }
  });

  it("rejects malformed and out-of-range dates as the caller's input", async () => {
    const { app, http } = await start();
    try {
      await http().get('/calendar/days/2026-11-1').expect(400);
      const far = await http().get('/calendar/days/2099-12-31').expect(400);
      expect((far.body as { message: string }).message).toMatch(
        /within the next year/,
      );
    } finally {
      await app.close();
    }
  });
});
