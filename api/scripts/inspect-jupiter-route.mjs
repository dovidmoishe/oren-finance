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
import { inflateSync } from 'node:zlib';

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
const [jupiterBase] = PublicKey.findProgramAddressSync([], new PublicKey(JUPITER));
const idlAddress = await PublicKey.createWithSeed(
  jupiterBase,
  'anchor:idl',
  new PublicKey(JUPITER),
);
const idlAccount = await rpc.getAccountInfo(idlAddress);
if (!idlAccount || idlAccount.data.length < 44)
  throw new Error('Jupiter on-chain IDL is missing');
const idlLength = idlAccount.data.readUInt32LE(40);
const idlCompressed = idlAccount.data.subarray(44, 44 + idlLength);
if (idlCompressed.length !== idlLength)
  throw new Error('Jupiter on-chain IDL length is invalid');
const idl = JSON.parse(inflateSync(idlCompressed).toString('utf8'));
const idlTypes = new Map(idl.types.map((type) => [type.name, type.type]));

function decodeType(type, state) {
  const take = (size) => {
    if (state.offset + size > state.data.length)
      throw new Error('Jupiter instruction data ended during IDL decode');
    const offset = state.offset;
    state.offset += size;
    return offset;
  };
  if (typeof type === 'string') {
    switch (type) {
      case 'u8': return state.data.readUInt8(take(1));
      case 'u16': return state.data.readUInt16LE(take(2));
      case 'u32': return state.data.readUInt32LE(take(4));
      case 'u64': return state.data.readBigUInt64LE(take(8)).toString();
      case 'u128': {
        const offset = take(16);
        const low = state.data.readBigUInt64LE(offset);
        const high = state.data.readBigUInt64LE(offset + 8);
        return (low + (high << 64n)).toString();
      }
      case 'bool': return state.data.readUInt8(take(1)) !== 0;
      case 'pubkey': return new PublicKey(state.data.subarray(take(32), state.offset)).toBase58();
      case 'bytes': {
        const length = decodeType('u32', state);
        take(length);
        return `[${length} bytes]`;
      }
      default: throw new Error(`Unsupported IDL primitive: ${type}`);
    }
  }
  if (type.defined) {
    const name = typeof type.defined === 'string' ? type.defined : type.defined.name;
    const definition = idlTypes.get(name);
    if (!definition) throw new Error(`Missing Jupiter IDL type ${name}`);
    if (definition.kind === 'struct') {
      const value = {};
      for (const field of definition.fields)
        value[field.name] = decodeType(field.type, state);
      return value;
    }
    if (definition.kind === 'enum') {
      const index = decodeType('u8', state);
      const variant = definition.variants[index];
      if (!variant) throw new Error(`Invalid ${name} variant ${index}`);
      for (const field of variant.fields ?? [])
        decodeType(field.type ?? field, state);
      return variant.name;
    }
    throw new Error(`Unsupported IDL definition kind: ${definition.kind}`);
  }
  if (type.vec) {
    const count = decodeType('u32', state);
    if (count > 128) throw new Error('Unexpectedly long Jupiter route plan');
    return Array.from({ length: count }, () => decodeType(type.vec, state));
  }
  if (type.option) {
    const present = decodeType('u8', state);
    return present ? decodeType(type.option, state) : null;
  }
  if (type.array) {
    const [element, count] = type.array;
    return Array.from({ length: count }, () => decodeType(element, state));
  }
  throw new Error('Unsupported Jupiter IDL type');
}

const jupiterInstruction = instructions.find(
  (instruction) => instruction.programId.toBase58() === JUPITER,
);
if (!jupiterInstruction) throw new Error('Jupiter route instruction is missing');
const jupiterData = Buffer.from(jupiterInstruction.data);
const idlInstruction = idl.instructions.find((instruction) =>
  Buffer.from(instruction.discriminator).equals(jupiterData.subarray(0, 8)),
);
if (!idlInstruction) throw new Error('Jupiter route discriminator is absent from on-chain IDL');
const decodeState = { data: jupiterData, offset: 8 };
const decoded = Object.fromEntries(
  idlInstruction.args.map((arg) => [arg.name, decodeType(arg.type, decodeState)]),
);
const idlDecode = {
  instruction: idlInstruction.name,
  inAmount: decoded.in_amount,
  quotedOutAmount: decoded.quoted_out_amount,
  slippageBps: decoded.slippage_bps,
  routePlanLength: decoded.route_plan?.length,
  consumedAllData: decodeState.offset === jupiterData.length,
  inputMatchesQuote: decoded.in_amount === quote.inAmount,
  outputMatchesQuote: decoded.quoted_out_amount === quote.outAmount,
};
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
    idlDecode,
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
