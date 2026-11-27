import { deploymentCapabilities } from './deployment';
import { DEFAULT_VAULT_PROGRAM_ID } from './constants';
import {
  platformFeeConfig,
  type PlatformFeeConfig,
} from './platform-fee-config';

export type SolanaNetwork = 'mainnet' | 'devnet';

/**
 * How market swaps are routed.
 * - jupiter: Jupiter only (default, pre-Titan behaviour)
 * - shadow:  quote Jupiter + Titan, log the comparison, always execute Jupiter
 * - best:    execute the better quote net of estimated network fees; Jupiter
 *            on any Titan problem
 */
export type SwapRouterMode = 'jupiter' | 'shadow' | 'best';

const SWAP_ROUTER_MODES: readonly SwapRouterMode[] = [
  'jupiter',
  'shadow',
  'best',
];

const DEFAULT_TITAN_API_URL = 'https://portal.api.titan.exchange';
export const DEFAULT_TITAN_MAX_PRICE_DEVIATION_BPS = 100;

/** Keyless api.jup.ag is limited to 0.5 rps; a free key gets 1 rps. */
const JUPITER_KEYLESS_RPS = 0.5;
const JUPITER_KEYED_RPS = 1;
/** Change only after the route-level Privy proof and signing path are reviewed. */
// Runtime owner allowlists and independent gate flags still default to off.
const DELEGATED_SIGNING_READY = true;

const DEFAULT_JUPITER_API_URL = 'https://api.jup.ag/swap/v1';
const DEFAULT_DRIP_API_BASE_URL = 'https://dripstack.com';
const DEFAULT_DRIP_REQUEST_TIMEOUT_MS = 12_000;

