import { eachDay, weekStart } from './growth-time';

export interface CountValue {
  status: 'exact' | 'partial' | 'unavailable';
  value: number | null;
  reason?: string;
}

export interface FunnelFact {
  occurredAt: string;
  eventType:
    | 'setup_cta'
    | 'oauth_completed'
    | 'oauth_refused'
    | 'oauth_failed'
    | 'oauth_expired'
    | 'oauth_revoked'
    | 'research_success'
    | 'mcp_stock_context';
  accountHash?: string | null;
  sessionHash?: string | null;
  lane?: string | null;
  toolName?: string | null;
  campaign?: string | null;
  content?: string | null;
  term?: string | null;
  slot?: string | null;
  isFirst?: boolean;
}

export interface ConnectionFact {
  grantId: string;
  accountHash: string;
  createdAt: string;
  revokedAt?: string | null;
  campaign?: string | null;
  content?: string | null;
  term?: string | null;
  slot?: string | null;
}

const RESEARCH_TOOL = 'getStockResearch';

export function buildFunnel(input: {
  facts: FunnelFact[];
  connections: ConnectionFact[];
  from: string;
  to: string;
  groupBy?: 'none' | 'week' | 'campaign';
}) {
  const days = eachDay(input.from, input.to);
  const groups = new Map<string, ReturnType<typeof emptyFunnel>>();
  const keyFor = (fact: { campaign?: string | null; occurredAt: string }) => {
    if (input.groupBy === 'campaign') return fact.campaign || '(none)';
    if (input.groupBy === 'week')
      return weekStart(fact.occurredAt.slice(0, 10));
    return `${input.from}:${input.to}`;
  };
  for (const fact of input.facts) {
    const bucket = groups.get(keyFor(fact)) ?? emptyFunnel();
    addFact(bucket, fact);
    groups.set(keyFor(fact), bucket);
  }
  for (const connection of input.connections) {
    const bucket =
      groups.get(keyFor({ ...connection, occurredAt: connection.createdAt })) ??
      emptyFunnel();
    bucket.connections.add(connection.grantId);
    bucket.connectedAccounts.add(connection.accountHash);
    if (!connection.revokedAt) bucket.activeConnections.add(connection.grantId);
    else bucket.revokedGrants.add(connection.grantId);
    groups.set(
      keyFor({ ...connection, occurredAt: connection.createdAt }),
      bucket,
    );
  }
  const slices = [...groups.entries()].map(([key, bucket]) =>
    publish(key, bucket),
  );
  return {
    from: input.from,
    to: input.to,
    days: days.length,
    definitions: FUNNEL_DEFINITIONS,
    slices,
    people: { status: 'unavailable' as const, reason: 'no_person_identifier' },
    summingDailyUniquesIsLifetime: false,
  };
}

function emptyFunnel() {
  return {
    setupSessions: new Set<string>(),
    setupEvents: 0,
    connections: new Set<string>(),
    connectedAccounts: new Set<string>(),
    activeConnections: new Set<string>(),
    revokedGrants: new Set<string>(),
    refused: 0,
    failed: 0,
    expired: 0,
    mcpResearchCalls: 0,
    mcpResearchAccounts: new Set<string>(),
    researchCalls: 0,
    researchAccounts: new Set<string>(),
    repeatResearchAccounts: new Set<string>(),
    researchByAccount: new Map<string, number>(),
    stockContextCalls: 0,
    stockContextAccounts: new Set<string>(),
    stockContextByAccount: new Map<string, number>(),
  };
}

