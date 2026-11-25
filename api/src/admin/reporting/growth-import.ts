import { eachDay } from './growth-time';
import type { CountValue } from './growth-metrics';
import { createHash } from 'node:crypto';

export const IMPORT_SCHEMA = 'oren.growth.import.v1';

export type ObservationCoverage =
  | 'complete'
  | 'partial'
  | 'unknown'
  | 'excluded'
  | 'unresolved'
  | 'lower_bound'
  | 'superseded'
  | 'as_reported';

export type ObservationGrain = 'day' | 'window' | 'intraday' | 'point';
export type ObservationFamily =
  'traffic' | 'x' | 'revenue' | 'token' | 'database_snapshot';

export interface GrowthObservation {
  snapshotId: string;
  metric: string;
  family: ObservationFamily;
  grain: ObservationGrain;
  periodStart: string | null;
  periodEnd: string | null;
  day: string | null;
  value: number | null;
  coverage: ObservationCoverage;
  usableInTotals: boolean;
  usableAsWindow: boolean;
  dimensions: Record<string, string>;
  notes: string;
}

export interface GrowthImportDocument {
  schema: typeof IMPORT_SCHEMA;
  source: {
    system: string;
    provenance: string;
    verification: 'as_reported' | 'measured' | 'ledger';
  };
  timezone: 'UTC' | 'Africa/Lagos';
  observations: GrowthObservation[];
}

const METRICS = new Set([
  'page_views',
  'daily_ip_ua',
  'window_page_views',
  'window_ip_ua',
  'any_hit_ip_ua',
  'reported_path_views',
  'reported_users',
  'reported_wallets',
  'reported_executions',
  'reported_threads',
  'reported_messages',
  'reported_trades_rows',
  'reported_confirmed_trades',
  'reported_trader_profiles',
  'x_impressions',
  'x_engagements',
  'x_link_clicks',
  'x_profile_visits',
  'x_follower_delta',
  'cost',
  'revenue',
  'contribution_margin',
  'token_holders',
]);

export function validateImport(document: GrowthImportDocument): void {
  if (
    !document ||
    typeof document !== 'object' ||
    !Array.isArray(document.observations)
  ) {
    throw new Error('observations are required');
  }
  if (document.schema !== IMPORT_SCHEMA)
    throw new Error('unsupported import schema');
  if (!document.source.system || !document.source.provenance) {
    throw new Error('source provenance is required');
  }
  if (document.timezone !== 'UTC' && document.timezone !== 'Africa/Lagos') {
    throw new Error('timezone must be UTC or Africa/Lagos');
  }
  const ids = new Set<string>();
  for (const observation of document.observations) {
    if (!METRICS.has(observation.metric))
      throw new Error(`unknown metric ${observation.metric}`);
    const key = `${observation.snapshotId}:${observation.metric}`;
    if (ids.has(key)) throw new Error(`duplicate snapshot ${key}`);
    ids.add(key);
    if (
      observation.family === 'token' &&
      observation.metric !== 'token_holders'
    ) {
      throw new Error(
        'token observations are holder data, not product activation',
      );
    }
    if (observation.coverage === 'unknown' && observation.value !== null) {
      throw new Error('unknown gaps have no value');
    }
    if (observation.usableInTotals) {
      if (
        observation.coverage !== 'complete' ||
        observation.grain !== 'day' ||
        observation.value === null
      ) {
        throw new Error(
          'only complete day observations can enter a daily total',
        );
      }
    }
    if (observation.usableAsWindow) {
      if (
        observation.coverage !== 'complete' ||
        observation.grain !== 'window' ||
        observation.value === null
      ) {
        throw new Error('window readings must be complete window observations');
      }
    }
    if (observation.grain === 'day' && !observation.day)
      throw new Error('day grain needs a day');
    if (observation.value !== null && !Number.isFinite(observation.value)) {
      throw new Error('value must be finite');
    }
    if ('visits' in observation || 'people' in observation) {
      throw new Error('imports cannot carry individual visits or people');
    }
  }
}

