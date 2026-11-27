import { Injectable, Logger } from '@nestjs/common';
import type { MarketCandle } from '../../../types/market';
import type {
  MarketDayHeadline,
  MarketDayMove,
  MarketDayRecap,
  MarketDayStatus,
} from '../../../types/market-calendar';
import type { MarketNewsItem } from '../../../types/news';
import { EquityNewsService } from '../../news/equity-news.service';
import { TokensService } from '../../tokens/tokens.service';
import { MarketReadCache } from '../market-read-cache';
import { MarketCalendarService } from './market-calendar.service';
import { US_CASH_SESSION_NOTE } from './market-calendar.copy';
import {
  addDays,
  parseCivilDate,
  UsEquityCalendarRangeError,
} from './us-equity-calendar';
import { UsEquityCalendarService } from './us-equity-calendar.service';

interface TrackedAsset {
  assetId: string;
  ticker: string;
  name: string;
}

/** Tokenized ETFs that track the three broad US indexes. */
export const RECAP_INDEXES: readonly TrackedAsset[] = [
  { assetId: 'sp500', ticker: 'SPY', name: 'S&P 500' },
  { assetId: 'nasdaq', ticker: 'QQQ', name: 'Nasdaq 100' },
  { assetId: 'russell-2000', ticker: 'IWM', name: 'Russell 2000' },
];

/** Large, liquid US names Oren lists. Movers are chosen from these only. */
export const RECAP_NAMES: readonly TrackedAsset[] = [
  { assetId: 'nvidia', ticker: 'NVDA', name: 'NVIDIA' },
  { assetId: 'apple', ticker: 'AAPL', name: 'Apple' },
  { assetId: 'microsoft', ticker: 'MSFT', name: 'Microsoft' },
  { assetId: 'amazon', ticker: 'AMZN', name: 'Amazon' },
  { assetId: 'alphabet', ticker: 'GOOGL', name: 'Alphabet' },
  { assetId: 'meta', ticker: 'META', name: 'Meta' },
  { assetId: 'tesla', ticker: 'TSLA', name: 'Tesla' },
  { assetId: 'broadcom', ticker: 'AVGO', name: 'Broadcom' },
  { assetId: 'amd', ticker: 'AMD', name: 'AMD' },
  { assetId: 'netflix', ticker: 'NFLX', name: 'Netflix' },
  { assetId: 'coinbase', ticker: 'COIN', name: 'Coinbase' },
  { assetId: 'microstrategy', ticker: 'MSTR', name: 'Strategy' },
  { assetId: 'palantir', ticker: 'PLTR', name: 'Palantir' },
  { assetId: 'robinhood', ticker: 'HOOD', name: 'Robinhood' },
  { assetId: 'eli-lilly', ticker: 'LLY', name: 'Eli Lilly' },
  { assetId: 'jpmorgan-chase', ticker: 'JPM', name: 'JPMorgan Chase' },
  {
    assetId: 'berkshire-hathaway',
    ticker: 'BRK.B',
    name: 'Berkshire Hathaway',
  },
  { assetId: 'visa', ticker: 'V', name: 'Visa' },
  { assetId: 'oracle', ticker: 'ORCL', name: 'Oracle' },
];

/** Daily candles are kept for a year; a little more covers the previous close. */
const HISTORY_DAYS = 400;
/**
 * The Yahoo per-ticker feeds the app already reads return about 20 recent
 * stories: a few days for most names, less for busy ones. Older dates are not
 * worth a request.
 */
const HEADLINE_REACH_DAYS = 7;
const HEADLINES_PER_TICKER = 2;
const MOVERS = 3;
const MAX_HEADLINES = 6;

export const RECAP_PRICE_NOTE =
  'Moves use the tokenized-stock prices Oren trades, from Tokens: each close against the previous trading day close. On days the US market is closed they reflect on-chain trading.';
export const RECAP_HEADLINES_NOTE =
  'Headlines are the stories published that day in the ticker feeds Oren already shows. They are not a complete record of the day.';

function utcDate(at: Date) {
  return at.toISOString().slice(0, 10);
}

/**
 * Day-at-a-glance for the Calendar and the copilot: index and large-name
 * moves from daily candles, the day's official releases, and the headlines
 * the existing feeds still carry. No model writes any of it.
 */
@Injectable()
export class MarketDayRecapService {
  private readonly logger = new Logger(MarketDayRecapService.name);
  private readonly series = new MarketReadCache<MarketCandle[]>(
    15 * 60_000,
    64,
    6,
    64,
  );

  constructor(
    private readonly tokens: TokensService,
    private readonly hours: UsEquityCalendarService,
    private readonly calendar: MarketCalendarService,
    private readonly news: EquityNewsService,
  ) {}

  async getRecap(
    date: string,
    now: Date = new Date(),
  ): Promise<MarketDayRecap> {
    parseCivilDate(date);
    const hours = this.hours.getHours(date);
    const today = this.hours.etDate(now);
    if (date > addDays(today, 366))
      throw new UsEquityCalendarRangeError('Pick a date within the next year');
    const status = this.status(
      date,
      today,
      hours.tradingDay,
      hours.regularCloseUtc,
      now,
    );
    const releases = this.calendar.getEvents({ from: date, to: date, now });

    let indexes: MarketDayMove[] = [];
    let moves: MarketDayMove[] = [];
    if (status !== 'upcoming') {
      [indexes, moves] = await Promise.all([
        this.moves(RECAP_INDEXES, date, now),
        this.moves(RECAP_NAMES, date, now),
      ]);
    }
    const ranked = [...moves].sort((a, b) => b.changePct - a.changePct);
    const gainers = ranked
      .filter((move) => move.changePct > 0)
      .slice(0, MOVERS);
    const losers = ranked
      .filter((move) => move.changePct < 0)
      .reverse()
      .slice(0, MOVERS);

    const headlinesAvailable =
      status !== 'upcoming' && date >= addDays(today, -HEADLINE_REACH_DAYS);
    const headlines = headlinesAvailable
      ? await this.headlines(date, [
          { ticker: 'SPY' },
          { ticker: 'QQQ' },
          ...[...gainers, ...losers].slice(0, 4).map((move) => ({
            ticker: move.ticker,
            about: [move.ticker, move.name],
          })),
        ])
      : [];

    const events = await releases;
    return {
      date,
      timeZone: 'America/New_York',
      status,
      hours,
      indexes,
      gainers,
      losers,
      releases: events.events,
      headlines,
      headlinesAvailable,
      notes: [RECAP_PRICE_NOTE, RECAP_HEADLINES_NOTE, US_CASH_SESSION_NOTE],
      attribution: events.attribution,
      generatedAt: now.toISOString(),
    };
  }

