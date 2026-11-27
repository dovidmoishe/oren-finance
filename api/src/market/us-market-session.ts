import type {
  MarketSession,
  UsMarketSessionState,
} from '../../types/market-session';
import type { Quote } from '../../types/quote';
import { usEquityCalendar } from './calendar/us-equity-calendar';

/**
 * Quote and order stamping for the NYSE cash session. The holiday table,
 * early closes, and session clock live in calendar/us-equity-calendar.ts;
 * this file only turns a state into the approved trade copy.
 *
 * https://www.nyse.com/trade/hours-calendars
 */
export const NYSE_CALENDAR_COVERED_THROUGH =
  usEquityCalendar.officialCoverage().through;

export const THIN_BOOK_IMPACT_PERCENT = 1;
export const THIN_BOOK_LIQUIDITY_USD = 100_000;

const PRE_MARKET_SUMMARY =
  "US markets aren't in the regular session yet. This price is the on-chain market, and it can differ from the next open.";
const AFTER_HOURS_SUMMARY =
  'The regular US session is over. On-chain prices can drift until the next open.';
const OVERNIGHT_SUMMARY =
  'US markets are closed for the night. The on-chain book is often thinner, and the price can sit away from the stock until the open.';
const CLOSED_SUMMARY =
  'US markets are closed. On-chain liquidity is often thinner, and the price can sit away from the stock until the next open.';
const REGULAR_SUMMARY = 'US markets are in the regular session.';
const LIMIT_SUMMARY =
  "US markets aren't in the regular session. This limit uses the on-chain price, which may not match the next open. It fills only if the market reaches your price.";
const THIN_BOOK_SENTENCE =
  'This size also moves the on-chain price more than a typical fill. A smaller amount usually lands closer.';

export interface MarketSessionInput {
  at?: Date;
  kind?: 'market' | 'limit';
  priceImpactPercent?: number;
  liquidityUsd?: number;
}

export function usMarketSession(at: Date = new Date()): MarketSession {
  return marketSessionForTrade({ at, kind: 'market' });
}

export function marketSessionForTrade(
  input: MarketSessionInput = {},
): MarketSession {
  const at = input.at ?? new Date();
  const state = usEquityCalendar.sessionStateAt(at);
  const regular = state === 'regular';
  const kind = input.kind ?? 'market';
  const impact = input.priceImpactPercent ?? 0;
  const illiquid =
    input.liquidityUsd !== undefined &&
    input.liquidityUsd < THIN_BOOK_LIQUIDITY_USD;
  const thinBook = !regular && (impact >= THIN_BOOK_IMPACT_PERCENT || illiquid);
  const base = sessionSummary(state, kind);
  const summary =
    kind === 'market' && thinBook ? `${base} ${THIN_BOOK_SENTENCE}` : base;
  return {
    state,
    regular,
    summary,
    observedAt: at.toISOString(),
    thinBook,
  };
}

/** Attach a session to a catalog stock quote. Non-equity mints are left alone. */
export function stampQuoteMarketSession(quote: Quote, at = new Date()): Quote {
  if (!quote.assetId || quote.assetId === 'unknown') return quote;
  quote.marketSession = marketSessionForTrade({
    at,
    kind: 'market',
    priceImpactPercent: quote.priceImpactPercent,
    liquidityUsd: quote.variant?.liquidity,
  });
  return quote;
}

/** The approved one-line copy for a session state. */
export function sessionSummary(
  state: UsMarketSessionState,
  kind: 'market' | 'limit' = 'market',
): string {
  if (state === 'regular') return REGULAR_SUMMARY;
  if (kind === 'limit') return LIMIT_SUMMARY;
  switch (state) {
    case 'pre_market':
      return PRE_MARKET_SUMMARY;
    case 'after_hours':
    case 'early_close':
      return AFTER_HOURS_SUMMARY;
    case 'overnight':
      return OVERNIGHT_SUMMARY;
    case 'closed':
      return CLOSED_SUMMARY;
  }
}
