import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_ENV, DRIZZLE } from '../../config/constants';
import { MarketCalendarService } from './market-calendar.service';
import { MarketEventsRepository } from './market-events.repository';
import {
  MarketEventsSync,
  type MarketEventsSyncReport,
} from './market-events.sync';
import {
  MarketEventsWorker,
  latestSyncSlot,
  syncDue,
} from './market-events.worker';
import { usEquityCalendar as calendar } from './us-equity-calendar';
import { UsEquityCalendarService } from './us-equity-calendar.service';

const at = (iso: string) => new Date(iso);

const PREVIEW_ENV = {
  DEPLOYMENT_ENV: 'preview',
  PREVIEW_PR_NUMBER: '7',
  COMMIT_SHA: 'a'.repeat(40),
};

function quietReport(
  overrides: Partial<MarketEventsSyncReport> = {},
): MarketEventsSyncReport {
  return {
    scheduled: 0,
    cancelled: 0,
    released: 0,
    waiting: 0,
    missed: 0,
    skipped: [],
    failures: [],
    warnings: [],
    ...overrides,
  };
}

describe('macro calendar refresh schedule', () => {
  it('targets 10:15 and 17:15 New York time across DST', () => {
    // 2026-11-27 is EST (UTC-5).
    expect(
      latestSyncSlot(calendar, at('2026-11-27T15:14:00Z')).toISOString(),
    ).toBe('2026-11-26T22:15:00.000Z');
    expect(
      latestSyncSlot(calendar, at('2026-11-27T15:15:00Z')).toISOString(),
    ).toBe('2026-11-27T15:15:00.000Z');
    expect(
      latestSyncSlot(calendar, at('2026-11-27T23:00:00Z')).toISOString(),
    ).toBe('2026-11-27T22:15:00.000Z');
    // 2026-07-15 is EDT (UTC-4).
    expect(
      latestSyncSlot(calendar, at('2026-07-15T14:20:00Z')).toISOString(),
    ).toBe('2026-07-15T14:15:00.000Z');
  });

  it('runs at most once per slot and waits an hour after a failure', () => {
    const now = at('2026-11-27T16:00:00Z');
    expect(syncDue(calendar, null, now)).toBe(true);
    expect(
      syncDue(
        calendar,
        {
          lastSuccessAt: at('2026-11-27T15:20:00Z'),
          lastAttemptAt: at('2026-11-27T15:19:00Z'),
          lastErrorCode: null,
        },
        now,
      ),
    ).toBe(false);
    expect(
      syncDue(
        calendar,
        {
          lastSuccessAt: at('2026-11-26T22:20:00Z'),
          lastAttemptAt: at('2026-11-26T22:19:00Z'),
          lastErrorCode: null,
        },
        now,
      ),
    ).toBe(true);
    const failed = {
      lastSuccessAt: at('2026-11-26T22:20:00Z'),
      lastAttemptAt: at('2026-11-27T15:30:00Z'),
      lastErrorCode: 'rate_limited_429',
    };
    expect(syncDue(calendar, failed, now)).toBe(false);
    expect(syncDue(calendar, failed, at('2026-11-27T16:31:00Z'))).toBe(true);
    // A partial pass still counts as this slot's run.
    expect(
      syncDue(
        calendar,
        {
          lastSuccessAt: at('2026-11-27T15:20:00Z'),
          lastAttemptAt: at('2026-11-27T15:19:00Z'),
          lastErrorCode: 'partial:bls-result:rate_limited_429',
        },
        now,
      ),
    ).toBe(false);
  });
});

