import { config } from 'dotenv';
import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const stockMint = process.env.PROOF_STOCK_MINT;
const side = process.env.PROOF_SIDE;
const shared = process.env.PROOF_SHARED === 'true';
const recompileStaticMints = process.env.PROOF_RECOMPILE_STATIC_MINTS === 'true';
const rawAmount = process.env.PROOF_INPUT_RAW;
if (
  !stockMint ||
  !['buy', 'sell'].includes(side) ||
  !['true', 'false'].includes(process.env.PROOF_SHARED) ||
  !/^[1-9]\d*$/.test(rawAmount ?? '')
)
  throw new Error(
    'Set PROOF_STOCK_MINT, PROOF_SIDE=buy|sell, PROOF_SHARED=true|false and positive PROOF_INPUT_RAW',
  );
if (!process.env.ALCHEMY_API_KEY)
  throw new Error('ALCHEMY_API_KEY is required to resolve lookup tables');
new PublicKey(stockMint);

const wallet = Keypair.generate().publicKey.toBase58();
const inputMint = side === 'buy' ? USDC : stockMint;
const outputMint = side === 'buy' ? stockMint : USDC;
const baseUrl = 'https://api.jup.ag/swap/v1';
const quoteUrl = new URL(`${baseUrl}/quote`);
for (const [key, value] of Object.entries({
  inputMint,
  outputMint,
  amount: rawAmount,
  slippageBps: '50',
}))
  quoteUrl.searchParams.set(key, value);

async function request(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200);
    throw new Error(`Jupiter HTTP ${response.status}: ${detail}`);
  }
  return response.json();
}

const quote = await request(quoteUrl);
// The keyless endpoint is limited to 0.5 requests per second.
await new Promise((resolve) => setTimeout(resolve, 2_200));
const swap = await request(`${baseUrl}/swap`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    quoteResponse: quote,
    userPublicKey: wallet,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: false,
    useSharedAccounts: shared,
  }),
});
if (typeof swap.swapTransaction !== 'string')
  throw new Error('Jupiter returned no transaction');
const transaction = VersionedTransaction.deserialize(
  Buffer.from(swap.swapTransaction, 'base64'),
);
const rpc = new Connection(
  `https://solana-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  'confirmed',
);
const lookupTables = await Promise.all(
  transaction.message.addressTableLookups.map(async (lookup) => {
    const { value } = await rpc.getAddressLookupTable(lookup.accountKey);
    if (!value) throw new Error('Lookup table is missing');
    return value;
  }),
);
const instructions = TransactionMessage.decompile(transaction.message, {
  addressLookupTableAccounts: lookupTables,
}).instructions;
const staticKeys = new Set(
  transaction.message.staticAccountKeys.map((key) => key.toBase58()),
);
let recompiled;
if (recompileStaticMints) {
  const protectedMints = new Set([inputMint, outputMint]);
  const unusedAddress = Keypair.generate().publicKey;
  const filteredTables = lookupTables.map(
    (table) =>
      new AddressLookupTableAccount({
        key: table.key,
        state: {
          ...table.state,
          // Keep every index unchanged. The placeholder is never referenced by
          // the instructions, so compiling leaves protected mints static.
          addresses: table.state.addresses.map((address) =>
            protectedMints.has(address.toBase58()) ? unusedAddress : address,
          ),
        },
      }),
  );
  const rebuiltMessage = new TransactionMessage({
    payerKey: transaction.message.staticAccountKeys[0],
    recentBlockhash: transaction.message.recentBlockhash,
    instructions,
  }).compileToV0Message(filteredTables);
  const rebuilt = new VersionedTransaction(rebuiltMessage);
  const rebuiltInstructions = TransactionMessage.decompile(rebuiltMessage, {
    addressLookupTableAccounts: lookupTables,
  }).instructions;
  const sameInstructions =
    JSON.stringify(
      rebuiltInstructions.map((instruction) => ({
        programId: instruction.programId.toBase58(),
        data: instruction.data.toString('hex'),
        keys: instruction.keys.map((key) => ({
          address: key.pubkey.toBase58(),
          isSigner: key.isSigner,
          isWritable: key.isWritable,
        })),
      })),
    ) ===
    JSON.stringify(
      instructions.map((instruction) => ({
        programId: instruction.programId.toBase58(),
        data: instruction.data.toString('hex'),
        keys: instruction.keys.map((key) => ({
          address: key.pubkey.toBase58(),
          isSigner: key.isSigner,
          isWritable: key.isWritable,
        })),
      })),
    );
  const rebuiltStatic = new Set(
    rebuiltMessage.staticAccountKeys.map((key) => key.toBase58()),
  );
  recompiled = {
    byteLength: rebuilt.serialize().length,
    fitsPacket: rebuilt.serialize().length <= 1232,
    sameInstructions,
    inputMintStatic: rebuiltStatic.has(inputMint),
    outputMintStatic: rebuiltStatic.has(outputMint),
    lookupTableCount: rebuiltMessage.addressTableLookups.length,
  };
}
console.log(
  JSON.stringify({
    side,
    shared,
    inputMint,
    outputMint,
    inputRaw: quote.inAmount,
    quotedOutputRaw: quote.outAmount,
    inputMintStatic: staticKeys.has(inputMint),
    outputMintStatic: staticKeys.has(outputMint),
    ...(recompiled ? { recompiled } : {}),
    routeLabels: quote.routePlan?.map((leg) => leg.swapInfo?.label),
    syntheticWallet: wallet,
    requiredSignatures: transaction.message.header.numRequiredSignatures,
    lookupTableCount: lookupTables.length,
    instructions: instructions.map((instruction) => ({
      programId: instruction.programId.toBase58(),
      discriminator: instruction.data.subarray(0, 8).toString('hex'),
      accountCount: instruction.keys.length,
      ...(instruction.programId.toBase58() === JUPITER
        ? {
            lookupLoadedAccountCount: instruction.keys.filter(
              (key) => !staticKeys.has(key.pubkey.toBase58()),
            ).length,
            firstRouteAccounts: instruction.keys.slice(0, 16).map((key, index) => ({
              index,
              address: key.pubkey.toBase58(),
              static: staticKeys.has(key.pubkey.toBase58()),
            })),
          }
        : {}),
    })),
  }),
);
