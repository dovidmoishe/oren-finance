import { Injectable } from '@nestjs/common';
import type {
  UsEquityClosuresResponse,
  UsEquitySessionMode,
  UsEquitySessionResponse,
  UsEquityTradingDayResponse,
} from '../../../types/market-calendar';
import { sessionSummary } from '../us-market-session';
import { US_CASH_SESSION_NOTE } from './market-calendar.copy';
import { NYSE_HOURS_URL } from './nyse-schedule';
import { US_EQUITY_TIME_ZONE, UsEquityCalendar } from './us-equity-calendar';

/**
 * The US equity cash calendar for every Oren caller: API modules, workers,
 * the copilot, MCP, the morning brief, and trade flows. Inject this; never
 * copy holiday arrays or re-derive NYSE rules elsewhere.
 *
 * It answers the US cash session only. Tokenized stocks on Solana trade on
 * secondary markets around the clock, and each issuer runs its own windows.
 * Those differences are documented here and in the copilot tool text, not
 * modelled as separate holiday tables:
 *
 * - xStocks: secondary trading 24/7. Issuance and redemption run 24/5 on
 *   business days when the US market is open.
 *   https://docs.xstocks.fi/docs/frequently-asked-questions
 * - Ondo: generally 24/5, Sunday 8:05 p.m. to Friday 7:59 p.m. ET when US
 *   markets are open, halted on NYSE holidays except assets enabled for
 *   Off-Hours trading. Since 25 Jun 2026, 24/7 mint/redeem covers only SPYon,
 *   QQQon, CRCLon, NVDAon, TSLAon, and GOOGLon; treat other Ondo tickers as
 *   24/5 until their docs say otherwise.
 *   https://docs.ondo.finance/ondo-stocks/market-hours-and-trading-availability
 * - Backpack: Backpack Exchange says some eligible securities trade on
 *   weekends and US holidays and that early closes follow the official
 *   schedule. That is the exchange; on-chain Backpack mint/redeem behaviour
 *   on US holidays is unverified.
 *   https://support.backpack.exchange/backpack-securities/stock-trading-hours-and-fees
 */
@Injectable()
export class UsEquityCalendarService extends UsEquityCalendar {
  constructor() {
    super();
  }

  /** Point-in-time cash-session state plus that New York day's hours. */
  getSession(
    at: Date = new Date(),
    mode: UsEquitySessionMode = 'regular',
  ): UsEquitySessionResponse {
    const state = this.sessionStateAt(at);
    const date = this.etDate(at);
    const hours = this.getHours(date);
    const nextOpen = this.nextRegularOpen(at);
    const nextClose = this.nextRegularClose(at);
    const previousClose = this.previousRegularClose(at);
    const provisional =
      hours.provisional ||
      [nextOpen, nextClose, previousClose].some(
        (instant) => this.day(this.etDate(instant)).provisional,
      );
    return {
      scope: 'us_equity_cash_session',
      state,
      regular: state === 'regular',
      summary: sessionSummary(state, 'market'),
      observedAt: at.toISOString(),
      timeZone: US_EQUITY_TIME_ZONE,
      date,
      session: mode,
      isOpen: this.isOpen(at, mode),
      tradingDay: hours.tradingDay,
      earlyClose: hours.earlyClose,
      holidayName: hours.holidayName,
      nextRegularOpen: nextOpen.toISOString(),
      nextRegularClose: nextClose.toISOString(),
      previousRegularClose: previousClose.toISOString(),
      hours,
      source: provisional ? 'computed' : hours.source,
      provisional,
      note: US_CASH_SESSION_NOTE,
    };
  }

  getClosures(year: number): UsEquityClosuresResponse {
    return {
      ...this.listClosures(year),
      timeZone: US_EQUITY_TIME_ZONE,
      sourceUrl: NYSE_HOURS_URL,
      note: US_CASH_SESSION_NOTE,
    };
  }

  getTradingDay(
    date: string,
    direction: 'next' | 'previous' = 'next',
  ): UsEquityTradingDayResponse {
    const tradingDay =
      direction === 'next'
        ? this.nextTradingDay(date)
        : this.previousTradingDay(date);
    const hours = this.getHours(tradingDay);
    return {
      date,
      direction,
      tradingDay,
      hours,
      source: hours.source,
      provisional: hours.provisional,
    };
  }
}