export interface AppEnv {
  DEPLOYMENT_ENV?: 'production' | 'development' | 'preview';
  PREVIEW_PR_NUMBER?: number | null;
  COMMIT_SHA?: string | null;
  PORT: number;
  CORS_ORIGIN: string;
  POSTGRES_URL: string;
  TOKENS_API_BASE_URL: string;
  TOKENS_API_KEY: string;
  ALCHEMY_API_KEY: string;
  SOLANA_NETWORK: SolanaNetwork;
  PRIVY_APP_ID?: string;
  PRIVY_APP_SECRET?: string;
  /** Native sponsorship is opt-in and applies only to eligible reviewed trades. */
  PRIVY_REVIEWED_GAS_SPONSORSHIP?: boolean;
  PRIVY_MCP_GAS_SPONSORSHIP?: boolean;
  /** Public funded system account used ONLY for unsigned fee-free simulations. */
  PRIVY_GAS_SIMULATION_PAYER?: string;
  PLATFORM_FEE_BPS?: number;
  PLATFORM_FEE_CONFIG?: PlatformFeeConfig;
  PLATFORM_FEE_USDC_ACCOUNT?: string;
  PLATFORM_FEE_OWNER?: string;
  PLATFORM_FEE_CONFIG_INVALID?: boolean;
  TITAN_PLATFORM_FEE_ENABLED?: boolean;
  MCP_DELEGATED_TRADES_ENABLED: boolean;
  MCP_DELEGATED_BUYS_ENABLED: boolean;
  MCP_DELEGATED_SELLS_ENABLED: boolean;
  MCP_DELEGATED_TRADES_ALLOWED_USERS: string[];
  /** Lets every signed-in user enroll; grant terms and dollar limits still apply. */
  MCP_DELEGATED_TRADES_PUBLIC: boolean;
  MCP_DELEGATED_MAX_PER_TRADE_USD: number;
  MCP_DELEGATED_MAX_DAILY_USD: number;
  PRIVY_MCP_SIGNER_QUORUM_ID?: string;
  PRIVY_MCP_SIGNER_POLICY_ID?: string;
  PRIVY_MCP_SIGNER_PRIVATE_KEY?: string;
  SIGNER_GATE_URL?: string;
  SIGNER_GATE_API_TOKEN?: string;
  PRIVY_POLICY_ADMIN_QUORUM_ID?: string;
  ALCHEMY_SOLANA_WS_URL?: string;
  JUPITER_API_URL?: string;
  JUPITER_TRIGGER_API_URL?: string;
  JUPITER_TRACKING_ACCOUNT?: string;
  /** Optional Jupiter Developer Platform key, sent as `x-api-key`. */
  JUPITER_API_KEY?: string;
  /** Client-side Jupiter request budget (shared by quote, swap and trigger). */
  JUPITER_MAX_RPS: number;
  /** Server-only Titan Portal key. Unset = Titan disabled (kill switch). */
  TITAN_API_KEY?: string;
  TITAN_API_URL: string;
  /** Client-side Titan request budget. Titan is skipped (not queued) when spent. */
  TITAN_MAX_RPS: number;
  /**
   * Extra program ids allowed in Titan-built transactions, on top of the
   * built-in allowlist (comma-separated base58).
   */
  TITAN_EXTRA_PROGRAM_IDS: string[];
  /**
   * Titan rejects routes that deviate more than this from its reference
   * price (Titan's own default is 1000 = 10%). Oren default: 100 (1%).
   */
  TITAN_MAX_PRICE_DEVIATION_BPS: number;
  SWAP_ROUTER_MODE: SwapRouterMode;
  DUNE_API_KEY?: string;
  DUNE_API_BASE_URL: string;
  DUNE_UPLOAD_NAMESPACE?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL: string;
  ANTHROPIC_API_KEY?: string;
  BITGET_API_BASE_URL: string;
  BITGET_REQUEST_TIMEOUT_MS: number;
  /** Server-side Drip integration switch. */
  DRIP_ENABLED: boolean;
  /** Signed-in app access; keep separate from the provider integration switch. */
  DRIP_PUBLIC_RESEARCH_ENABLED: boolean;
  /** Server-only. Sent as `Authorization: Bearer`. Never returned to clients. */
  DRIP_API_KEY?: string;
  DRIP_API_BASE_URL: string;
  DRIP_REQUEST_TIMEOUT_MS: number;
  SENVIOK_API_KEY?: string;
  SENVIOK_FROM?: string;
  /**
   * When "true", every opted-in user with a verified email receives the
   * Morning Brief. NOTIFICATION_PILOT_USERS is not consulted. Unset or any
   * other value leaves briefs off.
   */
  MORNING_BRIEF_ENABLED?: string;
  PRICE_ALERTS_ENABLED?: string;
  /**
   * When "true", price alerts are available to every signed-in user with a
   * verified email. Unset or any other value keeps the pilot allowlist.
   * Defaults to off. Does not affect Morning Brief.
   */
  PRICE_ALERTS_PUBLIC?: string;
  TOKENS_ALERT_TIMESTAMPS_VERIFIED?: string;
  /** Comma-separated mints, or "*" for every tradable catalog variant. */
  NOTIFICATION_ALERT_MINTS?: string;
  /** Seconds a last trade may age before a quote is ignored. Default 120. */
  NOTIFICATION_QUOTE_MAX_TRADE_AGE_SECONDS?: string;
  NOTIFICATION_REDIS_URL?: string;
  NOTIFICATION_APP_ORIGIN?: string;
  NOTIFICATION_API_ORIGIN?: string;
  NOTIFICATION_UNSUBSCRIBE_SECRET?: string;
  NOTIFICATION_TOKENS_PER_MINUTE?: string;
  NOTIFICATION_EMAIL_PER_MINUTE?: string;
  NOTIFICATION_PILOT_USERS?: string;
  NOTIFICATION_FIXTURE_MODE?: string;
  NOTIFICATION_FIXTURE_RECIPIENT?: string;
  VAULT_PROGRAM_ID: string;
  /** When false, vault prepare/confirm routes return 503. Defaults to false until the program is deployed. */
  VAULT_PROGRAM_LIVE: boolean;
  /**
   * Operator mailbox for the SEC EDGAR User-Agent. Unset or invalid disables
   * company-facts fetches. Do not invent an address.
   */
  SEC_CONTACT_EMAIL?: string;
  /**
   * Server-only keys for published values on the official US macro calendar.
   * Release dates need none. BLS works without a key at a lower daily limit;
   * without BEA_API_KEY or CENSUS_API_KEY, GDP, PCE, and retail sales show
   * dates without values.
   */
  BLS_API_KEY?: string;
  BEA_API_KEY?: string;
  CENSUS_API_KEY?: string;
  GROWTH_COLLECT_ENABLED: boolean;
  GROWTH_RAW_RETENTION_DAYS: number;
  GROWTH_IDEMPOTENCY_RETENTION_DAYS: number;
  GROWTH_SESSION_IDLE_MINUTES: number;
  GROWTH_ATTRIBUTION_WINDOW_DAYS: number;
  GROWTH_ATTRIBUTION_MODEL: 'first' | 'last';
  GROWTH_MIN_COMPARISON_SAMPLE: number;
  GROWTH_ROLLUP_INTERVAL_MS: number;
  GROWTH_HASH_KEY?: string;
  GROWTH_EXCLUDE_HOSTS: string[];
  /** Record each pageview's country from the request address. The address is not stored. */
  GROWTH_GEOIP_ENABLED: boolean;
  /** A local .mmdb or .mmdb.gz country database. When unset, the API downloads DB-IP Lite monthly. */
  GROWTH_GEOIP_DB_PATH?: string;
  /** How many reverse-proxy hops may set X-Forwarded-For. Never stored. */
  TRUST_PROXY_HOPS: number;
}

