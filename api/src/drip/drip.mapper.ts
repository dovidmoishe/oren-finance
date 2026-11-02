import {
  DRIP_DISCLAIMER,
  DRIP_OPINION_RETURN_MAX,
  DRIP_PICKS_RETURN_MAX,
  type CachedDripOpinions,
  type CachedDripPicks,
  type DripCitation,
  type DripOpinionSummary,
  type DripOpinions,
  type DripPick,
  type DripPicks,
  type DripStance,
} from './drip.types';

const QUOTE_LIMIT = 180;
const SUMMARY_LIMIT = 220;
const LABEL_LIMIT = 80;

export function compactTickerCoverage(
  body: unknown,
): CachedDripOpinions | null {
  if (!isRecord(body) || !Array.isArray(body.authors)) return null;
  const meta = isRecord(body.meta) ? body.meta : {};
  const ticker = text(meta.ticker)?.toUpperCase();
  if (!ticker) return null;

  const opinions = flattenMentions(body.authors);
  const summary = compactSummary(body.summary, opinions.length);
  const upstreamTruncated = meta.truncated === true;
  return {
    ticker,
    window: windowFrom(meta.from, meta.to),
    asOf: text(meta.asOf),
    summary,
    truncated: upstreamTruncated || opinions.length > DRIP_OPINION_RETURN_MAX,
    opinions: opinions.slice(0, DRIP_OPINION_RETURN_MAX),
  };
}

export function compactPicks(body: unknown): CachedDripPicks | null {
  if (!isRecord(body) || !Array.isArray(body.picks)) return null;
  const meta = isRecord(body.meta) ? body.meta : {};
  const applied = isRecord(meta.appliedRange) ? meta.appliedRange : {};
  const picks = body.picks
    .map(compactPick)
    .filter((pick): pick is DripPick => pick !== null)
    .sort((left, right) => timeValue(right.date) - timeValue(left.date));
  return {
    window: windowFrom(applied.from, applied.to),
    asOf: text(meta.asOf),
    truncated: picks.length > DRIP_PICKS_RETURN_MAX,
    picks: picks.slice(0, DRIP_PICKS_RETURN_MAX),
  };
}

export function presentOpinions(
  cached: CachedDripOpinions,
  queried: string,
  mappedFrom: string | undefined,
  limit: number,
): DripOpinions {
  const opinions = cached.opinions.slice(0, limit);
  return defined({
    available: true as const,
    source: 'drip' as const,
    queried,
    ticker: cached.ticker,
    mappedFrom,
    window: cached.window,
    asOf: cached.asOf,
    summary: cached.summary,
    truncated: cached.truncated || opinions.length < cached.opinions.length,
    opinions,
    disclaimer: DRIP_DISCLAIMER,
  });
}

export function presentPicks(
  cached: CachedDripPicks,
  limit: number,
): DripPicks {
  const picks = cached.picks.slice(0, limit);
  return defined({
    available: true as const,
    source: 'drip' as const,
    window: cached.window,
    asOf: cached.asOf,
    truncated: cached.truncated || picks.length < cached.picks.length,
    picks,
    disclaimer: DRIP_DISCLAIMER,
  });
}

export function emptyOpinions(ticker: string): CachedDripOpinions {
  return {
    ticker,
    summary: {
      calls: 0,
      analysts: 0,
      bullish: 0,
      bearish: 0,
      neutral: 0,
      byAction: {},
    },
    truncated: false,
    opinions: [],
  };
}

