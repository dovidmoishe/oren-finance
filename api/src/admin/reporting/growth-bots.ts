/** Same exclusions as infra/visits.sh, plus test and headless clients. */

const ASSET =
  /\.(?:js|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|txt|xml|json)$/i;
const BOT =
  /bot|crawl|spider|slurp|curl|wget|python|go-http|headless|monitor|uptime|playwright|oren-test/i;

export interface RequestSignals {
  method?: string;
  path: string;
  status?: number;
  userAgent?: string;
  host?: string;
  headers?: Record<string, string | undefined>;
  excludeHosts?: string[];
}

export function exclusionReason(signals: RequestSignals): string | null {
  const path = signals.path.split('?')[0] || '/';
  const headers = lowerHeaders(signals.headers);
  const ua = signals.userAgent ?? '';
  if (signals.method && signals.method.toUpperCase() !== 'GET') {
    return 'method';
  }
  if (signals.status !== undefined && signals.status !== 200) return 'status';
  if (path.startsWith('/_next') || path.startsWith('/api/'))
    return 'internal_path';
  if (ASSET.test(path)) return 'asset';
  if (
    headers['next-router-prefetch'] ||
    headers['next-router-segment-prefetch'] ||
    headers.purpose === 'prefetch' ||
    headers['sec-purpose'] === 'prefetch' ||
    headers.rsc
  ) {
    return 'prefetch';
  }
  if (BOT.test(ua)) return 'bot';
  const host = (signals.host ?? '').toLowerCase().split(':')[0];
  const excluded = signals.excludeHosts ?? ['localhost', '127.0.0.1'];
  if (host && excluded.includes(host)) return 'internal_host';
  return null;
}

function lowerHeaders(
  headers: Record<string, string | undefined> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (value) out[key.toLowerCase()] = value.toLowerCase();
  }
  return out;
}