const REQUIRED = ['POSTGRES_URL', 'TOKENS_API_KEY', 'ALCHEMY_API_KEY'] as const;

type EnvSource = NodeJS.ProcessEnv | Record<string, unknown>;

function readEnv(env: EnvSource, key: string): string | undefined {
  const raw = env[key];
  if (raw == null) return undefined;
  const value =
    typeof raw === 'string'
      ? raw.trim()
      : typeof raw === 'number' || typeof raw === 'boolean'
        ? String(raw)
        : '';
  return value || undefined;
}

function requireEnv(env: EnvSource, key: string): string {
  const value = readEnv(env, key);
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function readBool(env: EnvSource, key: string, fallback: boolean): boolean {
  const raw = readEnv(env, key);
  if (raw == null) return fallback;
  const normalized = raw.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function readPositiveInt(
  env: EnvSource,
  key: string,
  fallback: number,
): number {
  return readBoundedInt(env, key, fallback, 1);
}

function readNonNegativeInt(
  env: EnvSource,
  key: string,
  fallback: number,
): number {
  return readBoundedInt(env, key, fallback, 0);
}

function readBoundedInt(
  env: EnvSource,
  key: string,
  fallback: number,
  minimum: number,
): number {
  const raw = readEnv(env, key);
  const value = Number(raw ?? fallback);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${key} must be an integer >= ${minimum}, got "${raw}"`);
  }
  return value;
}

function readPositiveNumber(
  env: EnvSource,
  key: string,
  fallback: number,
): number {
  const raw = readEnv(env, key);
  const value = raw == null ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} must be a positive number, got "${raw}"`);
  }
  return value;
}

function readSwapRouterMode(env: EnvSource): SwapRouterMode {
  const raw = (readEnv(env, 'SWAP_ROUTER_MODE') ?? 'jupiter').toLowerCase();
  if (!SWAP_ROUTER_MODES.includes(raw as SwapRouterMode)) {
    throw new Error(
      `SWAP_ROUTER_MODE must be one of ${SWAP_ROUTER_MODES.join(', ')}, got "${raw}"`,
    );
  }
  return raw as SwapRouterMode;
}

