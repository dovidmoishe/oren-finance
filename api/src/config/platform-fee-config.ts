import { PublicKey } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { USDC_MINT } from './constants';

export interface PlatformFeeConfig {
  bps: number;
  account: string;
}

/** Optional revenue: invalid configuration leaves ordinary trading available. */
export function platformFeeConfig(
  env: Record<string, unknown>,
): PlatformFeeConfig | undefined {
  const value = env.PLATFORM_FEE_BPS;
  const raw =
    typeof value === 'string'
      ? value.trim()
      : typeof value === 'number'
        ? String(value)
        : value == null
          ? '0'
          : 'invalid';
  if (raw === '' || raw === '0') return undefined;
  try {
    if (!/^\d+$/.test(raw)) throw new Error();
    const bps = Number(raw);
    if (!Number.isInteger(bps) || bps < 0 || bps > 255) throw new Error();
    if (bps === 0) return undefined;
    const address = (key: string) => {
      const supplied = env[key];
      if (supplied != null && typeof supplied !== 'string') throw new Error();
      const value = typeof supplied === 'string' ? supplied.trim() : '';
      if (value && bs58.decode(value).length !== 32) throw new Error();
      return value || undefined;
    };
    const owner = address('PLATFORM_FEE_OWNER');
    const explicit = address('PLATFORM_FEE_USDC_ACCOUNT');
    const derived = owner
      ? getAssociatedTokenAddressSync(
          new PublicKey(USDC_MINT),
          new PublicKey(owner),
          false,
          TOKEN_PROGRAM_ID,
        ).toBase58()
      : undefined;
    if (!explicit && !derived) throw new Error();
    if (explicit && derived && explicit !== derived) throw new Error();
    return { bps, account: explicit ?? derived! };
  } catch {
    return undefined;
  }
}
