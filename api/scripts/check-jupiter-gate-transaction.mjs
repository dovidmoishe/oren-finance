import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AddressLookupTableAccount, Connection, Keypair, PublicKey,
  TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import { inspectDelegatedJupiterTransaction } from '../dist/src/mcp-auth/delegated-jupiter-guard.js';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
if (process.env.PROOF_CHECK_JUPITER_GATE !== 'true')
  throw new Error('Set PROOF_CHECK_JUPITER_GATE=true for this unsigned route check');
const address = process.env.PROOF_WALLET_ADDRESS;
if (!address || !process.env.ALCHEMY_API_KEY)
  throw new Error('Proof wallet and Solana RPC are required');
const policy = JSON.parse(readFileSync(fileURLToPath(new URL('../.proof/jupiter-buy.policy.json', import.meta.url)), 'utf8'));
const routeRule = policy.rules.find((rule) => rule.name === 'allow bounded jupiter buy');
const condition = (field) => routeRule?.conditions.find((item) =>
  item.field === `shared_accounts_route.${field}`)?.value;
const inputMint = condition('accounts.source_mint');
const outputMint = condition('accounts.destination_mint');
const sourceAta = condition('accounts.source_token_account');
const destinationAta = condition('accounts.destination_token_account');
const rawInput = condition('args.in_amount');
if (!inputMint || !outputMint || !sourceAta || !destinationAta || rawInput !== '1000000')
  throw new Error('Reviewed proof policy fields changed');
const rpc = new Connection(`https://solana-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`, 'confirmed');
if (await rpc.getBalance(new PublicKey(address)) !== 0)
  throw new Error('Unfunded proof wallet is no longer unfunded');

async function jupiter(url, init = {}) {
  const response = await fetch(url, { ...init, headers: {
    ...(process.env.JUPITER_API_KEY ? { 'x-api-key': process.env.JUPITER_API_KEY } : {}),
    ...(init.headers ?? {}),
  }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Jupiter HTTP ${response.status}`);
  return response.json();
}
const url = new URL('https://api.jup.ag/swap/v1/quote');
for (const [field, value] of Object.entries({ inputMint, outputMint, amount: rawInput, slippageBps: '50' }))
  url.searchParams.set(field, value);
const quote = await jupiter(url);
const swap = await jupiter('https://api.jup.ag/swap/v1/swap', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ quoteResponse: quote, userPublicKey: address,
    wrapAndUnwrapSol: false, dynamicComputeUnitLimit: false, useSharedAccounts: true }),
});
if (!swap.swapTransaction || quote.inAmount !== rawInput)
  throw new Error('Fresh Jupiter route differs from requested input');
const original = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, 'base64'));
const tables = await Promise.all(original.message.addressTableLookups.map(async ({ accountKey }) => {
  const { value } = await rpc.getAddressLookupTable(accountKey);
  if (!value) throw new Error('Jupiter lookup table is unavailable');
  return value;
}));
const instructions = TransactionMessage.decompile(original.message,
  { addressLookupTableAccounts: tables }).instructions;
const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const COMPUTE = 'ComputeBudget111111111111111111111111111111';
const chosen = instructions.filter((item) => [JUPITER, COMPUTE].includes(item.programId.toBase58()));
const setup = instructions.filter((item) => ![JUPITER, COMPUTE].includes(item.programId.toBase58()));
if (setup.some((item) => item.programId.toBase58() !== 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'))
  throw new Error('Jupiter supplied unexpected non-route instructions');
const protectedKeys = new Set([inputMint, outputMint, sourceAta, destinationAta]);
const placeholder = Keypair.generate().publicKey;
const safeTables = tables.map((table) => new AddressLookupTableAccount({ key: table.key,
  state: { ...table.state, addresses: table.state.addresses.map((item) =>
    protectedKeys.has(item.toBase58()) ? placeholder : item) } }));
const message = new TransactionMessage({ payerKey: new PublicKey(address),
  recentBlockhash: original.message.recentBlockhash, instructions: chosen }).compileToV0Message(safeTables);
const transaction = Buffer.from(new VersionedTransaction(message).serialize()).toString('base64');
const resolve = async (key) => tables.find((table) => table.key.equals(key)) ?? null;
const expected = { wallet: address, inputMint, outputMint, sourceAta, destinationAta,
  rawInput, maxInputRaw: rawInput, quotedOutputRaw: quote.outAmount, maxSlippageBps: 50 };
const single = await inspectDelegatedJupiterTransaction(transaction, expected, resolve);
const route = chosen.find((item) => item.programId.toBase58() === JUPITER);
if (!route) throw new Error('Jupiter route missing');
const doubled = new TransactionMessage({ payerKey: new PublicKey(address),
  recentBlockhash: original.message.recentBlockhash, instructions: [...chosen, route] })
  .compileToV0Message(safeTables);
let doubleRejected = false;
try {
  await inspectDelegatedJupiterTransaction(
    Buffer.from(new VersionedTransaction(doubled).serialize()).toString('base64'), expected, resolve);
} catch (error) {
  doubleRejected = /exactly one Jupiter route/.test(String(error));
}
if (!doubleRejected) throw new Error('Gate failed to reject two routes');
console.log(JSON.stringify({ unfunded: true, signed: false, broadcast: false,
  singleRouteAccepted: true, twoRoutesRejected: true,
  omittedAtaSetup: setup.length,
  lookupTables: single.lookupTableCount, transactionBytes: Buffer.from(transaction, 'base64').length }));
