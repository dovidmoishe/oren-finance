import { siteHost } from './growth-privacy';

export interface DailyMetricRow {
  day: string;
  source: string;
  grain: string;
  dimension: string;
  pageviews: number;
  sessions: number;
}

export interface BreakdownRow {
  key: string;
  visits: number;
  pageviews: number;
}

export interface Breakdown {
  /** Visits in `rows` and `otherVisits`. */
  total: number;
  rows: BreakdownRow[];
  /** Visits in keys beyond the row limit. */
  otherVisits: number;
  /** Visits without a key: no recorded country, or no referring site. */
  missing: number;
}

/** One collector per day, as in the traffic report: the beacon when it has the day, else Caddy. */
export function dailySources(metrics: DailyMetricRow[]): Map<string, string> {
  const chosen = new Map<string, string>();
  for (const row of metrics) {
    if (
      row.grain === 'site' &&
      (row.source === 'beacon' || !chosen.has(row.day))
    )
      chosen.set(row.day, row.source);
  }
  return chosen;
}

/**
 * Visits by key across the range. A visit is a daily session, so one that
 * crosses midnight counts on each day, as in the traffic report.
 */
export function breakdown(
  metrics: DailyMetricRow[],
  grain: 'country' | 'referrer',
  options: { limit: number; isMissing: (key: string) => boolean },
): Breakdown {
  const sources = dailySources(metrics);
  const totals = new Map<string, BreakdownRow>();
  let missing = 0;
  for (const row of metrics) {
    if (row.grain !== grain || sources.get(row.day) !== row.source) continue;
    if (options.isMissing(row.dimension)) {
      missing += row.sessions;
      continue;
    }
    const entry = totals.get(row.dimension) ?? {
      key: row.dimension,
      visits: 0,
      pageviews: 0,
    };
    entry.visits += row.sessions;
    entry.pageviews += row.pageviews;
    totals.set(row.dimension, entry);
  }
  const sorted = [...totals.values()].sort(
    (a, b) =>
      b.visits - a.visits ||
      b.pageviews - a.pageviews ||
      a.key.localeCompare(b.key),
  );
  const rows = sorted.slice(0, options.limit);
  const total = sorted.reduce((sum, row) => sum + row.visits, 0);
  return {
    total,
    rows,
    otherVisits: total - rows.reduce((sum, row) => sum + row.visits, 0),
    missing,
  };
}

/** Hosts of the app's own origins, so links within the site count as direct visits. */
export function originHosts(origins: string): Set<string> {
  const hosts = new Set<string>();
  for (const origin of origins.split(',')) {
    try {
      const host = new URL(origin.trim()).host;
      if (host) hosts.add(siteHost(host));
    } catch {
      // "*" and other non-URL values name no host.
    }
  }
  return hosts;
}