describe('MarketEventsWorker', () => {
  const repository = () => ({
    syncState: jest.fn().mockResolvedValue(null),
    claimSync: jest.fn().mockResolvedValue(true),
    finishSync: jest.fn().mockResolvedValue(undefined),
  });

  afterEach(() => jest.restoreAllMocks());

  it('stays off in previews', () => {
    const saved = { ...process.env };
    Object.assign(process.env, PREVIEW_ENV);
    try {
      const preview = new MarketEventsWorker(
        repository() as never,
        new UsEquityCalendarService(),
        { BEA_API_KEY: 'k', CENSUS_API_KEY: 'k' } as never,
      );
      const interval = jest.spyOn(global, 'setInterval');
      preview.onModuleInit();
      expect(interval).not.toHaveBeenCalled();
      preview.onModuleDestroy();
    } finally {
      process.env = saved;
    }
  });

  it('runs without keys and says which published values will be missing', async () => {
    const store = repository();
    const run = jest
      .spyOn(MarketEventsSync.prototype, 'run')
      .mockResolvedValue(quietReport());
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const interval = jest.spyOn(global, 'setInterval');
    const worker = new MarketEventsWorker(
      store as never,
      new UsEquityCalendarService(),
      {} as never,
    );
    worker.onModuleInit();
    // Let the first pass, started on boot, finish against the mocks.
    await new Promise((resolve) => setImmediate(resolve));
    worker.onModuleDestroy();
    expect(interval).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('BEA_API_KEY (GDP and PCE values)'),
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('CENSUS_API_KEY (retail sales values)'),
    );
  });

  it('skips when another process holds the lease', async () => {
    const store = repository();
    store.claimSync.mockResolvedValue(false);
    const run = jest.spyOn(MarketEventsSync.prototype, 'run');
    const worker = new MarketEventsWorker(
      store as never,
      new UsEquityCalendarService(),
      {} as never,
    );
    await worker.tick(at('2026-11-27T16:00:00Z'));
    expect(store.claimSync).toHaveBeenCalledWith(
      'us-macro-calendar',
      expect.any(String),
      600_000,
    );
    expect(run).not.toHaveBeenCalled();
    expect(store.finishSync).not.toHaveBeenCalled();
  });

  it('records a partial pass as done and a thrown pass as a failure code', async () => {
    const store = repository();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const worker = new MarketEventsWorker(
      store as never,
      new UsEquityCalendarService(),
      {} as never,
    );
    jest.spyOn(MarketEventsSync.prototype, 'run').mockResolvedValueOnce(
      quietReport({
        scheduled: 3,
        released: 1,
        skipped: ['gdp:no_key'],
        failures: ['bls-result:rate_limited_429'],
      }),
    );
    await worker.tick(at('2026-11-27T16:00:00Z'));
    expect(store.finishSync).toHaveBeenLastCalledWith(
      'us-macro-calendar',
      expect.any(String),
      { ok: true, note: 'partial:bls-result:rate_limited_429' },
    );

    jest
      .spyOn(MarketEventsSync.prototype, 'run')
      .mockRejectedValueOnce(new Error('postgres://user:secret@host failed'));
    await worker.tick(at('2026-11-27T16:00:00Z'));
    expect(store.finishSync).toHaveBeenLastCalledWith(
      'us-macro-calendar',
      expect.any(String),
      { ok: false, code: 'error' },
    );
  });

  it('backs off for an hour when the sync state cannot be read', async () => {
    const store = repository();
    store.syncState.mockRejectedValue(
      new Error('relation "market_event_sync_state" does not exist'),
    );
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const worker = new MarketEventsWorker(
      store as never,
      new UsEquityCalendarService(),
      {} as never,
    );
    await worker.tick(at('2026-11-27T16:00:00Z'));
    await worker.tick(at('2026-11-27T16:30:00Z'));
    expect(store.syncState).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Macro calendar refresh failed: error');
    await worker.tick(at('2026-11-27T17:01:00Z'));
    expect(store.syncState).toHaveBeenCalledTimes(2);
  });
});

describe('macro calendar providers', () => {
  it('resolve through Nest DI and stay idle in previews', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, PREVIEW_ENV);
    const interval = jest.spyOn(global, 'setInterval');
    try {
      const module = await Test.createTestingModule({
        providers: [
          UsEquityCalendarService,
          MarketEventsRepository,
          MarketCalendarService,
          MarketEventsWorker,
          { provide: APP_ENV, useValue: {} },
          { provide: DRIZZLE, useValue: {} },
        ],
      }).compile();
      await module.init();
      expect(module.get(MarketEventsWorker)).toBeInstanceOf(MarketEventsWorker);
      expect(module.get(MarketCalendarService).isMarketOpen().scope).toBe(
        'us_equity_cash_session',
      );
      expect(interval).not.toHaveBeenCalled();
      await module.close();
    } finally {
      process.env = saved;
      interval.mockRestore();
    }
  });
});
