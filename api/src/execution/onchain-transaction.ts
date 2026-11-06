import { BadRequestException, Injectable } from '@nestjs/common';
import { VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { AlchemyService } from '../alchemy/alchemy.service';
import type { AlchemyRawTransaction } from '../alchemy/alchemy.types';

export interface ConfirmedTransaction {
  transaction: VersionedTransaction;
  /** Static keys followed by lookup-table addresses, in message order. */
  accountKeys: string[];
  raw: AlchemyRawTransaction;
}

/** Reject anything that is not a base58 Ed25519 signature before calling RPC. */
export function assertSignatureFormat(signature: string): string {
  const value = signature?.trim() ?? '';
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(value);
  } catch {
    throw new BadRequestException(
      'signature is not a valid transaction signature',
    );
  }
  if (bytes.length !== 64)
    throw new BadRequestException(
      'signature is not a valid transaction signature',
    );
  return value;
}

/** Decode a successful confirmed transaction and resolve its full account list. */
export function decodeConfirmedTransaction(
  raw: AlchemyRawTransaction | null | undefined,
  signature: string,
): ConfirmedTransaction {
  if (!raw?.transaction?.[0] || !raw.meta)
    throw new BadRequestException(
      'Transaction is not confirmed yet. Retry after it lands on chain.',
    );
  if (raw.meta.err)
    throw new BadRequestException('Transaction failed on chain');
  let transaction: VersionedTransaction;
  try {
    transaction = VersionedTransaction.deserialize(
      Buffer.from(raw.transaction[0], 'base64'),
    );
  } catch {
    throw new BadRequestException('Transaction could not be decoded');
  }
  if (bs58.encode(transaction.signatures[0] ?? new Uint8Array()) !== signature)
    throw new BadRequestException('Transaction does not match signature');
  return {
    transaction,
    accountKeys: [
      ...transaction.message.staticAccountKeys.map((key) => key.toBase58()),
      ...(raw.meta.loadedAddresses?.writable ?? []),
      ...(raw.meta.loadedAddresses?.readonly ?? []),
    ],
    raw,
  };
}

/** The wallet must be the fee payer and first signer of the transaction. */
export function assertFeePayer(
  confirmed: ConfirmedTransaction,
  wallet: string,
) {
  const { message } = confirmed.transaction;
  if (
    message.header.numRequiredSignatures < 1 ||
    message.staticAccountKeys[0]?.toBase58() !== wallet
  )
    throw new BadRequestException('Transaction was not signed by this wallet');
}

/** Confirms client-reported signatures against the chain before any DB write. */
@Injectable()
export class OnchainTransactions {
  constructor(private readonly alchemy: AlchemyService) {}

  async confirmed(signature: string): Promise<ConfirmedTransaction> {
    const value = assertSignatureFormat(signature);
    return decodeConfirmedTransaction(
      await this.alchemy.getConfirmedRawTransaction(value),
      value,
    );
  }

  /** Wallet paid for and signed a successful transaction touching `account`. */
  async assertWalletTransaction(
    signature: string,
    wallet: string,
    account?: string,
  ): Promise<ConfirmedTransaction> {
    const confirmed = await this.confirmed(signature);
    assertFeePayer(confirmed, wallet);
    if (account && !confirmed.accountKeys.includes(account))
      throw new BadRequestException(
        'Transaction does not reference the expected account',
      );
    return confirmed;
  }
}