function addFact(
  bucket: ReturnType<typeof emptyFunnel>,
  fact: FunnelFact,
): void {
  if (fact.eventType === 'setup_cta') {
    bucket.setupEvents += 1;
    if (fact.sessionHash) bucket.setupSessions.add(fact.sessionHash);
  } else if (fact.eventType === 'oauth_refused') bucket.refused += 1;
  else if (fact.eventType === 'oauth_failed') bucket.failed += 1;
  else if (fact.eventType === 'oauth_expired') bucket.expired += 1;
  else if (
    fact.eventType === 'research_success' &&
    fact.toolName === RESEARCH_TOOL &&
    fact.lane !== 'mcp'
  ) {
    bucket.researchCalls += 1;
    if (fact.accountHash) {
      const count = (bucket.researchByAccount.get(fact.accountHash) ?? 0) + 1;
      bucket.researchByAccount.set(fact.accountHash, count);
      bucket.researchAccounts.add(fact.accountHash);
      if (count > 1) bucket.repeatResearchAccounts.add(fact.accountHash);
    }
  } else if (
    fact.eventType === 'research_success' &&
    fact.toolName === 'get_stock_research' &&
    fact.lane === 'mcp'
  ) {
    bucket.mcpResearchCalls += 1;
    if (fact.accountHash) bucket.mcpResearchAccounts.add(fact.accountHash);
  } else if (
    fact.eventType === 'mcp_stock_context' &&
    fact.toolName === 'get_stock'
  ) {
    bucket.stockContextCalls += 1;
    if (fact.accountHash) {
      const count =
        (bucket.stockContextByAccount.get(fact.accountHash) ?? 0) + 1;
      bucket.stockContextByAccount.set(fact.accountHash, count);
      bucket.stockContextAccounts.add(fact.accountHash);
    }
  }
}

function publish(key: string, bucket: ReturnType<typeof emptyFunnel>) {
  return {
    key,
    setupEvents: bucket.setupEvents,
    setupSessions: bucket.setupSessions.size,
    connections: bucket.connections.size,
    connectedAccounts: bucket.connectedAccounts.size,
    activeConnections: bucket.activeConnections.size,
    revokedGrants: bucket.revokedGrants.size,
    oauthRefused: bucket.refused,
    oauthFailed: bucket.failed,
    oauthExpired: bucket.expired,
    researchCalls: bucket.researchCalls,
    researchAccounts: bucket.researchAccounts.size,
    repeatResearchAccounts: bucket.repeatResearchAccounts.size,
    inAppResearch: {
      channel: 'in_app',
      tool: 'getStockResearch',
      calls: bucket.researchCalls,
      accounts: bucket.researchAccounts.size,
    },
    mcpResearchActivation: {
      status: 'exact' as const,
      tool: 'get_stock_research',
      calls: bucket.mcpResearchCalls,
      accounts: bucket.mcpResearchAccounts.size,
    },
    mcpStockContext: {
      tool: 'get_stock',
      calls: bucket.stockContextCalls,
      accounts: bucket.stockContextAccounts.size,
      note: 'Successful canonical stock detail. Not a research report.',
    },
    note: 'Setup sessions, confirmed connections and successful tool calls are measured independently.',
  };
}

export const FUNNEL_DEFINITIONS = {
  pageview:
    'One accepted document navigation after bot, prefetch, asset, and internal filters. Not an asset or API hit.',
  session:
    'A client session id rotated after 30 idle minutes. A session crossing midnight counts in each civil day. Summing daily sessions is not all-time sessions.',
  dailyUniques:
    'Distinct durable visitor ids that day. Summing daily uniques is not lifetime uniques.',
  lifetimeUniques:
    'Distinct durable visitor ids whose keys are still inside identity retention. Unavailable once those keys are purged. Never the sum of daily uniques.',
  setupCta:
    'A person opened setup, chose an agent app, or copied setup instructions. Deduped per session, action, and slot.',
  connection:
    'A server-confirmed OAuth grant row. A click, a refused prompt, a failed prompt, and an expired or revoked grant are not connections.',
  research:
    'Successful research calls are grouped by in-app getStockResearch and MCP get_stock_research. Stock context counts successful get_stock calls.',
  mcpStockContext:
    'A successful MCP get_stock call. It returns canonical stock detail, not a research report.',
  accounts:
    'Distinct Privy accounts, counted by a one-way hash. This is not a count of people.',
  people: 'Unavailable. Oren has accounts, not a person identifier.',
} as const;

