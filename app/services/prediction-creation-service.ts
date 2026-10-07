import { apiRequest } from "./api-client";
import type { VersionedTransaction } from "@solana/web3.js";
import type {
  CreationAttempt,
  CreationConfirmInput,
  CreationPatchInput,
  CreationPrepareInput,
  CreationPrepared,
  PredictionCreationDraft,
} from "@/types/prediction-creation";

type Session = { token: string; wallet: string; expiresAt: string };
let session: Session | undefined;
export function clearCreationSession() {
  session = undefined;
}
export function creationSessionHeaders(
  wallet?: string,
): Record<string, string> {
  if (
    !session ||
    session.wallet !== wallet ||
    Date.parse(session.expiresAt) <= Date.now()
  )
    return {};
  return { "x-oren-creation-session": session.token };
}
export function creationAuthorized(wallet?: string) {
  return Boolean(creationSessionHeaders(wallet)["x-oren-creation-session"]);
}
export async function verifyCreationWallet(
  wallet: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
) {
  const challenge = await apiRequest<{ nonce: string; message: string }>(
    "/predictions/creation/session/challenge",
    { method: "POST", body: { wallet } },
  );
  const signature = encodeBase58(
    await signMessage(new TextEncoder().encode(challenge.message)),
  );
  const result = await apiRequest<Session>("/predictions/creation/session", {
    method: "POST",
    body: { nonce: challenge.nonce, signature },
  });
  if (result.wallet !== wallet) throw new Error("Wallet verification mismatch");
  session = result;
}
function headers(wallet: string) {
  const token = creationSessionHeaders(wallet)["x-oren-creation-session"];
  if (!token) throw new Error("Verify this wallet to access creation drafts");
  return { Authorization: `Bearer ${token}` };
}
export function getCreationDraft(wallet: string, id: string) {
  return apiRequest<PredictionCreationDraft>(
    `/predictions/creation/${encodeURIComponent(id)}`,
    { headers: headers(wallet) },
  );
}
export function reviseCreationDraft(
  wallet: string,
  id: string,
  input: CreationPatchInput,
) {
  return apiRequest<PredictionCreationDraft>(
    `/predictions/creation/${encodeURIComponent(id)}`,
    { method: "PATCH", headers: headers(wallet), body: input },
  );
}
export function quoteCreationDraft(
  wallet: string,
  id: string,
  version: number,
) {
  return apiRequest<PredictionCreationDraft>(
    `/predictions/creation/${encodeURIComponent(id)}/quote`,
    { method: "POST", headers: headers(wallet), body: { version } },
  );
}
export function prepareCreation(wallet: string, input: CreationPrepareInput) {
  return apiRequest<CreationPrepared>("/predictions/creation/prepare", {
    method: "POST",
    headers: headers(wallet),
    body: input,
  });
}
export function confirmCreation(wallet: string, input: CreationConfirmInput) {
  return apiRequest<CreationAttempt>("/predictions/creation/confirm", {
    method: "POST",
    headers: headers(wallet),
    body: input,
  });
}
export function decimalUnits(value: string, decimals = 6) {
  if (
    !/^\d+$/.test(value) ||
    !Number.isInteger(decimals) ||
    decimals < 1 ||
    decimals > 18
  )
    throw new Error("Invalid base units");
  const digits = BigInt(value)
    .toString()
    .padStart(decimals + 1, "0");
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}
export function encodeBase58(bytes: Uint8Array) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt(0);
  for (const byte of bytes) value = value * BigInt(256) + BigInt(byte);
  let result = "";
  while (value) {
    result = alphabet[Number(value % BigInt(58))] + result;
    value /= BigInt(58);
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = "1" + result;
  }
  return result;
}
export type PendingCreation = {
  wallet: string;
  draftId: string;
  attemptId: string;
  signature: string;
};
const pendingKey = (wallet: string) => `oren-panta-pending:${wallet}`;
export function persistPendingCreation(value: PendingCreation) {
  localStorage.setItem(pendingKey(value.wallet), JSON.stringify(value));
}
export function pendingCreation(wallet: string): PendingCreation | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(pendingKey(wallet)) ?? "null",
    ) as PendingCreation | null;
    return value?.wallet === wallet &&
      typeof value.draftId === "string" &&
      typeof value.attemptId === "string" &&
      typeof value.signature === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}
export function clearPendingCreation(wallet: string) {
  localStorage.removeItem(pendingKey(wallet));
}
export function releaseExpiredCreation(wallet: string, id: string) {
  return apiRequest<PredictionCreationDraft>(
    `/predictions/creation/${encodeURIComponent(id)}/release-expired`,
    { method: "POST", headers: headers(wallet) },
  );
}
export async function submitCreationTransaction(
  wallet: string,
  draftId: string,
  prepared: CreationPrepared,
  unsigned: VersionedTransaction,
  adapter: {
    currentWallet: () => string | undefined;
    genesis: () => Promise<string>;
    height: () => Promise<number>;
    sign: (transaction: VersionedTransaction) => Promise<VersionedTransaction>;
    broadcast: (bytes: Uint8Array) => Promise<string>;
  },
) {
  if (pendingCreation(wallet))
    throw new Error(
      "Recover the saved signature before submitting another payment",
    );
  if ((await adapter.genesis()) !== prepared.genesisHash)
    throw new Error(
      "Wallet RPC network does not match verified creation network",
    );
  if (
    (await adapter.height()) > prepared.lastValidBlockHeight ||
    Date.parse(prepared.expiresAt) <= Date.now()
  )
    throw new Error("Transaction expired; reload the proposal");
  if (
    adapter.currentWallet() !== wallet ||
    unsigned.message.header.numRequiredSignatures !== 1 ||
    unsigned.message.staticAccountKeys[0].toBase58() !== wallet
  )
    throw new Error("Connected signer does not match the approved transaction");
  const message = unsigned.message.serialize();
  const signed = await adapter.sign(unsigned);
  if (adapter.currentWallet() !== wallet)
    throw new Error("Connected wallet changed; transaction was not submitted");
  const after = signed.message.serialize();
  if (
    message.length !== after.length ||
    message.some((byte, i) => byte !== after[i]) ||
    signed.signatures.length !== 1 ||
    !signed.signatures[0].some((b) => b !== 0)
  )
    throw new Error("Wallet changed the approved transaction");
  const signature = encodeBase58(signed.signatures[0]);
  persistPendingCreation({
    wallet,
    draftId,
    attemptId: prepared.attemptId,
    signature,
  });
  const input = { draftId, attemptId: prepared.attemptId, signature };
  const prior = await confirmCreation(wallet, input);
  if (prior.status === "registered" || prior.status === "failed") {
    clearPendingCreation(wallet);
    return prior;
  }
  if (prior.status !== "registration_pending") {
    try {
      if ((await adapter.broadcast(signed.serialize())) !== signature)
        throw new Error();
    } catch {
      throw new Error(
        "Submission outcome unknown. Recover this signature; do not submit another payment.",
      );
    }
  }
  const result = await confirmCreation(wallet, input);
  if (result.status === "registered" || result.status === "failed")
    clearPendingCreation(wallet);
  return result;
}
