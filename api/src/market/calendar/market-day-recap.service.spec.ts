import type { MarketCandle } from '../../../types/market';
import type { MarketNewsItem } from '../../../types/news';
import type { EquityNewsService } from '../../news/equity-news.service';
import type { TokensService } from '../../tokens/tokens.service';
import type { MarketCalendarService } from './market-calendar.service';
import {
  MarketDayRecapService,
  RECAP_INDEXES,
  RECAP_NAMES,
  dayMove,
  mentions,
} from './market-day-recap.service';
import { UsEquityCalendarService } from './us-equity-calendar.service';

function candle(date: string, close: number): MarketCandle {
  return {
    timestamp: new Date(`${date}T00:00:00Z`),
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  };
}

const hours = new UsEquityCalendarService();

describe('dayMove', () => {
  it('compares a Monday with Friday, never with weekend on-chain candles', () => {
    const candles = [
      candle('2026-11-20', 100),
      candle('2026-11-21', 90),
      candle('2026-11-22', 95),
      candle('2026-11-23', 102),
    ];
    const move = dayMove(candles, '2026-11-23', hours);
    expect(move).toMatchObject({
      close: 102,
      previousClose: 100,
      previousDate: '2026-11-20',
    });
    expect(move?.changePct).toBeCloseTo(2, 6);
  });

  it('skips a full holiday on the next trading day', () => {
    const candles = [
      candle('2026-11-25', 200),
      candle('2026-11-26', 150),
      candle('2026-11-27', 202),
    ];
    expect(dayMove(candles, '2026-11-27', hours)?.previousDate).toBe(
      '2026-11-25',
    );
  });

  it('measures a closed day against the previous candle, which is on-chain trading', () => {
    const candles = [candle('2026-11-20', 100), candle('2026-11-21', 99)];
    expect(dayMove(candles, '2026-11-21', hours)?.changePct).toBeCloseTo(-1, 6);
  });

  it('returns nothing without a candle for the date or a usable previous close', () => {
    expect(
      dayMove([candle('2026-11-20', 100)], '2026-11-23', hours),
    ).toBeNull();
    expect(
      dayMove([candle('2026-11-23', 100)], '2026-11-23', hours),
    ).toBeNull();
    expect(
      dayMove(
        [candle('2026-11-20', 0), candle('2026-11-23', 100)],
        '2026-11-23',
        hours,
      ),
    ).toBeNull();
  });

  it('never reports a multi-day move when the previous trading day has no candle', () => {
    // Russell 2000 on-chain: no candle on Tuesday the 24th.
    const candles = [candle('2026-11-20', 100), candle('2026-11-25', 110)];
    expect(dayMove(candles, '2026-11-25', hours)).toBeNull();
  });
});