/** Integer basis points in 1..10000. */
function readBps(env: EnvSource, key: string, fallback: number): number {
  const raw = readEnv(env, key);
  const value = raw == null ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 10_000) {
    throw new Error(`${key} must be an integer from 1 to 10000, got "${raw}"`);
  }
  return value;
}

function readList(env: EnvSource, key: string): string[] {
  return (readEnv(env, key) ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * lite-api.jup.ag is being retired; api.jup.ag serves the same paths.
 * Rewrite a stale explicit override instead of letting swaps break.
 */
export function migrateJupiterUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.replace(/\/$/, '');
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname === 'lite-api.jup.ag') {
      parsed.hostname = 'api.jup.ag';
      const migrated = parsed.toString().replace(/\/$/, '');
      console.warn(
        `[env] ${trimmed} uses the retired lite-api.jup.ag host; using ${migrated} instead. Update the env var.`,
      );
      return migrated;
    }
  } catch {
    // Leave malformed values for the client to surface.
  }
  return trimmed;
}

/**
 * Nest ConfigModule loads `.env` into the object passed to `validate`
 * *before* those values are assigned to `process.env`. Always read from
 * that object (falling back to process.env when called later).
 */
/**
 * Browser origins allowed by the general CORS handler. Outside production an
 * unset value keeps the permissive `*` default for local work. In production
 * `*` is never used: fall back to the app origin (MCP_APP_ORIGIN, then
 * https://DOMAIN, which Caddy already serves) and warn, so a deploy without an
 * explicit CORS_ORIGIN keeps working while still being locked to the app.
 */
export function resolveCorsOrigin(
  env: EnvSource,
  environment: string | undefined,
): string {
  const configured = readEnv(env, 'CORS_ORIGIN');
  if (environment !== 'production') return configured ?? '*';
  if (configured && configured !== '*') return configured;

  const domain = readEnv(env, 'DOMAIN');
  const candidate =
    readEnv(env, 'MCP_APP_ORIGIN') ??
    (domain ? `https://${domain}` : undefined);
  if (!candidate)
    throw new Error(
      'CORS_ORIGIN must name the app origin in production (or set MCP_APP_ORIGIN or DOMAIN)',
    );
  let origin: string;
  try {
    origin = new URL(candidate).origin;
  } catch {
    throw new Error(`Cannot derive a CORS origin from "${candidate}"`);
  }
  if (origin === 'null')
    throw new Error(`Cannot derive a CORS origin from "${candidate}"`);
  console.warn(
    `CORS_ORIGIN is ${configured ? '"*"' : 'unset'} in production; allowing only ${origin}. Set CORS_ORIGIN explicitly.`,
  );
  return origin;
}

