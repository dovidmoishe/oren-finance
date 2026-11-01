import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  AddressLookupTableAccount, Connection, Keypair, PublicKey,
  SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import { PrivyClient } from '@privy-io/node';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

if (process.env.PROOF_TEST_JUPITER_BUY_POLICY !== 'true')
  throw new Error('Set PROOF_TEST_JUPITER_BUY_POLICY=true for this manual sign-only proof');
const address = process.env.PROOF_WALLET_ADDRESS;
const email = process.env.PROOF_WALLET_EMAIL;
if (!address || !email || !process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET || !process.env.ALCHEMY_API_KEY)
  throw new Error('Proof wallet identity, Privy credentials and Solana RPC are required');
const keys = JSON.parse(readFileSync(fileURLToPath(new URL('../.proof/quorum-keys.json', import.meta.url)), 'utf8'));
const created = JSON.parse(readFileSync(fileURLToPath(new URL('../.proof/jupiter-buy.created.json', import.meta.url)), 'utf8'));
const policy = JSON.parse(readFileSync(fileURLToPath(new URL('../.proof/jupiter-buy.policy.json', import.meta.url)), 'utf8'));
if (keys.proofWalletAddress !== address || !keys.signer?.privateKeyDerBase64 || !created.policyId ||
    policy.owner_id !== keys.admin.quorumId)
  throw new Error('Local proof wallet, signer and policy do not match');
const routeRule = policy.rules.find((rule) => rule.name === 'allow bounded jupiter buy');
const condition = (field) => routeRule?.conditions.find((item) => item.field === `shared_accounts_route.${field}`)?.value;
const inputMint = condition('accounts.source_mint');
const outputMint = condition('accounts.destination_mint');
const sourceAta = condition('accounts.source_token_account');
const destinationAta = condition('accounts.destination_token_account');
const maxInputRaw = condition('args.in_amount');
const maxSlippageBps = Number(condition('args.slippage_bps'));
if (!inputMint || !outputMint || !sourceAta || !destinationAta ||
    maxInputRaw !== '1000000' || maxSlippageBps !== 50)
  throw new Error('Proof policy no longer has the expected exact route bounds');

const privy = new PrivyClient({ appId: process.env.PRIVY_APP_ID, appSecret: process.env.PRIVY_APP_SECRET });
const user = await privy.users().getByWalletAddress({ address });
if (!user.linked_accounts.some((item) => item.type === 'email' && item.address?.toLowerCase() === email.toLowerCase()))
  throw new Error('Proof wallet email does not match');
const linked = user.linked_accounts.filter((item) =>
  item.type === 'wallet' && item.chain_type === 'solana' && item.wallet_client_type === 'privy' && item.address === address,
);
if (linked.length !== 1 || typeof linked[0].id !== 'string')
  throw new Error('Expected exactly one matching embedded Solana wallet');
const wallet = await privy.wallets().get(linked[0].id);
if (wallet.address !== address || wallet.additional_signers?.length !== 1 ||
    wallet.additional_signers[0].signer_id !== keys.signer.quorumId ||
    !wallet.additional_signers[0].override_policy_ids?.includes(created.policyId))
  throw new Error('Expected only the browser-granted proof signer and policy');
const remotePolicy = await privy.policies().get(created.policyId);
if (remotePolicy.owner_id !== keys.admin.quorumId ||
    remotePolicy.rules?.length !== policy.rules.length ||
    policy.rules.some((expected, index) => {
      const actual = remotePolicy.rules[index];
      return actual.name !== expected.name || actual.method !== expected.method ||
        actual.action !== expected.action ||
        actual.conditions?.length !== expected.conditions.length ||
        expected.conditions.some((item, itemIndex) => {
          const other = actual.conditions[itemIndex];
          return other.field_source !== item.field_source || other.field !== item.field ||
            other.operator !== item.operator || !isDeepStrictEqual(other.value, item.value) ||
            !isDeepStrictEqual(other.idl ?? null, item.idl ?? null);
        });
    }))
  throw new Error('Privy proof policy differs from the locally reviewed policy');