  private status(
    date: string,
    today: string,
    tradingDay: boolean,
    regularCloseUtc: string | null,
    now: Date,
  ): MarketDayStatus {
    if (date > today) return 'upcoming';
    if (!tradingDay) return 'closed';
    if (date === today && regularCloseUtc && now < new Date(regularCloseUtc))
      return 'in_progress';
    return 'complete';
  }

  private async moves(
    assets: readonly TrackedAsset[],
    date: string,
    now: Date,
  ) {
    const results = await Promise.all(
      assets.map(async (asset) => {
        const candles = await this.history(asset.assetId, now).catch(
          (error: unknown) => {
            this.logger.warn(
              `Recap candles failed for ${asset.assetId}: ${error instanceof Error ? error.name : 'Error'}`,
            );
            return [];
          },
        );
        const move = dayMove(candles, date, this.hours);
        return move ? { ...asset, ...move } : null;
      }),
    );
    return results.filter((move): move is MarketDayMove => move !== null);
  }

  /** One year of daily candles per asset, shared by every date's recap. */
  private history(assetId: string, now: Date) {
    const to = Math.floor(now.getTime() / 1000);
    return this.series.get(assetId, () =>
      this.tokens.getCandlesForWindow(assetId, {
        interval: '1D',
        from: to - HISTORY_DAYS * 86_400,
        to,
      }),
    );
  }

  /**
   * Index feeds are market-wide, so every story counts. A mover's feed also
   * carries stories about other companies; keep only those that name it.
   */
  private async headlines(
    date: string,
    sources: Array<{ ticker: string; about?: string[] }>,
  ): Promise<MarketDayHeadline[]> {
    const unique = [
      ...new Map(sources.map((source) => [source.ticker, source])).values(),
    ];
    const feeds = await Promise.all(
      unique.map(({ ticker, about }) =>
        this.news.getNews(ticker).then(
          (items) =>
            items
              .filter((item) => !about || mentions(item.headline, about))
              .map((item) => ({ item, ticker })),
          () => [] as Array<{ item: MarketNewsItem; ticker: string }>,
        ),
      ),
    );
    const seen = new Set<string>();
    const perTicker = new Map<string, number>();
    // Feeds arrive in priority order (index ETFs, then the day's movers), and
    // no single ticker may fill the list.
    return feeds
      .flatMap((feed) =>
        feed
          .filter(
            ({ item }) =>
              item.url && this.hours.etDate(item.publishedAt) === date,
          )
          .sort(
            (a, b) =>
              b.item.publishedAt.getTime() - a.item.publishedAt.getTime(),
          ),
      )
      .filter(({ item, ticker }) => {
        const key = item.headline.trim().toLowerCase();
        if (seen.has(key) || seen.has(item.url!)) return false;
        if ((perTicker.get(ticker) ?? 0) >= HEADLINES_PER_TICKER) return false;
        seen.add(key);
        seen.add(item.url!);
        perTicker.set(ticker, (perTicker.get(ticker) ?? 0) + 1);
        return true;
      })
      .slice(0, MAX_HEADLINES)
      .map(({ item, ticker }) => ({
        headline: item.headline,
        source: item.source ?? null,
        url: item.url!,
        publishedAt: item.publishedAt.toISOString(),
        ticker,
      }));
  }
}

/**
 * A date's close against the previous close. On a trading day that is the
 * previous trading day's close, so weekend on-chain candles never stand in
 * for Friday. On a closed day it is the day before, which is on-chain
 * trading. A missing previous candle means no move, never a multi-day one.
 */
export function dayMove(
  candles: readonly MarketCandle[],
  date: string,
  calendar: Pick<
    UsEquityCalendarService,
    'isTradingDay' | 'previousTradingDay'
  >,
): Omit<MarketDayMove, 'assetId' | 'ticker' | 'name'> | null {
  const byDate = new Map(
    candles.map((candle) => [utcDate(new Date(candle.timestamp)), candle]),
  );
  const day = byDate.get(date);
  if (!day || !(day.close > 0)) return null;
  const previousDate = calendar.isTradingDay(date)
    ? calendar.previousTradingDay(date)
    : addDays(date, -1);
  const previous = byDate.get(previousDate);
  if (!previous || !(previous.close > 0)) return null;
  return {
    close: day.close,
    previousClose: previous.close,
    previousDate,
    changePct: (day.close / previous.close - 1) * 100,
  };
}

/** Whole-word, case-insensitive match of any name in a headline. */
export function mentions(headline: string, names: readonly string[]): boolean {
  const normalize = (text: string) =>
    ` ${text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()} `;
  const text = normalize(headline);
  return names.some((name) => {
    const needle = normalize(name);
    return needle.trim().length > 0 && text.includes(needle);
  });
}