describe('MarketDayRecapService', () => {
  const now = new Date('2026-11-27T20:00:00Z'); // 3 p.m. ET, after the 1 p.m. early close

  function build(
    options: {
      closes?: Record<string, [number, number]>;
      news?: Record<string, MarketNewsItem[]>;
      failing?: string[];
    } = {},
  ) {
    const getCandlesForWindow = jest.fn((assetId: string) => {
      if (options.failing?.includes(assetId))
        return Promise.reject(new Error('upstream'));
      const [previous, close] = options.closes?.[assetId] ?? [100, 100];
      return Promise.resolve([
        candle('2026-11-24', 90),
        candle('2026-11-25', previous),
        candle('2026-11-26', previous),
        candle('2026-11-27', close),
      ]);
    });
    const getNews = jest.fn((ticker: string) =>
      Promise.resolve(options.news?.[ticker] ?? []),
    );
    const getEvents = jest.fn(() =>
      Promise.resolve({
        events: [{ id: 'claims', kind: 'jobless_claims' }],
        attribution: { sources: [], notices: ['notice'] },
      }),
    );
    const service = new MarketDayRecapService(
      { getCandlesForWindow } as unknown as TokensService,
      hours,
      { getEvents } as unknown as MarketCalendarService,
      { getNews } as unknown as EquityNewsService,
    );
    return { service, getCandlesForWindow, getNews, getEvents };
  }

  it('ranks the three biggest moves each way and keeps index moves apart', async () => {
    const { service } = build({
      closes: {
        sp500: [100, 101],
        nvidia: [100, 110],
        tesla: [100, 92],
        apple: [100, 103],
        amd: [100, 104],
        meta: [100, 99],
        microsoft: [100, 101],
      },
    });
    const recap = await service.getRecap('2026-11-27', now);
    expect(recap.status).toBe('complete');
    expect(recap.indexes.map((move) => move.ticker)).toEqual([
      'SPY',
      'QQQ',
      'IWM',
    ]);
    expect(recap.indexes[0].changePct).toBeCloseTo(1, 6);
    expect(recap.gainers.map((move) => move.ticker)).toEqual([
      'NVDA',
      'AMD',
      'AAPL',
    ]);
    expect(recap.losers.map((move) => move.ticker)).toEqual(['TSLA', 'META']);
    expect(recap.releases).toHaveLength(1);
    expect(recap.attribution.notices).toEqual(['notice']);
    expect(recap.notes.join(' ')).toMatch(/tokenized-stock prices/);
  });

  it('fetches each asset history once and reuses it for other dates', async () => {
    const { service, getCandlesForWindow } = build();
    await service.getRecap('2026-11-27', now);
    await service.getRecap('2026-11-25', now);
    expect(getCandlesForWindow).toHaveBeenCalledTimes(
      RECAP_INDEXES.length + RECAP_NAMES.length,
    );
    expect(getCandlesForWindow).toHaveBeenCalledWith(
      'sp500',
      expect.objectContaining({ interval: '1D' }),
    );
  });

  it('leaves out an asset whose candles fail instead of failing the day', async () => {
    const { service } = build({ failing: ['sp500', 'nvidia'] });
    const recap = await service.getRecap('2026-11-27', now);
    expect(recap.indexes.map((move) => move.ticker)).toEqual(['QQQ', 'IWM']);
  });

  it('keeps headlines from that New York day, market feeds first, two per ticker', async () => {
    const item = (
      headline: string,
      at: string,
      url = `https://example.com/${encodeURIComponent(headline)}`,
    ): MarketNewsItem => ({
      headline,
      url,
      source: 'Example',
      publishedAt: new Date(at),
    });
    const { service } = build({
      closes: { nvidia: [100, 110] },
      news: {
        SPY: [
          item('Stocks rise after the holiday', '2026-11-27T15:00:00Z'),
          item('Yesterday', '2026-11-26T15:00:00Z'),
          item('Late Thursday ET', '2026-11-27T03:00:00Z'),
        ],
        QQQ: [
          item(
            'Stocks rise after the holiday',
            '2026-11-27T15:00:00Z',
            'https://example.com/copy',
          ),
          item('Chips lead', '2026-11-27T18:00:00Z'),
        ],
        NVDA: [
          item('NVDA one', '2026-11-27T19:00:00Z'),
          item('NVIDIA two', '2026-11-27T19:10:00Z'),
          item('NVDA three', '2026-11-27T19:20:00Z'),
          item('Circle hits a new low', '2026-11-27T19:30:00Z'),
        ],
      },
    });
    const recap = await service.getRecap('2026-11-27', now);
    expect(recap.headlinesAvailable).toBe(true);
    expect(recap.headlines.map((headline) => headline.headline)).toEqual([
      'Stocks rise after the holiday',
      'Chips lead',
      'NVDA three',
      'NVIDIA two',
    ]);
    expect(recap.headlines[1]).toMatchObject({
      ticker: 'QQQ',
      source: 'Example',
    });
  });

  it('does not reach for prices or headlines on a future day or beyond the feeds', async () => {
    const { service, getCandlesForWindow, getNews } = build();
    const future = await service.getRecap('2026-12-09', now);
    expect(future).toMatchObject({
      status: 'upcoming',
      indexes: [],
      gainers: [],
      headlines: [],
      headlinesAvailable: false,
    });
    expect(getCandlesForWindow).not.toHaveBeenCalled();
    const old = await service.getRecap('2026-11-10', now);
    expect(old.headlinesAvailable).toBe(false);
    expect(getNews).not.toHaveBeenCalled();
  });

  it('marks today in progress before the close and weekends closed', async () => {
    const { service } = build();
    expect(
      (await service.getRecap('2026-11-27', new Date('2026-11-27T16:00:00Z')))
        .status,
    ).toBe('in_progress');
    expect((await service.getRecap('2026-11-26', now)).status).toBe('closed');
    expect((await service.getRecap('2026-11-22', now)).status).toBe('closed');
  });

  it('rejects malformed dates and dates more than a year out', async () => {
    const { service } = build();
    await expect(service.getRecap('2026-13-01', now)).rejects.toThrow();
    await expect(service.getRecap('2028-01-01', now)).rejects.toThrow(
      /within the next year/,
    );
  });
});

describe('mentions', () => {
  it('matches a ticker or name as a whole word only', () => {
    expect(mentions('Robinhood (HOOD) expands', ['HOOD', 'Robinhood'])).toBe(
      true,
    );
    expect(
      mentions('Why has Strategy stock trailed?', ['MSTR', 'Strategy']),
    ).toBe(true);
    expect(mentions('Circle is down 13% in a week', ['MSTR', 'Strategy'])).toBe(
      false,
    );
    expect(mentions('Childhood savings rise', ['HOOD'])).toBe(false);
  });
});