export function contentHash(document: GrowthImportDocument): string {
  return createHash('sha256').update(stable(document)).digest('hex');
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export interface DayReading extends CountValue {
  day: string;
  source: 'import' | 'telemetry' | 'caddy' | null;
  withheld: GrowthObservation[];
}

/**
 * Day totals use only complete, non-overlapping day observations.
 * Intraday snapshots, lower bounds, excluded figures, and unresolved
 * definitions are retained and never added.
 */
export function resolveDaily(
  observations: GrowthObservation[],
  metric: string,
  from: string,
  to: string,
): DayReading[] {
  const relevant = observations.filter((item) => item.metric === metric);
  return eachDay(from, to).map((day) => {
    const explicit = relevant.filter((item) => item.day === day);
    const unknown = explicit.find((item) => item.coverage === 'unknown');
    const usable = explicit.filter(
      (item) => item.usableInTotals && item.coverage === 'complete',
    );
    const withheld = explicit.filter((item) => !usable.includes(item));
    if (unknown) {
      return {
        day,
        status: 'unavailable',
        value: null,
        reason: 'reported_unknown',
        source: null,
        withheld,
      };
    }
    const distinct = [...new Set(usable.map((item) => item.value))];
    if (distinct.length > 1) {
      return {
        day,
        status: 'unavailable',
        value: null,
        reason: 'overlapping_snapshots',
        source: null,
        withheld: explicit,
      };
    }
    if (distinct.length === 1) {
      return {
        day,
        status: 'exact',
        value: distinct[0] ?? null,
        source: 'import',
        withheld,
      };
    }
    return {
      day,
      status: 'unavailable',
      value: null,
      reason:
        explicit.length > 0 ? 'no_complete_day_observation' : 'no_observation',
      source: null,
      withheld,
    };
  });
}

export function resolveWindow(
  observations: GrowthObservation[],
  metric: string,
): CountValue & { withheld: GrowthObservation[] } {
  const relevant = observations.filter(
    (item) => item.metric === metric && item.grain === 'window',
  );
  const usable = relevant.filter((item) => item.usableAsWindow);
  const values = [...new Set(usable.map((item) => item.value))];
  if (values.length === 1) {
    return {
      status: 'exact',
      value: values[0] ?? null,
      withheld: relevant.filter((item) => !item.usableAsWindow),
    };
  }
  if (values.length > 1) {
    return {
      status: 'unavailable',
      value: null,
      reason: 'overlapping_windows',
      withheld: relevant,
    };
  }
  return {
    status: 'unavailable',
    value: null,
    reason: relevant.length > 0 ? 'window_not_usable' : 'no_observation',
    withheld: relevant,
  };
}

/** Telemetry and imported snapshots for the same day are not added together. */
export function combineDaily(
  telemetry: Array<{
    day: string;
    value: number;
    source?: 'telemetry' | 'caddy';
  }>,
  imported: DayReading[],
): DayReading[] {
  const byDay = new Map(telemetry.map((item) => [item.day, item]));
  return imported.map((day) => {
    const live = byDay.get(day.day);
    if (live !== undefined && day.status === 'exact' && day.value !== null) {
      return {
        ...day,
        status: 'unavailable',
        value: null,
        reason: 'overlapping_sources',
        source: null,
      };
    }
    if (live) {
      return {
        ...day,
        status: 'exact',
        value: live.value,
        source: live.source ?? 'telemetry',
        reason: undefined,
      };
    }
    return day;
  });
}

interface RecoveryObservation {
  id: string;
  source: string;
  reported_at_utc: string;
  type: string;
  window: string;
  metric: string;
  value: { [key: string]: number | undefined };
  confidence: string;
  caveat?: string;
  definition?: string;
}

interface RecoveryDocument {
  observations: RecoveryObservation[];
  conflicts?: string[];
  routine_runs?: Array<{
    reported_at_wat?: string;
    result: string;
    source?: string;
  }>;
  coverage?: { log_start?: string };
}

const LOG_START_CANDIDATES = [
  '2026-10-29T01:23:00+01:00',
  '2026-10-29T01:25:00+01:00',
  '2026-10-29T01:27:00+01:00',
];

/**
 * Chat-recovery figures stay aggregate observations. This does not create
 * visits, sessions, or people, and it does not choose a baseline total.
 */
export function recoveryToImport(raw: unknown): GrowthImportDocument {
  const parsed = raw as RecoveryDocument;
  if (!parsed || !Array.isArray(parsed.observations)) {
    throw new Error('recovery file has no observations');
  }
  const observations: GrowthObservation[] = [];
  for (const item of parsed.observations) {
    observations.push(...normalizeRecovery(item));
  }
  observations.push(...recoveryGaps(parsed.routine_runs ?? []));
  const document: GrowthImportDocument = {
    schema: IMPORT_SCHEMA,
    source: {
      system: 'chat-recovery',
      provenance:
        'Wren chat recovery finalized 2026-11-07, as reported, not rechecked against logs',
      verification: 'as_reported',
    },
    timezone: 'Africa/Lagos',
    observations,
  };
  validateImport(document);
  return document;
}

export function recoveryCoverage(raw: RecoveryDocument) {
  const text = (raw.conflicts ?? []).join(' ');
  return {
    status: 'unresolved' as const,
    reason: 'log_start_minute_disagrees',
    candidates: LOG_START_CANDIDATES,
    notBefore: LOG_START_CANDIDATES[0],
    nothingBefore: '2026-10-29',
    sourceText: raw.coverage?.log_start ?? null,
    conflictsMentionAllCandidates: ['01:23', '01:25', '01:27'].every((item) =>
      text.includes(item),
    ),
    rawLogs:
      'Caddy keeps at most 10 files of 50 MB and 90 days. A past day may already be gone.',
  };
}

function normalizeRecovery(item: RecoveryObservation): GrowthObservation[] {
  const notes = [item.caveat, item.definition, item.window]
    .filter(Boolean)
    .join(' ');
  if (item.id.startsWith('D')) return databaseSnapshots(item, notes);
  if (item.id === 'H11') {
    return [
      observation(item, 'window_page_views', item.value.page_views, {
        grain: 'window',
        coverage: 'excluded',
        notes: `${notes} Excluded: 36930 views are not comparable with the later 16425 all-logs total.`,
        periodStart: '2026-10-29T01:27:00+01:00',
        periodEnd: '2026-10-31T01:31:00+01:00',
      }),
      observation(item, 'window_ip_ua', item.value.visitors, {
        grain: 'window',
        coverage: 'excluded',
        notes: `${notes} Excluded distinct-window figure. Not comparable and not a person count.`,
        periodStart: '2026-10-29T01:27:00+01:00',
        periodEnd: '2026-10-31T01:31:00+01:00',
      }),
    ];
  }
  if (item.id === 'H16') {
    return [
      observation(item, 'any_hit_ip_ua', item.value.unique_any_hit, {
        grain: 'window',
        coverage: 'as_reported',
        notes: `${notes} Includes asset and API hits. Not people and not page views.`,
        periodStart: '2026-10-29T01:25:00+01:00',
        periodEnd: '2026-11-05T17:50:00+01:00',
      }),
    ];
  }
  if (item.id === 'H14') {
    return [
      observation(item, 'window_page_views', item.value.page_views, {
        grain: 'window',
        coverage: 'complete',
        usableAsWindow: true,
        notes,
        periodStart: '2026-10-29T01:25:00+01:00',
        periodEnd: '2026-11-05T17:25:00+01:00',
      }),
      observation(item, 'window_ip_ua', item.value.visitors, {
        grain: 'window',
        coverage: 'unresolved',
        notes: `${notes} May be a sum of daily uniques rather than period-distinct visitors.`,
        periodStart: '2026-10-29T01:25:00+01:00',
        periodEnd: '2026-11-05T17:25:00+01:00',
      }),
      observation(item, 'page_views', item.value.today_views, {
        snapshotId: `${item.id}-nov5`,
        grain: 'day',
        day: '2026-11-05',
        coverage: 'partial',
        notes: 'Nov 5 through 17:25 WAT only. The rest of the day is unknown.',
        periodStart: '2026-11-05T00:00:00+01:00',
        periodEnd: '2026-11-05T17:25:00+01:00',
      }),
      observation(item, 'daily_ip_ua', item.value.today_visitors, {
        snapshotId: `${item.id}-nov5`,
        grain: 'day',
        day: '2026-11-05',
        coverage: 'partial',
        notes: 'Partial day IP+UA pairs through 17:25 WAT. Not people.',
        periodStart: '2026-11-05T00:00:00+01:00',
        periodEnd: '2026-11-05T17:25:00+01:00',
      }),
      ...pathObservations(item, notes),
    ];
  }
  if (item.id === 'H15') {
    return dayPair(item, '2026-10-29', notes);
  }
  if (item.id === 'H12') {
    return [
      ...dayPair(item, '2026-10-30', notes),
      ...pathObservations(item, notes),
    ];
  }
  if (item.id === 'H13') {
    return [
      observation(item, 'daily_ip_ua', item.value.visitors_min, {
        grain: 'day',
        day: '2026-10-29',
        coverage: 'lower_bound',
        notes: `${notes} Lower bound only. Not a second full-day total.`,
      }),
    ];
  }
  if (item.id === 'H06') {
    return numberEntries(item).map(([metric, value]) =>
      observation(
        item,
        metric === 'visitors' ? 'daily_ip_ua' : 'page_views',
        value,
        {
          grain: 'intraday',
          coverage: 'superseded',
          notes,
          periodStart: '2026-10-29T01:23:00+01:00',
          periodEnd: item.reported_at_utc,
        },
      ),
    );
  }
  if (item.type === 'cumulative_intraday' || item.type === 'correction') {
    return [
      ...numberEntries(item)
        .filter(
          ([key]) =>
            key === 'visitors' ||
            key === 'page_views' ||
            key === 'page_views_approx',
        )
        .map(([key, value]) =>
          observation(
            item,
            key === 'visitors' ? 'daily_ip_ua' : 'page_views',
            value,
            {
              grain: 'intraday',
              coverage: item.type === 'correction' ? 'partial' : 'as_reported',
              notes: `${notes} Running snapshot. Not a day total and not additive with later snapshots.`,
              periodStart: '2026-10-29T01:23:00+01:00',
              periodEnd: item.reported_at_utc,
            },
          ),
        ),
      ...pathObservations(item, notes),
    ];
  }
  return [
    observation(item, 'page_views', null, {
      grain: 'window',
      coverage: 'unknown',
      notes: `Unmapped recovery observation ${item.id}. Left unknown rather than interpreted.`,
    }),
  ];
}

function dayPair(
  item: RecoveryObservation,
  day: string,
  notes: string,
): GrowthObservation[] {
  return [
    observation(item, 'page_views', item.value.page_views, {
      grain: 'day',
      day,
      coverage: 'complete',
      usableInTotals: true,
      notes: `${notes} As reported from visits.sh. Not rechecked against raw logs.`,
      periodStart: `${day}T00:00:00+01:00`,
      periodEnd: nextDay(day),
    }),
    observation(item, 'daily_ip_ua', item.value.visitors, {
      grain: 'day',
      day,
      coverage: 'complete',
      usableInTotals: true,
      notes: `${notes} Unique IP+browser for this WAT day. Not people. Do not sum across days for a lifetime count.`,
      periodStart: `${day}T00:00:00+01:00`,
      periodEnd: nextDay(day),
    }),
  ];
}

function pathObservations(
  item: RecoveryObservation,
  notes: string,
): GrowthObservation[] {
  return Object.entries(item.value)
    .filter(([key]) => key.startsWith('/'))
    .map(([path, value]) =>
      observation(item, 'reported_path_views', value, {
        snapshotId: `${item.id}:${path}`,
        grain: 'window',
        coverage: 'as_reported',
        dimensions: { path },
        notes: `${notes} Top-page counts can cover the whole script window, so they are not a per-day path total.`,
      }),
    );
}

function databaseSnapshots(
  item: RecoveryObservation,
  notes: string,
): GrowthObservation[] {
  const names: Record<string, string> = {
    users: 'reported_users',
    users_wallets: 'reported_wallets',
    executions: 'reported_executions',
    threads: 'reported_threads',
    messages: 'reported_messages',
    trades: 'reported_trades_rows',
    confirmed_trades: 'reported_confirmed_trades',
    trader_profiles: 'reported_trader_profiles',
  };
  return Object.entries(item.value).map(([key, value]) => {
    const metric = names[key];
    if (!metric) throw new Error(`unmapped database field ${key}`);
    return observation(item, metric, value, {
      snapshotId: `${item.id}:${key}`,
      family: 'database_snapshot',
      grain: 'point',
      coverage: 'as_reported',
      notes: `${notes} Lifetime row snapshot. Not a daily delta and not product activation.`,
      periodEnd: item.reported_at_utc,
    });
  });
}

function recoveryGaps(
  runs: Array<{ reported_at_wat?: string; result: string; source?: string }>,
): GrowthObservation[] {
  const days = new Map<string, string>();
  for (const run of runs) {
    const found = new Set<string>();
    if (/oct\s+31/i.test(run.result)) found.add('2026-10-31');
    for (const match of run.result.matchAll(/nov\s+([1-4])\b/gi)) {
      found.add(`2026-11-0${match[1]}`);
    }
    for (const day of found) {
      const note = `${run.result} (${run.reported_at_wat ?? run.source ?? 'recovery'})`;
      days.set(day, days.has(day) ? `${days.get(day)} ${note}` : note);
    }
  }
  return [...days.entries()].flatMap(([day, note]) => [
    gap(day, 'page_views', note),
    gap(day, 'daily_ip_ua', note),
  ]);
}

function gap(day: string, metric: string, notes: string): GrowthObservation {
  return {
    snapshotId: `gap:${day}:${metric}`,
    metric,
    family: 'traffic',
    grain: 'day',
    periodStart: `${day}T00:00:00+01:00`,
    periodEnd: nextDay(day),
    day,
    value: null,
    coverage: 'unknown',
    usableInTotals: false,
    usableAsWindow: false,
    dimensions: {},
    notes,
  };
}

function numberEntries(item: RecoveryObservation): Array<[string, number]> {
  return Object.entries(item.value).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number',
  );
}

