import { VersionedTransaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';

/**
 * Precreating an ATA would break a provider's non-idempotent Create instruction.
 * Keep those swaps untouched on the existing user-paid path. Program IDs must
 * resolve statically so an unresolved lookup cannot hide an incompatible setup.
 */
export function ataRentSwapCompatible(transaction: string): boolean {
  try {
    const { message } = VersionedTransaction.deserialize(
      Buffer.from(transaction, 'base64'),
    );
    return message.compiledInstructions.every((instruction) => {
      const program = message.staticAccountKeys[instruction.programIdIndex];
      if (!program) return false;
      return (
        program.toBase58() !== ASSOCIATED_TOKEN_PROGRAM_ID.toBase58() ||
        (instruction.data.length === 1 && instruction.data[0] === 1)
      );
    });
  } catch {
    return false;
  }
}
