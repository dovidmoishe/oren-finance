import { BadRequestException } from '@nestjs/common';
import { MessageV0, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { createPublicKey, verify } from 'node:crypto';
import bs58 from 'bs58';

export const SPONSORED_SOLANA_CHAIN = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const TOKEN_PROGRAMS = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
]);

export function sponsoredRequestBody(transaction: string, referenceId: string) {
  return {
    method: 'signAndSendTransaction' as const,
    chain_type: 'solana' as const,
    caip2: SPONSORED_SOLANA_CHAIN,
    sponsor: true as const,
    reference_id: referenceId,
    params: { transaction, encoding: 'base64' as const },
  };
}

export function isSponsoredRequest(request: Record<string, unknown>): boolean {
  const body = request.body as Record<string, unknown> | undefined;
  return body?.method === 'signAndSendTransaction' && body.sponsor === true;
}

/** Only unsigned, single-wallet transactions can safely have their payer replaced. */
export function sponsorshipEligible(
  transaction: string,
  wallet: string,
): boolean {
  try {
    const tx = VersionedTransaction.deserialize(
      Buffer.from(transaction, 'base64'),
    );
    return (
      tx.message.header.numRequiredSignatures === 1 &&
      tx.message.staticAccountKeys[0]?.toBase58() === wallet &&
      tx.message.compiledInstructions.every(
        (instruction) =>
          instruction.programIdIndex < tx.message.staticAccountKeys.length,
      ) &&
      tx.signatures.every((signature) =>
        signature.every((byte) => byte === 0),
      ) &&
      // A new signer/key consumes 96 bytes. Never opt a packet into an invalid size.
      tx.serialize().length + 96 <= 1232 &&
      !tx.message.compiledInstructions.some(
        (instruction) =>
          TOKEN_PROGRAMS.has(
            tx.message.staticAccountKeys[
              instruction.programIdIndex
            ]?.toBase58(),
          ) && instruction.data[0] === 9,
      )
    );
  } catch {
    return false;
  }
}

/**
 * Unsigned simulation only: prepend a funded system account as fee payer while
 * preserving every instruction's original account, including ATA rent payers.
 * These bytes are never authorized, signed or submitted.
 */
export function sponsorshipSimulation(
  transaction: string,
  wallet: string,
  payer: string,
): string {
  if (!sponsorshipEligible(transaction, wallet))
    throw new BadRequestException(
      'This transaction is not eligible for gas sponsorship',
    );
  const tx = VersionedTransaction.deserialize(
    Buffer.from(transaction, 'base64'),
  );
  const message = tx.message;
  const payerKey = new PublicKey(payer);
  if (message.staticAccountKeys.some((key) => key.equals(payerKey)))
    throw new BadRequestException('Simulation payer overlaps a trade account');
  const keys = [payerKey, ...message.staticAccountKeys];
  const instructions = message.compiledInstructions.map((instruction) => ({
    programIdIndex: instruction.programIdIndex + 1,
    accountKeyIndexes: instruction.accountKeyIndexes.map((index) => index + 1),
    data: instruction.data,
  }));
  return Buffer.from(
    new VersionedTransaction(
      new MessageV0({
        header: { ...message.header, numRequiredSignatures: 2 },
        staticAccountKeys: keys,
        recentBlockhash: message.recentBlockhash,
        compiledInstructions: instructions,
        addressTableLookups: message.addressTableLookups,
      }),
    ).serialize(),
  ).toString('base64');
}

function semanticMessage(tx: VersionedTransaction, wallet: string) {
  const message = tx.message;
  // Compare table + entry identities without trusting a mutable lookup result.
  const keys = [
    ...message.staticAccountKeys.map((key) => key.toBase58()),
    ...message.addressTableLookups.flatMap((table) =>
      Array.from(
        table.writableIndexes,
        (index) => `${table.accountKey.toBase58()}:w:${index}`,
      ),
    ),
    ...message.addressTableLookups.flatMap((table) =>
      Array.from(
        table.readonlyIndexes,
        (index) => `${table.accountKey.toBase58()}:r:${index}`,
      ),
    ),
  ];
  return message.compiledInstructions.map((instruction) => ({
    program: keys[instruction.programIdIndex],
    accounts: instruction.accountKeyIndexes.map((index) => ({
      key: keys[index],
      signer: message.isAccountSigner(index),
      // The original fee payer is implicitly writable even if only used as authority.
      writable:
        keys[index] === wallet ? true : message.isAccountWritable(index),
    })),
    data: Buffer.from(instruction.data).toString('base64'),
  }));
}

/** Permit only the documented fee-payer/blockhash rewrite, never changed trade instructions. */
export function validateSponsoredTransaction(
  unsigned: string,
  signed: string,
  wallet: string,
  signature: string,
) {
  if (!sponsorshipEligible(unsigned, wallet))
    throw new Error('Ineligible sponsored transaction');
  const original = VersionedTransaction.deserialize(
    Buffer.from(unsigned, 'base64'),
  );
  const landed = VersionedTransaction.deserialize(
    Buffer.from(signed, 'base64'),
  );
  const message = landed.message;
  const walletIndex = message.staticAccountKeys.findIndex(
    (key) => key.toBase58() === wallet,
  );
  const payer = message.staticAccountKeys[0]?.toBase58();
  const originalKeys = original.message.staticAccountKeys
    .map((key) => key.toBase58())
    .sort();
  const landedKeys = message.staticAccountKeys
    .slice(1)
    .map((key) => key.toBase58())
    .sort();
  if (
    !payer ||
    payer === wallet ||
    walletIndex < 1 ||
    message.header.numRequiredSignatures !== 2 ||
    !message.isAccountSigner(walletIndex) ||
    JSON.stringify(originalKeys) !== JSON.stringify(landedKeys) ||
    JSON.stringify(semanticMessage(original, wallet)) !==
      JSON.stringify(semanticMessage(landed, wallet)) ||
    bs58.encode(landed.signatures[0]) !== signature
  )
    throw new Error('Sponsored transaction differs from the authorized trade');
  const bytes = Buffer.from(message.serialize());
  for (let index = 0; index < 2; index++) {
    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        message.staticAccountKeys[index].toBuffer(),
      ]),
      format: 'der',
      type: 'spki',
    });
    if (!verify(null, bytes, key, landed.signatures[index]))
      throw new Error('Invalid sponsored transaction signature');
  }
  return signed;
}