function flattenMentions(authors: unknown[]): DripCitation[] {
  const citations: DripCitation[] = [];
  for (const group of authors) {
    if (!isRecord(group) || !Array.isArray(group.mentions)) continue;
    const author = clip(group.author, LABEL_LIMIT);
    if (!author) continue;
    for (const mention of group.mentions) {
      const citation = compactMention(author, mention);
      if (citation) citations.push(citation);
    }
  }
  const sorted = citations.sort(
    (left, right) => timeValue(right.date) - timeValue(left.date),
  );
  const seen = new Set<string>();
  const perAuthor = new Map<string, number>();
  return sorted.filter((item) => {
    if (!item.url || !item.date || !Number.isFinite(Date.parse(item.date)))
      return false;
    const author = item.author.toLowerCase();
    const key = `${author}|${(item.summary ?? item.quote ?? '').toLowerCase().replace(/\W+/g, '')}`;
    if (seen.has(key) || (perAuthor.get(author) ?? 0) >= 2) return false;
    seen.add(key);
    perAuthor.set(author, (perAuthor.get(author) ?? 0) + 1);
    return true;
  });
}

function compactMention(author: string, mention: unknown): DripCitation | null {
  if (!isRecord(mention)) return null;
  const summary =
    clip(mention.thesis, SUMMARY_LIMIT) ??
    clip(mention.rationaleSnippet, SUMMARY_LIMIT);
  const quote = clip(mention.evidenceQuote, QUOTE_LIMIT);
  if (!summary && !quote) return null;
  return defined({
    author,
    source: clip(mention.articleTitle, LABEL_LIMIT),
    date: text(mention.publishedAt),
    stance: stanceOf(mention.sentiment),
    action: text(mention.action),
    summary,
    quote,
    url: safeUrl(mention.articleUrl),
    guest: mention.speakerIsGuest === true ? true : undefined,
  });
}

function compactPick(pick: unknown): DripPick | null {
  if (!isRecord(pick)) return null;
  const ticker = text(pick.ticker)?.toUpperCase();
  const author = clip(pick.author, LABEL_LIMIT);
  if (!ticker || !author) return null;
  const url = safeUrl(pick.articleUrl);
  const date = text(pick.publishedAt) ?? text(pick.date);
  if (!url || !date || !Number.isFinite(Date.parse(date))) return null;
  const summary =
    clip(pick.thesis, SUMMARY_LIMIT) ??
    clip(pick.rationaleSnippet, SUMMARY_LIMIT);
  const quote = clip(pick.evidenceQuote, QUOTE_LIMIT);
  if (!summary && !quote) return null;
  return defined({
    ticker,
    author,
    source:
      clip(pick.publicationTitle, LABEL_LIMIT) ??
      clip(pick.publicationSlug, LABEL_LIMIT),
    date,
    stance: stanceOf(pick.sentiment),
    action: text(pick.action),
    summary,
    quote,
    url,
    guest: pick.speakerIsGuest === true ? true : undefined,
  });
}

function compactSummary(value: unknown, returned: number): DripOpinionSummary {
  const summary = isRecord(value) ? value : {};
  const calls = count(summary.calls) ?? returned;
  const bullish = count(summary.bullish) ?? 0;
  const bearish = count(summary.bearish) ?? 0;
  const neutral = count(summary.neutral) ?? 0;
  const unstated = Math.max(0, calls - bullish - bearish - neutral);
  return defined({
    calls,
    analysts: count(summary.analysts) ?? 0,
    bullish,
    bearish,
    neutral,
    unstated: unstated > 0 ? unstated : undefined,
    byAction: actionCounts(summary.byAction),
  });
}

function actionCounts(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const counts: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const parsed = count(raw);
    if (parsed !== undefined && parsed > 0) counts[key] = parsed;
  }
  return counts;
}

function windowFrom(
  from: unknown,
  to: unknown,
): { from?: string; to?: string } | undefined {
  const start = text(from);
  const end = text(to);
  if (!start && !end) return undefined;
  return { from: start, to: end };
}

function stanceOf(value: unknown): DripStance | undefined {
  if (value === 'BULLISH' || value === 'BEARISH' || value === 'NEUTRAL')
    return value;
  return undefined;
}

function safeUrl(value: unknown): string | undefined {
  const url = text(value);
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  return undefined;
}

function clip(value: unknown, max: number): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max - 1).trimEnd()}…`;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed || undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function timeValue(value: string | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

function defined<T extends object>(value: T): T {
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) next[key] = item;
  }
  return next as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
