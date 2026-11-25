import { digest, externalReferrer } from './growth-privacy';
import { exclusionReason } from './growth-bots';
import { cleanUtm } from './growth-attribution';
import type { CountryLookup } from './growth-geo';
import { zonedDay, type ReportTimezone } from './growth-time';

export interface PageviewDraft {
  occurredAt: Date;
  path: string;
  visitorHash: string;
  sessionHash: string;
  visitorStability: 'durable' | 'day';
  source: 'beacon' | 'caddy';
  ingestKey: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  /** Another site that linked here, without "www.". Null for none or the same site. */
  referrerHost: string | null;
  /** ISO 3166-1 alpha-2 from the request address. The address is not kept. */
  country: string | null;
  excluded: boolean;
  excludeReason: string | null;
}

export interface CollectBody {
  eventId?: string;
  event?: string;
  occurredAt?: string;
  path?: string;
  visitorId?: string;
  sessionId?: string;
  host?: string;
  referrer?: string;
  userAgent?: string;
  slot?: string;
  action?: string;
  utm?: Record<string, string | undefined>;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERSONAL_KEYS = [
  'email',
  'ip',
  'wallet',
  'userId',
  'user_id',
  'prompt',
  'payload',
];

export type CollectDecision =
  | { status: 'rejected'; reason: string }
  | { status: 'excluded'; reason: string }
  | { status: 'pageview'; draft: PageviewDraft }
  | {
      status: 'setup_cta';
      sourceId: string;
      occurredAt: Date;
      slot: string | null;
      action: string;
      sessionHash: string;
      visitorHash: string;
      utm: CollectBody['utm'];
    };

export function decideCollect(
  body: Record<string, unknown>,
  now: Date,
  pepper: string,
  excludeHosts: string[],
): CollectDecision {
  if (JSON.stringify(body).length > 4096) {
    return { status: 'rejected', reason: 'too_large' };
  }
  for (const key of PERSONAL_KEYS) {
    if (key in body) return { status: 'rejected', reason: 'personal_field' };
  }
  const event = body.event;
  const eventId = body.eventId;
  const path = body.path;
  const visitorId = body.visitorId;
  const sessionId = body.sessionId;
  if (event !== 'pageview' && event !== 'setup_cta') {
    return { status: 'rejected', reason: 'event' };
  }
  if (typeof eventId !== 'string' || !UUID.test(eventId)) {
    return { status: 'rejected', reason: 'event_id' };
  }
  if (
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path.length > 200 ||
    path.includes('?')
  ) {
    return { status: 'rejected', reason: 'path' };
  }
  if (typeof visitorId !== 'string' || !UUID.test(visitorId)) {
    return { status: 'rejected', reason: 'visitor' };
  }
  if (typeof sessionId !== 'string' || !UUID.test(sessionId)) {
    return { status: 'rejected', reason: 'session' };
  }
  const occurredAt = new Date(
    typeof body.occurredAt === 'string' ? body.occurredAt : '',
  );
  if (Number.isNaN(occurredAt.getTime()))
    return { status: 'rejected', reason: 'time' };
  const skew = occurredAt.getTime() - now.getTime();
  if (
    skew > 5 * 60 * 1000 ||
    now.getTime() - occurredAt.getTime() > 48 * 60 * 60 * 1000
  ) {
    return { status: 'rejected', reason: 'time_window' };
  }
  const userAgent =
    typeof body.userAgent === 'string' ? body.userAgent.slice(0, 300) : '';
  const host = typeof body.host === 'string' ? body.host.slice(0, 200) : '';
  const reason = exclusionReason({
    path,
    userAgent,
    host,
    headers: headerBag(body.headers),
    excludeHosts,
  });
  const utm = utmOf(body.utm);
  const visitorHash = digest(pepper, 'beacon', visitorId);
  const sessionHash = digest(pepper, 'session', sessionId);
  if (reason) return { status: 'excluded', reason };
  if (event === 'setup_cta') {
    const action =
      typeof body.action === 'string' && /^[a-z_]{1,40}$/.test(body.action)
        ? body.action
        : 'open_setup';
    const slot =
      typeof body.slot === 'string' && /^[a-z0-9_-]{1,40}$/.test(body.slot)
        ? body.slot
        : null;
    return {
      status: 'setup_cta',
      sourceId: `setup:${sessionHash}:${action}:${slot ?? 'none'}`,
      occurredAt,
      slot,
      action,
      sessionHash,
      visitorHash,
      utm,
    };
  }
  return {
    status: 'pageview',
    draft: {
      occurredAt,
      path,
      visitorHash,
      sessionHash,
      visitorStability: 'durable',
      source: 'beacon',
      ingestKey: `beacon:${eventId}`,
      utmSource: utm?.source,
      utmMedium: utm?.medium,
      utmCampaign: utm?.campaign,
      utmContent: utm?.content,
      utmTerm: utm?.term,
      referrerHost: externalReferrer(
        typeof body.referrer === 'string' ? body.referrer : undefined,
        host,
      ),
      // The collect controller adds the country from the request address.
      country: null,
      excluded: false,
      excludeReason: null,
    },
  };
}

function headerBag(value: unknown): Record<string, string | undefined> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string | undefined> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') out[key] = item;
  }
  return out;
}

function utmOf(value: unknown): CollectBody['utm'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const out: Record<string, string | undefined> = {};
  for (const key of ['source', 'medium', 'campaign', 'content', 'term']) {
    const item = record[key];
    if (typeof item === 'string') out[key] = item;
  }
  return cleanUtm(out) ?? undefined;
}

export interface CaddyEvent {
  ts?: number;
  status?: number;
  request?: {
    method?: string;
    host?: string;
    uri?: string;
    remote_ip?: string;
    client_ip?: string;
    headers?: Record<string, string[]>;
  };
}

/** One real access-log line becomes at most one pageview. It never invents a person. */
export function caddyLineToPageview(
  event: CaddyEvent,
  pepper: string,
  timezone: ReportTimezone,
  countryOf?: CountryLookup,
): PageviewDraft | null {
  const request = event.request ?? {};
  const uri = (request.uri ?? '').split('?')[0];
  if (!uri.startsWith('/')) return null;
  const headers = request.headers ?? {};
  const ua = headers['User-Agent']?.[0] ?? '';
  const ip = request.client_ip || request.remote_ip || '';
  const reason = exclusionReason({
    method: request.method,
    path: uri,
    status: event.status,
    userAgent: ua,
    headers: {
      RSC: headers.RSC?.[0],
      'Next-Router-Prefetch': headers['Next-Router-Prefetch']?.[0],
      Purpose: headers.Purpose?.[0],
    },
  });
  if (!event.ts || reason) return null;
  const occurredAt = new Date(event.ts * 1000);
  if (Number.isNaN(occurredAt.getTime())) return null;
  const day = zonedDay(occurredAt, timezone);
  const ipHash = digest(pepper, 'caddy-ip', ip);
  const uaHash = digest(pepper, 'caddy-ua', ua);
  return {
    occurredAt,
    path: uri.slice(0, 200),
    visitorHash: digest(pepper, 'caddy-day', day, ipHash, uaHash),
    sessionHash: digest(pepper, 'caddy-session', day, ipHash, uaHash),
    visitorStability: 'day',
    source: 'caddy',
    ingestKey: `caddy:${digest(pepper, 'caddy-line', String(event.ts), request.method ?? '', uri, String(event.status ?? ''), ipHash, uaHash)}`,
    referrerHost: externalReferrer(headers.Referer?.[0], request.host),
    country: countryOf?.(ip) ?? null,
    excluded: false,
    excludeReason: null,
  };
}
