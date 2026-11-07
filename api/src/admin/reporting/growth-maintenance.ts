/** Rollup runs inside the API process. It does not wait for a laptop. */

export function planMaintenance(input: {
  today: string;
  lookbackDays: number;
  rawRetentionDays: number;
  daysWithRaw: string[];
  frozenDays: string[];
}): { recompute: string[]; freeze: string[] } {
  const frozen = new Set(input.frozenDays);
  const lookbackStart = shiftDay(input.today, -(input.lookbackDays - 1));
  const retentionStart = shiftDay(input.today, -input.rawRetentionDays);
  const recompute = input.daysWithRaw.filter(
    (day) => day >= lookbackStart && day <= input.today && !frozen.has(day),
  );
  const freeze = input.daysWithRaw.filter(
    (day) => day < retentionStart && !frozen.has(day),
  );
  return { recompute, freeze };
}

function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

export interface RawPageview {
  occurredAt: string;
  path: string;
  visitorHash: string;
  sessionHash: string;
  campaign: string;
  source: 'beacon' | 'caddy';
  stability: 'durable' | 'day';
}

export interface RolledDay {
  day: string;
  timezone: 'UTC' | 'Africa/Lagos';
  grain: 'site' | 'path' | 'campaign';
  dimension: string;
  source: 'beacon' | 'caddy';
  pageviews: number;
  sessions: number;
  dailyUniques: number;
}

/** Daily uniques are exact for that grain and day. They are not an all-time set. */
export function rollPageviews(
  rows: RawPageview[],
  timezone: 'UTC' | 'Africa/Lagos',
  dayOf: (instant: Date) => string,
): RolledDay[] {
  const groups = new Map<string, RawPageview[]>();
  for (const row of rows) {
    const day = dayOf(new Date(row.occurredAt));
    const keys = [
      `${day}|${row.source}|site|`,
      `${day}|${row.source}|path|${row.path}`,
      `${day}|${row.source}|campaign|${row.campaign || '(none)'}`,
    ];
    for (const key of keys) {
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }
  }
  return [...groups.entries()].map(([key, list]) => {
    const [day, source, grain, dimension] = key.split('|');
    return {
      day,
      timezone,
      grain: grain as RolledDay['grain'],
      dimension,
      source: source as RolledDay['source'],
      pageviews: list.length,
      sessions: new Set(list.map((row) => row.sessionHash)).size,
      dailyUniques: new Set(list.map((row) => row.visitorHash)).size,
    };
  });
}
