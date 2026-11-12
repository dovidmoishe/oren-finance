import type {
  AlchemyParsedTokenBalance,
  AlchemyParsedTransaction,
} from '../alchemy/alchemy.types';
import { USDC_MINT } from '../config/constants';

export type BriefLot = {
  assetId: string;
  ticker: string;
  units: string;
  amount: number;
  price?: number;
};
export type Valuation = {
  value?: number;
  reliable: boolean;
  accounts: string[];
  lots: Record<string, BriefLot>;
};

function ownerBalances(rows: AlchemyParsedTokenBalance[], wallet: string) {
  const out = new Map<string, bigint>();
  for (const row of rows) {
    if (!row.owner) return null;
    if (row.owner !== wallet) continue;
    const raw = row.uiTokenAmount?.amount;
    if (!row.mint || typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
    out.set(row.mint, (out.get(row.mint) ?? 0n) + BigInt(raw));
  }
  return out;
}

export function walletDeltas(tx: AlchemyParsedTransaction, wallet: string) {
  if (
    !tx.meta ||
    tx.meta.err ||
    !tx.meta.preTokenBalances ||
    !tx.meta.postTokenBalances
  )
    return null;
  const before = ownerBalances(tx.meta.preTokenBalances, wallet);
  const after = ownerBalances(tx.meta.postTokenBalances, wallet);
  if (!before || !after) return null;
  const out = new Map<string, bigint>();
  for (const mint of new Set([...before.keys(), ...after.keys()])) {
    const delta = (after.get(mint) ?? 0n) - (before.get(mint) ?? 0n);
    if (delta) out.set(mint, delta);
  }
  return out;
}

export function isPlainUsdcTransfer(
  tx: AlchemyParsedTransaction,
  wallet: string,
) {
  const instructions = tx.transaction?.message?.instructions;
  if (!instructions?.length) return false;
  const transfers = instructions.filter(
    ({ parsed }) =>
      parsed?.type === 'transfer' || parsed?.type === 'transferChecked',
  );
  if (transfers.length !== 1) return false;
  const transfer = transfers[0];
  if (transfer.program !== 'spl-token') return false;
  const info = transfer.parsed?.info;
  if (!info) return false;
  const keys = tx.transaction?.message?.accountKeys ?? [];
  const belongs = (address: unknown) =>
    [
      ...(tx.meta?.preTokenBalances ?? []),
      ...(tx.meta?.postTokenBalances ?? []),
    ].some(
      (row) =>
        row.owner === wallet &&
        row.mint === USDC_MINT &&
        row.accountIndex !== undefined &&
        (typeof keys[row.accountIndex] === 'string'
          ? keys[row.accountIndex]
          : (keys[row.accountIndex] as { pubkey?: string })?.pubkey) ===
          address,
    );
  if (belongs(info.source) === belongs(info.destination)) return false;
  return instructions.every(
    (item) =>
      item === transfer ||
      (item.program === 'spl-associated-token-account' &&
        ['create', 'createIdempotent'].includes(item.parsed?.type ?? '')) ||
      item.programId === 'ComputeBudget111111111111111111111111111111',
  );
}

export function calculatePnl(
  open: Valuation,
  close: Valuation,
  changes: ReadonlyMap<string, bigint>,
  netUsdc: bigint,
) {
  if (
    !open.reliable ||
    !close.reliable ||
    open.value === undefined ||
    close.value === undefined
  )
    return null;
  for (const mint of new Set([
    ...Object.keys(open.lots),
    ...Object.keys(close.lots),
  ])) {
    const change =
      BigInt(close.lots[mint]?.units ?? '0') -
      BigInt(open.lots[mint]?.units ?? '0');
    if (change !== (changes.get(mint) ?? 0n)) return null;
  }
  const pnl = close.value - open.value - Number(netUsdc) / 1_000_000;
  return Number.isFinite(pnl) ? pnl : null;
}

export function priceMoves(open: Valuation, close: Valuation) {
  return Object.entries(open.lots)
    .flatMap(([mint, before]) => {
      const after = close.lots[mint];
      if (
        mint === USDC_MINT ||
        before.price === undefined ||
        after?.price === undefined
      )
        return [];
      return [
        {
          ticker: before.ticker,
          usd: before.amount * (after.price - before.price),
        },
      ];
    })
    .sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd))
    .slice(0, 3);
}
