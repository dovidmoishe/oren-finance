export type Permission = "reports.read" | "dashboard.access";
export interface Session {
  id: string;
  email: string;
  isMaster: boolean;
  permissions: Permission[];
  mustChangePassword: boolean;
  csrfToken: string;
  preview?: boolean;
}
export interface Count {
  status: "exact" | "partial" | "unavailable";
  value: number | null;
  reason?: string;
}
export interface Day extends Count {
  day: string;
  source?: string;
}
export interface Traffic {
  timezone: string;
  pageviews: Count;
  daily: Day[];
  distinctDurableVisitorsFirstSeenInRange: Count;
  dailyUniques: { days: { day: string; value: number }[] };
}
export interface BreakdownRow {
  key: string;
  visits: number;
  pageviews: number;
}
export interface Breakdown {
  /** Visits in rows and otherVisits. */
  total: number;
  rows: BreakdownRow[];
  otherVisits: number;
  /** Visits without a key: no recorded country, or no referring site. */
  missing: number;
}
export interface Breakdowns {
  timezone: string;
  unit: "visits";
  note: string;
  countries: Breakdown;
  referrers: Breakdown;
  geolocation: {
    provider: string;
    attributionUrl: string;
    database: string | null;
  };
}
export interface Activity {
  volumeUsd: number;
  trades: number;
  chats: number;
  messages: number;
}
export interface Slice {
  key: string;
  setupEvents: number;
  setupSessions: number;
  connections: number;
  connectedAccounts: number;
  activeConnections: number;
  revokedGrants: number;
  oauthRefused: number;
  oauthFailed: number;
  oauthExpired: number;
  researchCalls: number;
  researchAccounts: number;
  repeatResearchAccounts: number;
  mcpResearchActivation: { calls: number; accounts: number };
  mcpStockContext: { calls: number; accounts: number };
}
export interface Retention extends Count {
  retained?: number;
  denominator?: number;
}
export interface TradeCounts {
  preparations: { browser: number; delegated: number; unlinkedBrowser: number };
  confirmed: { browser: number; delegated: number; unlinkedBrowser: number };
  uniqueActivatedAccounts: number;
}
export interface Funnel {
  slices: Slice[];
  trades: TradeCounts;
  researchRetention7d: Retention;
  researchRetention30d: Retention;
}
export interface Comparison {
  denominator: string;
  minimumSample: number;
  inference: string;
  rows: {
    key: string;
    sampleSize: number;
    connections: number;
    researchAccounts: number;
    connectionRate: number | null;
    researchRate: number | null;
    significance: { status: string; reason: string };
  }[];
}
export interface Coverage {
  rawRetentionDays: number;
  identityRetentionDays: number;
  idempotencyRetentionDays: number;
  attribution: { model: string; windowDays: number };
  collectors: { source: string; startedAt: string }[];
  definitions: Record<string, string>;
}
export interface Account {
  id: string;
  email: string;
  isMaster: boolean;
  status: string;
  mustChangePassword: boolean;
  permissions: Permission[];
}
export interface TemporaryCredential {
  temporaryPassword: string;
  expiresAt: string;
  email?: string;
}
export interface Page<T> {
  rows: T[];
  page: number;
  hasNext: boolean;
  note: string;
}
export interface UserRow {
  userId: string;
  connections: number;
  activeConnections: number;
  firstConnectedAt: string;
  lastConnectedAt: string;
}
export interface ConnectionRow {
  grantId: string;
  clientId: string;
  userId: string;
  wallet: string;
  scopes: string;
  createdAt: string;
  revokedAt: string | null;
}
export interface TradeRow {
  id: string;
  userId: string;
  ticker: string;
  side: string;
  mode: string;
  status: string;
  amountUsd: string | null;
  amountShares: string | null;
  createdAt: string;
  expiresAt: string;
}
export interface AuditRow {
  id: string;
  actorId: string | null;
  action: string;
  targetId: string | null;
  createdAt: string;
}
