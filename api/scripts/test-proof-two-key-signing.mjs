import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { PrivyClient, formatRequestForAuthorizationSignature,
  generateAuthorizationSignature } from '@privy-io/node';
import {
  AddressLookupTableAccount, Connection, Keypair, PublicKey,
  TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import { inspectDelegatedJupiterTransaction } from '../dist/src/mcp-auth/delegated-jupiter-guard.js';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
if (process.env.PROOF_TEST_TWO_KEY_SIGNING !== 'true')
  throw new Error('Set PROOF_TEST_TWO_KEY_SIGNING=true for this unfunded sign-only test');
const address = process.env.PROOF_WALLET_ADDRESS;
const email = process.env.PROOF_WALLET_EMAIL;
const { PRIVY_APP_ID: appId, PRIVY_APP_SECRET: appSecret, ALCHEMY_API_KEY: rpcKey } = process.env;
if (!address || !email || !appId || !appSecret || !rpcKey)
  throw new Error('Proof identity and provider credentials required');
const proof = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../.proof/${name}`, import.meta.url)), 'utf8'));
const keys = proof('quorum-keys.json');
const policy = proof('jupiter-buy.policy.json');
const created = proof('jupiter-buy.created.json');
if (keys.proofWalletAddress !== address || !keys.twoKey?.quorumId ||
    !keys.twoKey.api?.privateKeyDerBase64 || !keys.twoKey.gate?.privateKeyDerBase64 ||
    keys.admin.quorumId === keys.twoKey.quorumId || policy.owner_id !== keys.admin.quorumId ||
    !created.policyId)
  throw new Error('Proof quorum or policy identity changed');
const privy = new PrivyClient({ appId, appSecret });
const user = await privy.users().getByWalletAddress({ address });
if (!user.linked_accounts.some((item) => item.type === 'email' &&
    item.address?.toLowerCase() === email.toLowerCase()))
  throw new Error('Disposable user email changed');
const linked = user.linked_accounts.filter((item) => item.type === 'wallet' &&
  item.chain_type === 'solana' && item.wallet_client_type === 'privy' &&
  item.address === address && item.id);
if (linked.length !== 1 || !linked[0].delegated)
  throw new Error('Expected one newly delegated embedded proof wallet');
const wallet = await privy.wallets().get(linked[0].id);
if (wallet.address !== address || wallet.chain_type !== 'solana' ||
    wallet.additional_signers?.length !== 1 ||
    wallet.additional_signers[0].signer_id !== keys.twoKey.quorumId ||
    !isDeepStrictEqual(wallet.additional_signers[0].override_policy_ids, [created.policyId]))
  throw new Error('Browser did not grant the exact two-key quorum and policy');
const remote = await privy.policies().get(created.policyId);
if (remote.owner_id !== keys.admin.quorumId || remote.chain_type !== 'solana' ||
    remote.rules?.length !== policy.rules.length ||
    policy.rules.some((rule, index) => {
      const actual = remote.rules[index];
      return rule.name !== actual?.name || rule.method !== actual.method ||
        rule.action !== actual.action || rule.conditions?.length !== actual.conditions?.length ||
        rule.conditions.some((condition, c) => {
          const other = actual.conditions[c];
          return condition.field_source !== other.field_source ||
            condition.field !== other.field || condition.operator !== other.operator ||
            !isDeepStrictEqual(condition.value, other.value) ||
            !isDeepStrictEqual(condition.idl ?? null, other.idl ?? null);
        });
    }))
  throw new Error('Privy policy no longer matches the owner-reviewed policy');

const rpc = new Connection(`https://solana-mainnet.g.alchemy.com/v2/${rpcKey}`, 'confirmed');
if (await rpc.getBalance(new PublicKey(address)) !== 0)
  throw new Error('Proof wallet has been funded; refuse sign-only test');
const routeRule = policy.rules.find((rule) => rule.name === 'allow bounded jupiter buy');
const condition = (field) => routeRule?.conditions.find((item) =>
  item.field === `shared_accounts_route.${field}`)?.value;
const inputMint = condition('accounts.source_mint');
const outputMint = condition('accounts.destination_mint');
const sourceAta = condition('accounts.source_token_account');
const destinationAta = condition('accounts.destination_token_account');
const rawInput = condition('args.in_amount');
const maxSlippageBps = Number(condition('args.slippage_bps'));
if (!inputMint || !outputMint || !sourceAta || !destinationAta ||
    rawInput !== '1000000' || maxSlippageBps !== 50)
  throw new Error('Reviewed route values changed');
const url = new URL('https://api.jup.ag/swap/v1/quote');
for (const [field, value] of Object.entries({ inputMint, outputMint,
  amount: rawInput, slippageBps: String(maxSlippageBps) })) url.searchParams.set(field, value);
async function jupiter(url, init = {}) {
  const response = await fetch(url, { ...init, headers: {
    ...(process.env.JUPITER_API_KEY ? { 'x-api-key': process.env.JUPITER_API_KEY } : {}),
    ...(init.headers ?? {}),
  }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Jupiter HTTP ${response.status}`);
  return response.json();
}
const quote = await jupiter(url);
const swap = await jupiter('https://api.jup.ag/swap/v1/swap', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ quoteResponse: quote, userPublicKey: address,
    wrapAndUnwrapSol: false, dynamicComputeUnitLimit: false, useSharedAccounts: true }),
});
if (!swap.swapTransaction || quote.inAmount !== rawInput)
  throw new Error('Fresh quote or transaction missing');
const original = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, 'base64'));
const tables = await Promise.all(original.message.addressTableLookups.map(async ({ accountKey }) => {
  const { value } = await rpc.getAddressLookupTable(accountKey);
  if (!value) throw new Error('Jupiter lookup table missing');
  return value;
}));
const instructions = TransactionMessage.decompile(original.message,
  { addressLookupTableAccounts: tables }).instructions;
const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const COMPUTE = 'ComputeBudget111111111111111111111111111111';
if (instructions.some((item) => ![JUPITER, COMPUTE,
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'].includes(item.programId.toBase58())))
  throw new Error('Unrecognized transaction setup');
const chosen = instructions.filter((item) => [JUPITER, COMPUTE].includes(item.programId.toBase58()));
const route = chosen.find((item) => item.programId.toBase58() === JUPITER);
if (!route) throw new Error('Jupiter route missing');
const protectedKeys = new Set([inputMint, outputMint, sourceAta, destinationAta]);
const placeholder = Keypair.generate().publicKey;
const safeTables = tables.map((table) => new AddressLookupTableAccount({ key: table.key,
  state: { ...table.state, addresses: table.state.addresses.map((item) =>
    protectedKeys.has(item.toBase58()) ? placeholder : item) } }));
const compile = (extra = []) => Buffer.from(new VersionedTransaction(
  new TransactionMessage({ payerKey: new PublicKey(address),
    recentBlockhash: original.message.recentBlockhash, instructions: [...chosen, ...extra] })
    .compileToV0Message(safeTables)).serialize()).toString('base64');
const resolve = async (key) => tables.find((table) => table.key.equals(key)) ?? null;
const expected = { wallet: address, inputMint, outputMint, sourceAta, destinationAta,
  rawInput, maxInputRaw: rawInput, quotedOutputRaw: quote.outAmount, maxSlippageBps };
const transaction = compile();
await inspectDelegatedJupiterTransaction(transaction, expected, resolve);
let doubledRejected = false;
try { await inspectDelegatedJupiterTransaction(compile([route]), expected, resolve); }
catch (error) { doubledRejected = /exactly one Jupiter route/.test(String(error)); }
if (!doubledRejected) throw new Error('Gate accepted two routes; refuse all Privy calls');

const attempts = [];
for (const [label, auth, shouldSign] of [
  ['api_key_only', [keys.twoKey.api.privateKeyDerBase64], false],
  ['gate_key_only', [keys.twoKey.gate.privateKeyDerBase64], false],
  ['both_keys', [keys.twoKey.api.privateKeyDerBase64, keys.twoKey.gate.privateKeyDerBase64], true],
]) {
  try {
    const result = await privy.wallets().solana().signTransaction(linked[0].id, {
      transaction, authorization_context: { authorization_private_keys: auth },
      idempotency_key: randomUUID(),
    });
    if (!shouldSign) throw new Error(`${label} unexpectedly signed`);
    const signed = VersionedTransaction.deserialize(Buffer.from(result.signed_transaction, 'base64'));
    if (!Buffer.from(signed.message.serialize()).equals(Buffer.from(
      VersionedTransaction.deserialize(Buffer.from(transaction, 'base64')).message.serialize())))
      throw new Error('Privy changed the signed transaction message');
    attempts.push({ label, signed: true });
  } catch (error) {
    if (shouldSign || /unexpectedly signed/.test(String(error))) throw error;
    attempts.push({ label, signed: false, status: error?.status ?? null });
  }
}
const requestId = randomUUID();
const requestExpiry = Date.now() + 30_000;
const canonicalRequest = {
  version: 1, method: 'POST',
  url: `https://api.privy.io/v1/wallets/${linked[0].id}/rpc`,
  body: { method: 'signTransaction', chain_type: 'solana',
    params: { transaction, encoding: 'base64' } },
  headers: { 'privy-app-id': appId, 'privy-idempotency-key': requestId,
    'privy-request-expiry': String(requestExpiry) },
};
const canonicalBytes = formatRequestForAuthorizationSignature(canonicalRequest);
const manualSignatures = [keys.twoKey.api.privateKeyDerBase64,
  keys.twoKey.gate.privateKeyDerBase64].map((authorizationPrivateKey) =>
  generateAuthorizationSignature({ authorizationPrivateKey, input: canonicalBytes }));
const manual = await privy.wallets().solana().signTransaction(linked[0].id, {
  transaction,
  authorization_context: { signatures: manualSignatures },
  idempotency_key: requestId,
  request_expiry: requestExpiry,
});
const manuallySigned = VersionedTransaction.deserialize(
  Buffer.from(manual.signed_transaction, 'base64'));
if (!Buffer.from(manuallySigned.message.serialize()).equals(Buffer.from(
  VersionedTransaction.deserialize(Buffer.from(transaction, 'base64')).message.serialize())))
  throw new Error('Manual canonical signatures authorized different bytes');
attempts.push({ label: 'both_manual_signatures_same_request', signed: true });
console.log(JSON.stringify({ unfunded: true, broadcast: false, gateRejectedDoubleRoute: true,
  quorumThreshold: 2, lookupTables: tables.length, attempts }));
