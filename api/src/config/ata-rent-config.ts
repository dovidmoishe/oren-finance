import bs58 from 'bs58';

export interface AtaRentConfig {
  signer: 'privy';
  walletId: string;
  address: string;
  minTradeRaw: bigint;
  perUserCap: number;
  dailyBudgetLamports: bigint;
  minBalanceLamports: bigint;
  timeoutMs: number;
}

/** Exact decimal conversion; no floats in rent budgets or USDC thresholds. */
function units(value: unknown, decimals: number): bigint {
  if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value))
    throw new Error('Invalid decimal');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error('Too many decimals');
  const result = BigInt(whole + fraction.padEnd(decimals, '0'));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Too large');
  return result;
}

/** Optional subsidy: bad configuration makes it unavailable, without exposing values. */
export function ataRentConfig(
  env: Record<string, unknown>,
): AtaRentConfig | undefined {
  try {
    if (env.ATA_RENT_SPONSORSHIP !== 'true' || env.DEPLOYMENT_ENV === 'preview')
      return undefined;
    if (
      env.ATA_RENT_SPONSOR_SIGNER !== 'privy' ||
      !env.PRIVY_APP_ID ||
      !env.PRIVY_APP_SECRET
    )
      return undefined;
    const address = env.ATA_RENT_SPONSOR_ADDRESS;
    const walletId = env.ATA_RENT_SPONSOR_PRIVY_WALLET_ID;
    if (
      typeof address !== 'string' ||
      bs58.decode(address).length !== 32 ||
      typeof walletId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(walletId)
    )
      return undefined;
    const minTradeRaw = units(env.ATA_RENT_MIN_TRADE_USDC ?? '5', 6);
    const dailyBudgetLamports = units(
      env.ATA_RENT_DAILY_BUDGET_SOL ?? '0.1',
      9,
    );
    const minBalanceLamports = units(
      env.ATA_RENT_SPONSOR_MIN_BALANCE_SOL ?? '0.02',
      9,
    );
    const perUserCap = Number(env.ATA_RENT_PER_USER_CAP ?? '5');
    const timeoutMs = Number(env.ATA_RENT_CONFIRM_TIMEOUT_MS ?? '8000');
    if (
      minTradeRaw <= 0n ||
      dailyBudgetLamports <= 0n ||
      !Number.isSafeInteger(perUserCap) ||
      perUserCap < 1 ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 30_000
    )
      return undefined;
    return {
      signer: 'privy',
      walletId,
      address,
      minTradeRaw,
      perUserCap,
      dailyBudgetLamports,
      minBalanceLamports,
      timeoutMs,
    };
  } catch {
    return undefined;
  }
}