function observation(
  item: RecoveryObservation,
  metric: string,
  value: number | null | undefined,
  extra: Partial<GrowthObservation> & { notes: string },
): GrowthObservation {
  return {
    snapshotId: extra.snapshotId ?? item.id,
    metric,
    family: extra.family ?? 'traffic',
    grain: extra.grain ?? 'window',
    periodStart: extra.periodStart ?? null,
    periodEnd: extra.periodEnd ?? null,
    day: extra.day ?? null,
    value: value ?? null,
    coverage: extra.coverage ?? 'as_reported',
    usableInTotals: extra.usableInTotals ?? false,
    usableAsWindow: extra.usableAsWindow ?? false,
    dimensions: extra.dimensions ?? {},
    notes: extra.notes,
  };
}

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return `${date.toISOString().slice(0, 10)}T00:00:00+01:00`;
}

export function pointReadings(
  observations: GrowthObservation[],
  metric: string,
) {
  const rows = observations
    .filter((item) => item.metric === metric && item.grain === 'point')
    .sort((a, b) => (a.periodEnd ?? '').localeCompare(b.periodEnd ?? ''));
  return {
    status:
      rows.length > 0 ? ('as_reported' as const) : ('unavailable' as const),
    latest: rows.at(-1) ?? null,
    readings: rows,
    summed: null,
    reason: 'snapshots_are_not_deltas',
  };
}
