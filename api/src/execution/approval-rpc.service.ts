import { BadRequestException, Injectable } from '@nestjs/common';
import { VersionedTransaction } from '@solana/web3.js';
import { createPublicKey, verify } from 'node:crypto';
import bs58 from 'bs58';
import { AlchemyClient } from '../alchemy/alchemy.client';

@Injectable()
export class ApprovalRpc {
  constructor(private readonly rpc: AlchemyClient) {}
  decode(transaction: string, wallet: string) {
    const tx = VersionedTransaction.deserialize(
      Buffer.from(transaction, 'base64'),
    );
    if (
      tx.message.staticAccountKeys[0]?.toBase58() !== wallet ||
      tx.message.header.numRequiredSignatures < 1
    ) {
      throw new BadRequestException(
        'Prepared transaction does not belong to your wallet',
      );
    }
    return tx;
  }
  async inspect(transaction: string, wallet: string) {
    const tx = this.decode(transaction, wallet);
    const [simulated, fee] = await Promise.all([
      this.rpc.call<{ value: { err: unknown } }>('simulateTransaction', [
        transaction,
        {
          encoding: 'base64',
          sigVerify: false,
          commitment: 'confirmed',
        },
      ]),
      this.rpc.call<{ value: number | null }>('getFeeForMessage', [
        Buffer.from(tx.message.serialize()).toString('base64'),
        { commitment: 'confirmed' },
      ]),
    ]);
    if (simulated.value.err)
      throw new BadRequestException(
        'This transaction could not be simulated. Check your USDC and SOL balances and request a fresh quote.',
      );
    if (fee.value === null)
      throw new BadRequestException(
        'Transaction expired. Request a fresh quote.',
      );
    return String(fee.value);
  }
  validateSigned(unsigned: string, signed: string, wallet: string) {
    const original = this.decode(unsigned, wallet);
    const tx = this.decode(signed, wallet);
    const message = Buffer.from(tx.message.serialize());
    if (!message.equals(Buffer.from(original.message.serialize())))
      throw new BadRequestException(
        'Signed transaction does not match your approval',
      );
    for (let i = 0; i < tx.message.header.numRequiredSignatures; i++) {
      const key = createPublicKey({
        key: Buffer.concat([
          Buffer.from('302a300506032b6570032100', 'hex'),
          tx.message.staticAccountKeys[i].toBuffer(),
        ]),
        format: 'der',
        type: 'spki',
      });
      if (!verify(null, message, key, tx.signatures[i]))
        throw new BadRequestException(
          'Transaction signature could not be verified',
        );
    }
    return bs58.encode(tx.signatures[0]);
  }
  async broadcast(transaction: string) {
    return this.rpc.call<string>('sendTransaction', [
      transaction,
      {
        encoding: 'base64',
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      },
    ]);
  }
  async status(signature: string) {
    const result = await this.rpc.call<{
      value: ({ err: unknown; confirmationStatus: string | null } | null)[];
    }>('getSignatureStatuses', [
      [signature],
      { searchTransactionHistory: true },
    ]);
    return result.value[0];
  }
  async expiryHeight() {
    const result = await this.rpc.call<{
      value: { lastValidBlockHeight: number };
    }>('getLatestBlockhash', [{ commitment: 'confirmed' }]);
    const height = result.value.lastValidBlockHeight;
    if (!Number.isSafeInteger(height) || height <= 0)
      throw new BadRequestException('Unable to determine transaction validity');
    return height;
  }
  async blockhashValid(
    transaction: string,
    wallet: string,
    expiryHeight?: number,
  ) {
    // A recent confirmed blockhash can be absent from the finalized bank. That
    // absence alone must never declare an uncertain submission safe to repeat.
    if (!expiryHeight || !Number.isSafeInteger(expiryHeight)) return true;
    const finalizedHeight = await this.rpc.call<number>('getBlockHeight', [
      { commitment: 'finalized' },
    ]);
    if (finalizedHeight <= expiryHeight) return true;
    const tx = this.decode(transaction, wallet);
    return (
      await this.rpc.call<{ value: boolean }>('isBlockhashValid', [
        tx.message.recentBlockhash,
        { commitment: 'finalized' },
      ])
    ).value;
  }
}
