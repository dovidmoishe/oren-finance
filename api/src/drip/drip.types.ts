export const DRIP_OPINION_FETCH_LIMIT = 40;
export const DRIP_OPINION_RETURN_DEFAULT = 8;
export const DRIP_OPINION_RETURN_MAX = 12;
export const DRIP_PICKS_FETCH_LIMIT = 15;
export const DRIP_PICKS_FETCH_DAYS = 2;
export const DRIP_PICKS_RETURN_DEFAULT = 8;
export const DRIP_PICKS_RETURN_MAX = 12;

export const DRIP_DISCLAIMER =
  'Drip opinions from Substack writers and podcasters. They are opinions, not facts, and not financial advice.';

export type DripStance = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export type DripFailureReason =
  | 'DRIP_UNSET'
  | 'DRIP_TIMEOUT'
  | 'DRIP_RATE_LIMITED'
  | 'DRIP_FORBIDDEN'
  | 'DRIP_UNAVAILABLE'
  | 'DRIP_BAD_TICKER';

export interface DripCitation {
  author: string;
  source?: string;
  date?: string;
  stance?: DripStance;
  action?: string;
  summary?: string;
  quote?: string;
  url?: string;
  guest?: boolean;
}

export interface DripOpinionSummary {
  calls: number;
  analysts: number;
  bullish: number;
  bearish: number;
  neutral: number;
  unstated?: number;
  byAction: Record<string, number>;
}

export interface DripOpinions {
  available: true;
  source: 'drip';
  queried: string;
  ticker: string;
  mappedFrom?: string;
  window?: { from?: string; to?: string };
  asOf?: string;
  summary: DripOpinionSummary;
  truncated: boolean;
  opinions: DripCitation[];
  disclaimer: string;
}

export interface DripPick extends DripCitation {
  ticker: string;
}

export interface DripPicks {
  available: true;
  source: 'drip';
  window?: { from?: string; to?: string };
  asOf?: string;
  truncated: boolean;
  picks: DripPick[];
  disclaimer: string;
}

export interface DripUnavailable {
  available: false;
  source: 'drip';
  reason: DripFailureReason;
  queried?: string;
  ticker?: string;
  message: string;
}

export type DripOpinionResult = DripOpinions | DripUnavailable;
export type DripPicksResult = DripPicks | DripUnavailable;

/** Cached opinions before the caller's symbol and limit are applied. */
export interface CachedDripOpinions {
  ticker: string;
  window?: { from?: string; to?: string };
  asOf?: string;
  summary: DripOpinionSummary;
  truncated: boolean;
  opinions: DripCitation[];
}

export interface CachedDripPicks {
  window?: { from?: string; to?: string };
  asOf?: string;
  truncated: boolean;
  picks: DripPick[];
}
