import { BadRequestException } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import {
  assertFeePayer,
  type ConfirmedTransaction,
} from '../execution/onchain-transaction';
import { deriveLockbox, discriminator } from './vault-transaction.builder';

export interface VerifiedVaultInstruction {
  mint: string;
  lockAddress: string;
  /** lock_tokens only. */
  amountRaw?: bigint;
  /** lock_tokens only, unix seconds. */
  unlockTime?: bigint;
}

/**
 * Find the wallet's own vault instruction in a successful transaction.
 * Account order matches the Anchor program: user, mint, user ATA, lockbox, vault.
 */
export function verifyVaultInstruction(
  confirmed: ConfirmedTransaction,
  expected: {
    wallet: string;
    programId: string;
    instruction: 'lock_tokens' | 'withdraw_tokens';
    lockAddress: string;
  },
): VerifiedVaultInstruction {
  assertFeePayer(confirmed, expected.wallet);
  const { message } = confirmed.transaction;
  const staticKeys = message.staticAccountKeys.map((key) => key.toBase58());
  const tag = discriminator(expected.instruction);
  const matches = message.compiledInstructions.filter(
    (instruction) =>
      staticKeys[instruction.programIdIndex] === expected.programId &&
      Buffer.from(instruction.data).subarray(0, 8).equals(tag),
  );
  if (matches.length !== 1)
    throw new BadRequestException(
      `Transaction does not contain exactly one vault ${expected.instruction} instruction`,
    );
  const instruction = matches[0];
  // Protected vault accounts must be static keys, never lookup-table entries.
  const account = (position: number) => {
    const index = instruction.accountKeyIndexes[position];
    if (index === undefined || index >= staticKeys.length)
      throw new BadRequestException('Vault instruction accounts are invalid');
    return staticKeys[index];
  };
  const user = account(0);
  const mint = account(1);
  const lockbox = account(3);
  if (user !== expected.wallet)
    throw new BadRequestException(
      'Vault instruction belongs to another wallet',
    );
  if (lockbox !== expected.lockAddress)
    throw new BadRequestException('Vault instruction targets another lock');
  const derived = deriveLockbox(
    new PublicKey(expected.wallet),
    new PublicKey(mint),
    new PublicKey(expected.programId),
  ).toBase58();
  if (derived !== lockbox)
    throw new BadRequestException(
      'Lock address is not this wallet’s vault PDA',
    );

  if (expected.instruction === 'withdraw_tokens')
    return { mint, lockAddress: lockbox };
  const data = Buffer.from(instruction.data);
  if (data.length !== 24)
    throw new BadRequestException('Vault lock instruction data is invalid');
  return {
    mint,
    lockAddress: lockbox,
    amountRaw: data.readBigUInt64LE(8),
    unlockTime: data.readBigInt64LE(16),
  };
}

/** Raw base units to a decimal number using the mint decimals reported by the chain. */
export function lockedUiAmount(
  confirmed: ConfirmedTransaction,
  mint: string,
  amountRaw: bigint,
): number {
  const decimals = confirmed.raw.meta?.postTokenBalances?.find(
    (balance) => balance.mint === mint,
  )?.uiTokenAmount?.decimals;
  if (decimals === undefined || !Number.isInteger(decimals) || decimals < 0)
    throw new BadRequestException(
      'Token precision for the locked mint is unavailable',
    );
  const amount = Number(amountRaw) / 10 ** decimals;
  if (!Number.isFinite(amount) || amount <= 0)
    throw new BadRequestException('Locked amount is invalid');
  return amount;
}