export function validateEnv(env: EnvSource = process.env): AppEnv {
  const missing = REQUIRED.filter((key) => !readEnv(env, key));
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  const network = (readEnv(env, 'SOLANA_NETWORK') ?? 'mainnet').toLowerCase();
  if (network !== 'mainnet' && network !== 'devnet') {
    throw new Error(
      `SOLANA_NETWORK must be "mainnet" or "devnet", got "${network}"`,
    );
  }

  const portRaw = readEnv(env, 'PORT');
  const port = Number(portRaw ?? 3000);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${portRaw}`);
  }

  const deployment = deploymentCapabilities(env);
  const platformFee = platformFeeConfig(env);
  const feeBps = readEnv(env, 'PLATFORM_FEE_BPS') ?? '0';
  const platformFeeInvalid =
    !platformFee &&
    (readBool(env, 'PLATFORM_FEE_CONFIG_INVALID', false) ||
      !/^\d+$/.test(feeBps) ||
      Number(feeBps) !== 0);
  const reviewedSponsorship = readBool(
    env,
    'PRIVY_REVIEWED_GAS_SPONSORSHIP',
    false,
  );
  const mcpSponsorship = readBool(env, 'PRIVY_MCP_GAS_SPONSORSHIP', false);
  const simulationPayer = readEnv(env, 'PRIVY_GAS_SIMULATION_PAYER');
  if (reviewedSponsorship || mcpSponsorship) {
    if (deployment.environment === 'preview' || network !== 'mainnet')
      throw new Error(
        'Trade gas sponsorship requires a non-preview mainnet deployment',
      );
    requireEnv(env, 'PRIVY_APP_ID');
    requireEnv(env, 'PRIVY_APP_SECRET');
    if (
      !simulationPayer ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(simulationPayer)
    )
      throw new Error(
        'Trade gas sponsorship requires PRIVY_GAS_SIMULATION_PAYER',
      );
  }
  const delegatedEnabled = readBool(env, 'MCP_DELEGATED_TRADES_ENABLED', false);
  const delegatedUsers = readList(env, 'MCP_DELEGATED_TRADES_ALLOWED_USERS');
  const delegatedPublic =
    delegatedEnabled && readBool(env, 'MCP_DELEGATED_TRADES_PUBLIC', false);
  if (delegatedEnabled) {
    if (deployment.environment === 'preview')
      throw new Error('Delegated trades cannot be enabled in a PR preview');
    if (readEnv(env, 'MCP_OAUTH_ENABLED') !== 'true')
      throw new Error('Delegated trades require MCP OAuth');
    if (delegatedUsers.includes('*'))
      throw new Error(
        'Use MCP_DELEGATED_TRADES_PUBLIC=true instead of a wildcard allowlist',
      );
    if (!delegatedPublic && delegatedUsers.length === 0)
      throw new Error(
        'Delegated trades require an explicit user allowlist or MCP_DELEGATED_TRADES_PUBLIC=true',
      );
    for (const key of [
      'PRIVY_MCP_SIGNER_QUORUM_ID',
      'PRIVY_MCP_SIGNER_PRIVATE_KEY',
      'PRIVY_POLICY_ADMIN_QUORUM_ID',
      'SIGNER_GATE_URL',
      'SIGNER_GATE_API_TOKEN',
    ])
      requireEnv(env, key);
    if (!DELEGATED_SIGNING_READY)
      throw new Error(
        'Delegated signing is blocked pending funded Jupiter proof and rollout',
      );
    if (
      new URL(requireEnv(env, 'POSTGRES_URL')).username !== 'oren_api_runtime'
    )
      throw new Error(
        'Delegated trades require the restricted API database role',
      );
  }
  return {
    DEPLOYMENT_ENV: deployment.environment,
    PREVIEW_PR_NUMBER: deployment.prNumber,
    COMMIT_SHA: deployment.commitSha,
    PORT: port,
    CORS_ORIGIN: resolveCorsOrigin(env, deployment.environment),
    POSTGRES_URL: requireEnv(env, 'POSTGRES_URL'),
    TOKENS_API_BASE_URL: (
      readEnv(env, 'TOKENS_API_BASE_URL') ?? 'https://api.tokens.xyz'
    ).replace(/\/$/, ''),
    TOKENS_API_KEY: requireEnv(env, 'TOKENS_API_KEY'),
    ALCHEMY_API_KEY: requireEnv(env, 'ALCHEMY_API_KEY'),
    SOLANA_NETWORK: network,
    PRIVY_APP_ID: readEnv(env, 'PRIVY_APP_ID'),
    PRIVY_APP_SECRET: readEnv(env, 'PRIVY_APP_SECRET'),
    PRIVY_REVIEWED_GAS_SPONSORSHIP: reviewedSponsorship,
    PRIVY_MCP_GAS_SPONSORSHIP: mcpSponsorship,
    PRIVY_GAS_SIMULATION_PAYER: simulationPayer,
    PLATFORM_FEE_BPS: platformFee?.bps ?? 0,
    PLATFORM_FEE_CONFIG: platformFee,
    PLATFORM_FEE_USDC_ACCOUNT: readEnv(env, 'PLATFORM_FEE_USDC_ACCOUNT'),
    PLATFORM_FEE_OWNER: readEnv(env, 'PLATFORM_FEE_OWNER'),
    PLATFORM_FEE_CONFIG_INVALID: platformFeeInvalid,
    TITAN_PLATFORM_FEE_ENABLED: readBool(
      env,
      'TITAN_PLATFORM_FEE_ENABLED',
      false,
    ),
    MCP_DELEGATED_TRADES_ENABLED: delegatedEnabled,
    MCP_DELEGATED_BUYS_ENABLED:
      delegatedEnabled && readBool(env, 'MCP_DELEGATED_BUYS_ENABLED', false),
    MCP_DELEGATED_SELLS_ENABLED:
      delegatedEnabled && readBool(env, 'MCP_DELEGATED_SELLS_ENABLED', false),
    MCP_DELEGATED_TRADES_ALLOWED_USERS: delegatedUsers,
    MCP_DELEGATED_TRADES_PUBLIC: delegatedPublic,
    MCP_DELEGATED_MAX_PER_TRADE_USD: readPositiveNumber(
      env,
      'MCP_DELEGATED_MAX_PER_TRADE_USD',
      25,
    ),
    MCP_DELEGATED_MAX_DAILY_USD: readPositiveNumber(
      env,
      'MCP_DELEGATED_MAX_DAILY_USD',
      50,
    ),
    PRIVY_MCP_SIGNER_QUORUM_ID: readEnv(env, 'PRIVY_MCP_SIGNER_QUORUM_ID'),
    PRIVY_MCP_SIGNER_POLICY_ID: readEnv(env, 'PRIVY_MCP_SIGNER_POLICY_ID'),
    PRIVY_MCP_SIGNER_PRIVATE_KEY: readEnv(env, 'PRIVY_MCP_SIGNER_PRIVATE_KEY'),
    SIGNER_GATE_URL: readEnv(env, 'SIGNER_GATE_URL'),
    SIGNER_GATE_API_TOKEN: readEnv(env, 'SIGNER_GATE_API_TOKEN'),
    PRIVY_POLICY_ADMIN_QUORUM_ID: readEnv(env, 'PRIVY_POLICY_ADMIN_QUORUM_ID'),
    ALCHEMY_SOLANA_WS_URL: readEnv(env, 'ALCHEMY_SOLANA_WS_URL'),
    JUPITER_API_URL:
      migrateJupiterUrl(readEnv(env, 'JUPITER_API_URL')) ??
      DEFAULT_JUPITER_API_URL,
    JUPITER_TRIGGER_API_URL: migrateJupiterUrl(
      readEnv(env, 'JUPITER_TRIGGER_API_URL'),
    ),
    JUPITER_TRACKING_ACCOUNT: readEnv(env, 'JUPITER_TRACKING_ACCOUNT'),
    JUPITER_API_KEY: readEnv(env, 'JUPITER_API_KEY'),
    JUPITER_MAX_RPS: readPositiveNumber(
      env,
      'JUPITER_MAX_RPS',
      readEnv(env, 'JUPITER_API_KEY') ? JUPITER_KEYED_RPS : JUPITER_KEYLESS_RPS,
    ),
    TITAN_API_KEY: readEnv(env, 'TITAN_API_KEY'),
    TITAN_API_URL: (
      readEnv(env, 'TITAN_API_URL') ?? DEFAULT_TITAN_API_URL
    ).replace(/\/$/, ''),
    TITAN_MAX_RPS: readPositiveNumber(env, 'TITAN_MAX_RPS', 1),
    TITAN_EXTRA_PROGRAM_IDS: readList(env, 'TITAN_EXTRA_PROGRAM_IDS'),
    TITAN_MAX_PRICE_DEVIATION_BPS: readBps(
      env,
      'TITAN_MAX_PRICE_DEVIATION_BPS',
      DEFAULT_TITAN_MAX_PRICE_DEVIATION_BPS,
    ),
    SWAP_ROUTER_MODE: readSwapRouterMode(env),
    DUNE_API_KEY: readEnv(env, 'DUNE_API_KEY'),
    DUNE_API_BASE_URL: (
      readEnv(env, 'DUNE_API_BASE_URL') ?? 'https://api.dune.com/api/v1'
    ).replace(/\/$/, ''),
    DUNE_UPLOAD_NAMESPACE: readEnv(env, 'DUNE_UPLOAD_NAMESPACE'),
    OPENAI_API_KEY: readEnv(env, 'OPENAI_API_KEY'),
    OPENAI_MODEL: readEnv(env, 'OPENAI_MODEL') || 'gpt-5-mini',
    ANTHROPIC_API_KEY: readEnv(env, 'ANTHROPIC_API_KEY'),
    BITGET_API_BASE_URL: (
      readEnv(env, 'BITGET_API_BASE_URL') ?? 'https://api.bitget.com'
    ).replace(/\/$/, ''),
    BITGET_REQUEST_TIMEOUT_MS: readPositiveInt(
      env,
      'BITGET_REQUEST_TIMEOUT_MS',
      8000,
    ),
    DRIP_ENABLED: readBool(env, 'DRIP_ENABLED', false),
    DRIP_PUBLIC_RESEARCH_ENABLED: readBool(
      env,
      'DRIP_PUBLIC_RESEARCH_ENABLED',
      false,
    ),
    DRIP_API_KEY: readEnv(env, 'DRIP_API_KEY'),
    DRIP_API_BASE_URL: (
      readEnv(env, 'DRIP_API_BASE_URL') ?? DEFAULT_DRIP_API_BASE_URL
    ).replace(/\/$/, ''),
    DRIP_REQUEST_TIMEOUT_MS: readPositiveInt(
      env,
      'DRIP_REQUEST_TIMEOUT_MS',
      DEFAULT_DRIP_REQUEST_TIMEOUT_MS,
    ),
    SENVIOK_API_KEY: readEnv(env, 'SENVIOK_API_KEY'),
    SENVIOK_FROM: readEnv(env, 'SENVIOK_FROM'),
    MORNING_BRIEF_ENABLED: readEnv(env, 'MORNING_BRIEF_ENABLED'),
    PRICE_ALERTS_ENABLED: readEnv(env, 'PRICE_ALERTS_ENABLED'),
    PRICE_ALERTS_PUBLIC: readEnv(env, 'PRICE_ALERTS_PUBLIC'),
    TOKENS_ALERT_TIMESTAMPS_VERIFIED: readEnv(
      env,
      'TOKENS_ALERT_TIMESTAMPS_VERIFIED',
    ),
    NOTIFICATION_ALERT_MINTS: readEnv(env, 'NOTIFICATION_ALERT_MINTS'),
    NOTIFICATION_QUOTE_MAX_TRADE_AGE_SECONDS: readEnv(
      env,
      'NOTIFICATION_QUOTE_MAX_TRADE_AGE_SECONDS',
    ),
    NOTIFICATION_REDIS_URL: readEnv(env, 'NOTIFICATION_REDIS_URL'),
    NOTIFICATION_APP_ORIGIN: readEnv(env, 'NOTIFICATION_APP_ORIGIN'),
    NOTIFICATION_API_ORIGIN: readEnv(env, 'NOTIFICATION_API_ORIGIN'),
    NOTIFICATION_UNSUBSCRIBE_SECRET: readEnv(
      env,
      'NOTIFICATION_UNSUBSCRIBE_SECRET',
    ),
    NOTIFICATION_TOKENS_PER_MINUTE: readEnv(
      env,
      'NOTIFICATION_TOKENS_PER_MINUTE',
    ),
    NOTIFICATION_EMAIL_PER_MINUTE: readEnv(
      env,
      'NOTIFICATION_EMAIL_PER_MINUTE',
    ),
    NOTIFICATION_PILOT_USERS: readEnv(env, 'NOTIFICATION_PILOT_USERS'),
    NOTIFICATION_FIXTURE_MODE: readEnv(env, 'NOTIFICATION_FIXTURE_MODE'),
    NOTIFICATION_FIXTURE_RECIPIENT: readEnv(
      env,
      'NOTIFICATION_FIXTURE_RECIPIENT',
    ),
    VAULT_PROGRAM_ID:
      readEnv(env, 'VAULT_PROGRAM_ID') || DEFAULT_VAULT_PROGRAM_ID,
    VAULT_PROGRAM_LIVE: readBool(env, 'VAULT_PROGRAM_LIVE', false),
    SEC_CONTACT_EMAIL: secContactEmail(readEnv(env, 'SEC_CONTACT_EMAIL')),
    BLS_API_KEY: readEnv(env, 'BLS_API_KEY'),
    BEA_API_KEY: readEnv(env, 'BEA_API_KEY'),
    CENSUS_API_KEY: readEnv(env, 'CENSUS_API_KEY'),
    ...growthEnv(env),
  };
}

function growthEnv(env: EnvSource) {
  const model = (
    readEnv(env, 'GROWTH_ATTRIBUTION_MODEL') ?? 'first'
  ).toLowerCase();
  if (model !== 'first' && model !== 'last') {
    throw new Error('GROWTH_ATTRIBUTION_MODEL must be first or last');
  }
  const attributionModel: 'first' | 'last' =
    model === 'last' ? 'last' : 'first';
  const hosts = readList(env, 'GROWTH_EXCLUDE_HOSTS');
  return {
    GROWTH_COLLECT_ENABLED: readBool(env, 'GROWTH_COLLECT_ENABLED', true),
    GROWTH_RAW_RETENTION_DAYS: readPositiveInt(
      env,
      'GROWTH_RAW_RETENTION_DAYS',
      30,
    ),
    GROWTH_IDEMPOTENCY_RETENTION_DAYS: readPositiveInt(
      env,
      'GROWTH_IDEMPOTENCY_RETENTION_DAYS',
      90,
    ),
    GROWTH_SESSION_IDLE_MINUTES: readPositiveInt(
      env,
      'GROWTH_SESSION_IDLE_MINUTES',
      30,
    ),
    GROWTH_ATTRIBUTION_WINDOW_DAYS: readPositiveInt(
      env,
      'GROWTH_ATTRIBUTION_WINDOW_DAYS',
      7,
    ),
    GROWTH_ATTRIBUTION_MODEL: attributionModel,
    GROWTH_MIN_COMPARISON_SAMPLE: readPositiveInt(
      env,
      'GROWTH_MIN_COMPARISON_SAMPLE',
      30,
    ),
    GROWTH_ROLLUP_INTERVAL_MS: readPositiveInt(
      env,
      'GROWTH_ROLLUP_INTERVAL_MS',
      900_000,
    ),
    GROWTH_HASH_KEY: readEnv(env, 'GROWTH_HASH_KEY'),
    GROWTH_EXCLUDE_HOSTS: hosts.length > 0 ? hosts : ['localhost', '127.0.0.1'],
    GROWTH_GEOIP_ENABLED: readBool(env, 'GROWTH_GEOIP_ENABLED', true),
    GROWTH_GEOIP_DB_PATH: readEnv(env, 'GROWTH_GEOIP_DB_PATH'),
    TRUST_PROXY_HOPS: readNonNegativeInt(env, 'TRUST_PROXY_HOPS', 1),
  };
}

function secContactEmail(value: string | undefined): string | undefined {
  if (!value || value.length > 254) return undefined;
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)
    ? value
    : undefined;
}
