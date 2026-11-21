import { VersionedTransaction } from '@solana/web3.js';
import type { ExternalApprovalRequest } from './approval-service';

/** Sign only. The API verifies and durably stores these bytes before broadcasting. */
export async function signExternalApproval(
  request: ExternalApprovalRequest,
  approvalId: string,
  wallet: string,
  current: () => boolean,
  sign: (transaction: Uint8Array) => Promise<Uint8Array>,
) {
  const valid = () => current() && request.wallet === wallet &&
    request.approvalId === approvalId && request.network === 'mainnet' &&
    Number.isFinite(Date.parse(request.expiresAt)) && Date.parse(request.expiresAt) > Date.now();
  if (!valid()) throw new Error('Your wallet changed or the approval expired. Review again.');
  const bytes = Uint8Array.from(atob(request.transaction), char => char.charCodeAt(0));
  const original = VersionedTransaction.deserialize(bytes);
  if (original.message.staticAccountKeys[0]?.toBase58() !== wallet)
    throw new Error('This approval does not belong to your selected wallet.');
  const signedBytes = await sign(bytes);
  if (!valid()) throw new Error('Your wallet changed or the approval expired. Nothing was submitted.');
  // Some sign-only connectors return the signature rather than the full wire transaction.
  const signed = signedBytes.length === 64 ? original : VersionedTransaction.deserialize(signedBytes);
  if (signedBytes.length === 64) signed.addSignature(original.message.staticAccountKeys[0], signedBytes);
  const before = original.message.serialize();
  const after = signed.message.serialize();
  if (before.length !== after.length || before.some((byte, i) => byte !== after[i]))
    throw new Error('Your wallet changed the reviewed transaction. Review a fresh quote.');
  return { signedTransaction: btoa(String.fromCharCode(...signed.serialize())) };
}