export interface CompareRow {
  key: string;
  sampleSize: number;
  connections: number;
  researchAccounts: number;
}

export function compareSlices(rows: CompareRow[], minimum: number) {
  return {
    minimumSample: minimum,
    inference:
      'Rates are descriptive. This does not assign experiments or claim significance.',
    rows: rows.map((row) => ({
      ...row,
      connectionRate:
        row.sampleSize > 0 ? row.connections / row.sampleSize : null,
      researchRate:
        row.sampleSize > 0 ? row.researchAccounts / row.sampleSize : null,
      significance:
        row.sampleSize < minimum
          ? { status: 'unavailable' as const, reason: 'sample_below_minimum' }
          : {
              status: 'unavailable' as const,
              reason: 'significance_not_computed',
            },
    })),
  };
}

export interface RetentionEvent {
  accountHash: string;
  at: string;
  kind: 'research' | 'trade_confirmed';
}

/** Only accounts whose whole follow-up window has elapsed are in the denominator. */
export function retention(input: {
  events: RetentionEvent[];
  cohortFrom: string;
  cohortTo: string;
  windowDays: number;
  asOf: Date;
}): CountValue & { retained?: number; denominator?: number } {
  const start = Date.parse(`${input.cohortFrom}T00:00:00.000Z`);
  const end = Date.parse(`${input.cohortTo}T23:59:59.999Z`);
  const firstResearch = new Map<string, number>();
  const later = new Map<string, number[]>();
  for (const event of input.events) {
    const at = Date.parse(event.at);
    if (
      event.kind === 'research' &&
      at < (firstResearch.get(event.accountHash) ?? Infinity)
    ) {
      firstResearch.set(event.accountHash, at);
    }
    const list = later.get(event.accountHash) ?? [];
    list.push(at);
    later.set(event.accountHash, list);
  }
  let denominator = 0;
  let retained = 0;
  for (const [account, first] of firstResearch) {
    if (first < start || first > end) continue;
    const followUpEnds = first + input.windowDays * 24 * 60 * 60 * 1000;
    if (followUpEnds > input.asOf.getTime()) continue;
    denominator += 1;
    const hits = (later.get(account) ?? []).filter(
      (at) => at > first && at <= followUpEnds,
    );
    if (hits.length > 0) retained += 1;
  }
  if (denominator === 0) {
    return {
      status: 'unavailable',
      value: null,
      reason: 'window_not_elapsed_or_empty_cohort',
      denominator: 0,
    };
  }
  return { status: 'exact', value: retained, retained, denominator };
}

export interface DailyMetric {
  day: string;
  pageviews: number;
  sessions: number;
  dailyUniques: number;
  source: 'beacon' | 'caddy';
}

export function allTimeFromDailyUniques(): CountValue {
  return {
    status: 'unavailable',
    value: null,
    reason: 'summing_daily_uniques_is_not_lifetime_uniques',
  };
}

export function additivePageviews(days: Array<CountValue>): CountValue {
  if (days.length === 0) {
    return { status: 'unavailable', value: null, reason: 'no_observation' };
  }
  if (days.some((day) => day.status !== 'exact' || day.value === null)) {
    return { status: 'unavailable', value: null, reason: 'gap_is_not_zero' };
  }
  return {
    status: 'exact',
    value: days.reduce((sum, day) => sum + (day.value ?? 0), 0),
  };
}

/** Closed days keep their frozen pageviews. The open civil day is partial and is not required for that sum. */
export function closedPageviews<T extends CountValue & { day: string }>(
  days: T[],
  partialDays: ReadonlySet<string>,
): { total: CountValue; daily: Array<T & { status: CountValue['status'] }> } {
  const daily = days.map((day) =>
    partialDays.has(day.day) && day.status === 'exact'
      ? { ...day, status: 'partial' as const, reason: 'civil_day_still_open' }
      : day,
  );
  return {
    daily,
    total: additivePageviews(daily.filter((day) => !partialDays.has(day.day))),
  };
}
