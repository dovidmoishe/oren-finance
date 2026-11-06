// Needs the real PublicKey (PDA derivation) and VersionedTransaction.
jest.mock(
  'rpc-websockets',
  () => ({ CommonClient: class {}, WebSocket: class {} }),
  { virtual: true },
);
jest.mock('@solana/web3.js', () =>
  jest.requireActual<Record<string, unknown>>(
    '@solana/web3.js/lib/index.cjs.js',
  ),
);

import { BadRequestException } from '@nestjs/common';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import {
  assertSignatureFormat,
  decodeConfirmedTransaction,
} from '../execution/onchain-transaction';
import { lockedUiAmount, verifyVaultInstruction } from './vault-confirmation';
import {
  deriveLockbox,
  deriveTokenVault,
  encodeLockTokens,
  encodeWithdrawTokens,
} from './vault-transaction.builder';

const programId = new PublicKey('4yBSLwXvYQhHExDuvuuEsaHfUC392SdRSiM8r6m832Mj');
const tokenProgram = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);
const mint = new PublicKey('So11111111111111111111111111111111111111112');
const blockhash = '11111111111111111111111111111111';

function vaultTransaction(
  signer: Keypair,
  data: Buffer,
  options: { user?: PublicKey; lockbox?: PublicKey; program?: PublicKey } = {},
) {
  const user = options.user ?? signer.publicKey;
  const lockbox = options.lockbox ?? deriveLockbox(user, mint, programId);
  const tx = new Transaction({
    feePayer: signer.publicKey,
    recentBlockhash: blockhash,
  });
  tx.add(
    new TransactionInstruction({
      programId: options.program ?? programId,
      keys: [
        {
          pubkey: user,
          isSigner: user.equals(signer.publicKey),
          isWritable: true,
        },
        { pubkey: mint, isSigner: false, isWritable: false },
        {
          pubkey: Keypair.generate().publicKey,
          isSigner: false,
          isWritable: true,
        },
        { pubkey: lockbox, isSigner: false, isWritable: true },
        {
          pubkey: deriveTokenVault(lockbox, programId),
          isSigner: false,
          isWritable: true,
        },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
      ],
      data,
    }),
  );
  tx.sign(signer);
  const signature = bs58.encode(tx.signature!);
  const raw = {
    transaction: [tx.serialize().toString('base64'), 'base64'] as [
      string,
      string,
    ],
    meta: {
      err: null,
      postTokenBalances: [
        { mint: mint.toBase58(), uiTokenAmount: { decimals: 6 } },
      ],
    },
  };
  return {
    signature,
    confirmed: decodeConfirmedTransaction(raw, signature),
    lockbox,
  };
}

describe('vault confirmation', () => {
  const owner = Keypair.generate();
  const wallet = owner.publicKey.toBase58();

  it('reads the locked amount and unlock time from the instruction itself', () => {
    const { confirmed, lockbox } = vaultTransaction(
      owner,
      encodeLockTokens(2_500_000n, 1_900_000_000n),
    );
    const lock = verifyVaultInstruction(confirmed, {
      wallet,
      programId: programId.toBase58(),
      instruction: 'lock_tokens',
      lockAddress: lockbox.toBase58(),
    });
    expect(lock).toEqual({
      mint: mint.toBase58(),
      lockAddress: lockbox.toBase58(),
      amountRaw: 2_500_000n,
      unlockTime: 1_900_000_000n,
    });
    expect(lockedUiAmount(confirmed, lock.mint, lock.amountRaw!)).toBe(2.5);
  });

  it('accepts the owner withdrawing from their own lock', () => {
    const { confirmed, lockbox } = vaultTransaction(
      owner,
      encodeWithdrawTokens(),
    );
    expect(
      verifyVaultInstruction(confirmed, {
        wallet,
        programId: programId.toBase58(),
        instruction: 'withdraw_tokens',
        lockAddress: lockbox.toBase58(),
      }).lockAddress,
    ).toBe(lockbox.toBase58());
  });

  it('rejects an unrelated confirmed transaction used to clear a victim lock', () => {
    const attacker = Keypair.generate();
    const victimLock = deriveLockbox(owner.publicKey, mint, programId);
    const { confirmed } = vaultTransaction(attacker, encodeWithdrawTokens());
    expect(() =>
      verifyVaultInstruction(confirmed, {
        wallet,
        programId: programId.toBase58(),
        instruction: 'withdraw_tokens',
        lockAddress: victimLock.toBase58(),
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a withdraw that targets a different lock', () => {
    const { confirmed } = vaultTransaction(owner, encodeWithdrawTokens());
    const otherLock = deriveLockbox(owner.publicKey, tokenProgram, programId);
    expect(() =>
      verifyVaultInstruction(confirmed, {
        wallet,
        programId: programId.toBase58(),
        instruction: 'withdraw_tokens',
        lockAddress: otherLock.toBase58(),
      }),
    ).toThrow('another lock');
  });

  it('rejects a lock instruction submitted as an unlock', () => {
    const { confirmed, lockbox } = vaultTransaction(
      owner,
      encodeLockTokens(1n, 1_900_000_000n),
    );
    expect(() =>
      verifyVaultInstruction(confirmed, {
        wallet,
        programId: programId.toBase58(),
        instruction: 'withdraw_tokens',
        lockAddress: lockbox.toBase58(),
      }),
    ).toThrow('exactly one vault withdraw_tokens');
  });

  it('rejects an instruction sent to another program', () => {
    const { confirmed, lockbox } = vaultTransaction(
      owner,
      encodeWithdrawTokens(),
      {
        program: Keypair.generate().publicKey,
      },
    );
    expect(() =>
      verifyVaultInstruction(confirmed, {
        wallet,
        programId: programId.toBase58(),
        instruction: 'withdraw_tokens',
        lockAddress: lockbox.toBase58(),
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects failed and unconfirmed transactions', () => {
    const { signature, confirmed } = vaultTransaction(
      owner,
      encodeWithdrawTokens(),
    );
    expect(() =>
      decodeConfirmedTransaction(
        {
          ...confirmed.raw,
          meta: { err: { InstructionError: [0, 'Custom'] } },
        },
        signature,
      ),
    ).toThrow('failed on chain');
    expect(() => decodeConfirmedTransaction(null, signature)).toThrow(
      'not confirmed yet',
    );
  });

  it('rejects bytes that do not match the reported signature', () => {
    const { confirmed } = vaultTransaction(owner, encodeWithdrawTokens());
    const other = vaultTransaction(owner, encodeLockTokens(1n, 1n));
    expect(() =>
      decodeConfirmedTransaction(confirmed.raw, other.signature),
    ).toThrow('does not match');
  });

  it('rejects malformed signatures before any RPC call', () => {
    expect(() => assertSignatureFormat('sig')).toThrow(BadRequestException);
    expect(() => assertSignatureFormat('0OIl')).toThrow(BadRequestException);
  });
});
