import { DEFAULT_VAULT_PROGRAM_ID } from './constants';

export type SolanaNetwork = 'mainnet' | 'devnet';

export interface AppEnv {
  PORT: number;
  CORS_ORIGIN: string;
  POSTGRES_URL: string;
  TOKENS_API_BASE_URL: string;
  TOKENS_API_KEY: string;
  ALCHEMY_API_KEY: string;
  SOLANA_NETWORK: SolanaNetwork;
  JUPITER_API_URL?: string;
  JUPITER_TRIGGER_API_URL?: string;
  JUPITER_TRACKING_ACCOUNT?: string;
  DUNE_API_KEY?: string;
  DUNE_API_BASE_URL: string;
  DUNE_UPLOAD_NAMESPACE?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL: string;
  ANTHROPIC_API_KEY?: string;
  BITGET_API_BASE_URL: string;
  BITGET_REQUEST_TIMEOUT_MS: number;
  PANTA_ENABLED?: boolean;
  PANTA_API_BASE_URL?: string;
  PANTA_API_KEY?: string;
  PANTA_REQUEST_TIMEOUT_MS?: number;
  VAULT_PROGRAM_ID: string;
  /** When false, vault prepare/confirm routes return 503. Defaults to false until the program is deployed. */
  VAULT_PROGRAM_LIVE: boolean;
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
  const raw = readEnv(env, key);
  const value = Number(raw ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer, got "${raw}"`);
  }
  return value;
}

/**
 * Nest ConfigModule loads `.env` into the object passed to `validate`
 * *before* those values are assigned to `process.env`. Always read from
 * that object (falling back to process.env when called later).
 */
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

  const pantaEnabled = readBool(env, 'PANTA_ENABLED', false);
  const pantaBaseUrl = readEnv(env, 'PANTA_API_BASE_URL')?.replace(/\/+$/, '');
  const pantaKey = readEnv(env, 'PANTA_API_KEY');
  if (pantaEnabled && (!pantaBaseUrl || !pantaKey)) {
    throw new Error(
      'PANTA_API_BASE_URL and PANTA_API_KEY are required when PANTA_ENABLED is true',
    );
  }
  if (pantaBaseUrl) {
    let url: URL;
    try {
      url = new URL(pantaBaseUrl);
    } catch {
      throw new Error('Invalid PANTA_API_BASE_URL');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error('Invalid PANTA_API_BASE_URL');
    }
  }

  return {
    PANTA_ENABLED: pantaEnabled,
    PANTA_API_BASE_URL: pantaBaseUrl,
    PANTA_API_KEY: pantaKey,
    PANTA_REQUEST_TIMEOUT_MS: readPositiveInt(
      env,
      'PANTA_REQUEST_TIMEOUT_MS',
      8000,
    ),
    PORT: port,
    CORS_ORIGIN: readEnv(env, 'CORS_ORIGIN') ?? '*',
    POSTGRES_URL: requireEnv(env, 'POSTGRES_URL'),
    TOKENS_API_BASE_URL: (
      readEnv(env, 'TOKENS_API_BASE_URL') ?? 'https://api.tokens.xyz'
    ).replace(/\/$/, ''),
    TOKENS_API_KEY: requireEnv(env, 'TOKENS_API_KEY'),
    ALCHEMY_API_KEY: requireEnv(env, 'ALCHEMY_API_KEY'),
    SOLANA_NETWORK: network,
    JUPITER_API_URL:
      readEnv(env, 'JUPITER_API_URL')?.replace(/\/$/, '') ??
      'https://lite-api.jup.ag/swap/v1',
    JUPITER_TRIGGER_API_URL: readEnv(env, 'JUPITER_TRIGGER_API_URL')?.replace(
      /\/$/,
      '',
    ),
    JUPITER_TRACKING_ACCOUNT: readEnv(env, 'JUPITER_TRACKING_ACCOUNT'),
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
    VAULT_PROGRAM_ID:
      readEnv(env, 'VAULT_PROGRAM_ID') || DEFAULT_VAULT_PROGRAM_ID,
    VAULT_PROGRAM_LIVE: readBool(env, 'VAULT_PROGRAM_LIVE', false),
  };
}
