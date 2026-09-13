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
  OPENAI_API_KEY?: string;
  OPENAI_MODEL: string;
  ANTHROPIC_API_KEY?: string;
  VAULT_PROGRAM_ID: string;
}

const REQUIRED = [
  'POSTGRES_URL',
  'TOKENS_API_KEY',
  'ALCHEMY_API_KEY',
] as const;

function requireEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function validateEnv(): AppEnv {
  const missing = REQUIRED.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  const network = (process.env.SOLANA_NETWORK ?? 'mainnet').toLowerCase();
  if (network !== 'mainnet' && network !== 'devnet') {
    throw new Error(
      `SOLANA_NETWORK must be "mainnet" or "devnet", got "${network}"`,
    );
  }

  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
  }

  return {
    PORT: port,
    CORS_ORIGIN: process.env.CORS_ORIGIN ?? '*',
    POSTGRES_URL: requireEnv('POSTGRES_URL'),
    TOKENS_API_BASE_URL: (
      process.env.TOKENS_API_BASE_URL ?? 'https://api.tokens.xyz'
    ).replace(/\/$/, ''),
    TOKENS_API_KEY: requireEnv('TOKENS_API_KEY'),
    ALCHEMY_API_KEY: requireEnv('ALCHEMY_API_KEY'),
    SOLANA_NETWORK: network,
    JUPITER_API_URL:
      process.env.JUPITER_API_URL?.replace(/\/$/, '') ??
      'https://lite-api.jup.ag/swap/v1',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL?.trim() || 'gpt-5-mini',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    VAULT_PROGRAM_ID:
      process.env.VAULT_PROGRAM_ID?.trim() || DEFAULT_VAULT_PROGRAM_ID,
  };
}