const rpc = new Connection(`https://solana-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`, 'confirmed');
const owner = new PublicKey(address);
if (await rpc.getBalance(owner) !== 0)
  throw new Error('Run this sign-only proof only while the disposable wallet is unfunded');
const quoteUrl = new URL('https://api.jup.ag/swap/v1/quote');
for (const [key, value] of Object.entries({ inputMint, outputMint, amount: maxInputRaw, slippageBps: '50' }))
  quoteUrl.searchParams.set(key, value);
async function jupiterRequest(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Jupiter HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`);
  return response.json();
}
const quote = await jupiterRequest(quoteUrl);
await new Promise((resolve) => setTimeout(resolve, 2_200));
const swap = await jupiterRequest('https://api.jup.ag/swap/v1/swap', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ quoteResponse: quote, userPublicKey: address, wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: false, useSharedAccounts: true }),
});
if (typeof swap.swapTransaction !== 'string') throw new Error('Jupiter returned no transaction');
const unsigned = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, 'base64'));
if (unsigned.message.staticAccountKeys[0]?.toBase58() !== address ||
    unsigned.message.header.numRequiredSignatures !== 1)
  throw new Error('Jupiter transaction has an unexpected payer or signer');
const tables = await Promise.all(unsigned.message.addressTableLookups.map(async ({ accountKey }) => {
  const { value } = await rpc.getAddressLookupTable(accountKey);
  if (!value) throw new Error('Jupiter lookup table is missing');
  return value;
}));
const instructions = TransactionMessage.decompile(unsigned.message, { addressLookupTableAccounts: tables }).instructions;
const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
const route = instructions.filter((item) => item.programId.toBase58() === JUPITER);
if (route.length !== 1 || !route[0].data.subarray(0, 8).equals(Buffer.from('c1209b3341d69c81', 'hex')))
  throw new Error('Jupiter did not return exactly one reviewed shared-account route');
const idl = policy.rules.flatMap((rule) => rule.conditions).find((item) => item.idl)?.idl;
if (!idl || idl.instructions?.[0]?.name !== 'shared_accounts_route')
  throw new Error('Policy IDL does not match the shared-account route');
for (const [name, expected] of Object.entries({ source_mint: inputMint, destination_mint: outputMint,
  source_token_account: sourceAta, destination_token_account: destinationAta })) {
  const index = idl.instructions[0].accounts.findIndex((account) => account.name === name);
  if (index < 0 || route[0].keys[index]?.pubkey.toBase58() !== expected)
    throw new Error(`Jupiter ${name} differs from the reviewed policy`);
}
const data = Buffer.from(route[0].data);
const amounts = Buffer.alloc(18);
amounts.writeBigUInt64LE(BigInt(quote.inAmount), 0);
amounts.writeBigUInt64LE(BigInt(quote.outAmount), 8);
amounts.writeUInt16LE(50, 16);
const amountOffset = data.indexOf(amounts);
if (amountOffset < 8 || data.indexOf(amounts, amountOffset + 1) !== -1 || amountOffset + 19 !== data.length ||
    data[amountOffset + 18] !== 0)
  throw new Error('Jupiter amount/slippage bytes could not be located unambiguously');
const allowedInstructions = instructions.filter((item) =>
  [JUPITER, COMPUTE_BUDGET].includes(item.programId.toBase58()));
if (allowedInstructions.length !== route.length + instructions.filter((item) =>
  item.programId.toBase58() === COMPUTE_BUDGET).length)
  throw new Error('Unexpected route selection');
const protectedAddresses = new Set([inputMint, outputMint, sourceAta, destinationAta]);
const placeholder = Keypair.generate().publicKey;
const filteredTables = tables.map((table) => new AddressLookupTableAccount({
  key: table.key,
  state: { ...table.state, addresses: table.state.addresses.map((item) =>
    protectedAddresses.has(item.toBase58()) ? placeholder : item) },
}));
function compile(routeInstruction, extraInstructions = []) {
  const message = new TransactionMessage({ payerKey: owner, recentBlockhash: unsigned.message.recentBlockhash,
    instructions: [...allowedInstructions.map((item) => item.programId.toBase58() === JUPITER ? routeInstruction : item),
      ...extraInstructions],
  }).compileToV0Message(filteredTables);
  const staticKeys = new Set(message.staticAccountKeys.map((item) => item.toBase58()));
  const protectedNames = ['source_mint', 'destination_mint',
    'source_token_account', 'destination_token_account'];
  if (!protectedNames.every((name) => {
    const index = idl.instructions[0].accounts.findIndex((account) => account.name === name);
    return staticKeys.has(routeInstruction.keys[index].pubkey.toBase58());
  }))
    throw new Error('Protected route accounts were not compiled as static keys');
  if (message.header.numRequiredSignatures !== 1) throw new Error('Proof transaction has an extra signer');
  const bytes = new VersionedTransaction(message).serialize();
  if (bytes.length > 1232) throw new Error('Proof transaction exceeds Solana packet size');
  return Buffer.from(bytes).toString('base64');
}
const auth = { authorization_private_keys: [keys.signer.privateKeyDerBase64] };
const attempts = [];
async function signOnly(name, transaction, expectAllow) {
  try {
    await privy.wallets().solana().signTransaction(linked[0].id, {
      transaction, authorization_context: auth, idempotency_key: randomUUID(),
    });
    attempts.push({ name, signed: true });
    if (!expectAllow) throw new Error(`${name} unexpectedly signed; policy proof failed`);
  } catch (error) {
    if (attempts.at(-1)?.name === name && attempts.at(-1).signed) throw error;
    const detail = String(error?.message ?? '').slice(0, 240);
    const policyDenial = /policy_violation/.test(detail);
    attempts.push({ name, signed: false, status: error?.status ?? null, policyDenial, detail });
    if (expectAllow || !policyDenial) throw new Error(`${name} is inconclusive: ${detail}`);
  }
}
const changedData = (edit) => {
  const next = Buffer.from(data);
  edit(next);
  return new TransactionInstruction({ programId: route[0].programId, keys: route[0].keys, data: next });
};
const changedAccount = (name) => {
  const index = idl.instructions[0].accounts.findIndex((account) => account.name === name);
  const newKeys = route[0].keys.map((key, keyIndex) => keyIndex === index
    ? { ...key, pubkey: Keypair.generate().publicKey } : key);
  return new TransactionInstruction({ programId: route[0].programId, keys: newKeys, data });
};
await signOnly('reviewed_jupiter_buy_without_account_setup', compile(route[0]), true);
await signOnly('input_over_cap', compile(changedData((next) =>
  next.writeBigUInt64LE(BigInt(maxInputRaw) + 1n, amountOffset))), false);
await signOnly('slippage_over_cap', compile(changedData((next) =>
  next.writeUInt16LE(maxSlippageBps + 1, amountOffset + 16))), false);
for (const name of ['source_mint', 'destination_mint', 'source_token_account', 'destination_token_account'])
  await signOnly(`wrong_${name}`, compile(changedAccount(name)), false);
await signOnly('reviewed_route_with_extra_sol_transfer', compile(route[0], [
  SystemProgram.transfer({ fromPubkey: owner, toPubkey: Keypair.generate().publicKey, lamports: 1 }),
]), false);
console.log(JSON.stringify({ wallet: address, policyId: created.policyId, unfunded: true,
  broadcast: false, routeInstructions: allowedInstructions.length,
  lookupTables: tables.length, transactionBytes: Buffer.from(compile(route[0]), 'base64').length,
  attempts }));
