// Offline fixtures only: no transaction is signed, submitted or sent to an RPC.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
  ComputeBudgetProgram,
} from '@solana/web3.js';
const require = createRequire(import.meta.url);
const {
  verifyInstructions,
  parseManifest,
  CreationTransactionService,
} = require('../dist/src/predictions/creation/creation-transaction.service.js');
const wallet = Keypair.generate().publicKey,
  program = Keypair.generate().publicKey,
  mint = Keypair.generate().publicKey,
  fees = [Keypair.generate().publicKey, Keypair.generate().publicKey];
const payload = {
  wallet: wallet.toBase58(),
  question: 'Will GDP exceed 2 percent?',
  resolutionRule: 'First official release above 2 percent YES, otherwise NO.',
  sourcesOfTruth: ['https://www.bea.gov/gdp'],
  startTime: 1900000000,
  endTime: 1900086400,
  resolutionTime: 1900172800,
  marketType: 'standard',
};
const event = PublicKey.findProgramAddressSync(
  [
    Buffer.from('event'),
    wallet.toBuffer(),
    createHash('sha256').update(payload.question).digest(),
  ],
  program,
)[0];
const quote = {
  createId: 'offline-quote',
  expectedEventPda: event.toBase58(),
  paymentUsdc: '25000000',
  liquidityInjectionUsdc: '20000000',
  platformRevenueUsdc: '5000000',
  expiresAt: new Date(Date.now() + 60000).toISOString(),
};
const fields = [
  { name: 'question', type: 'string' },
  { name: 'resolutionRule', type: 'string' },
  { name: 'sourcesOfTruth', type: 'strings' },
  ...[
    'startTime',
    'endTime',
    'resolutionTime',
    'paymentUsdc',
    'liquidityInjectionUsdc',
    'platformRevenueUsdc',
  ].map((name) => ({ name, type: 'u64' })),
];
const manifest = {
  genesisHash: 'verified-fixture',
  programId: program.toBase58(),
  programDataAddress: Keypair.generate().publicKey.toBase58(),
  programDataHash: 'a'.repeat(64),
  usdcMint: mint.toBase58(),
  minimumStartDelay: 3600,
  feeDestinations: fees.map((k) => k.toBase58()),
  fundingMode: 'cpi',
  eventSeeds: [
    { kind: 'literal', value: 'event' },
    { kind: 'wallet' },
    { kind: 'questionHash' },
  ],
  discriminatorHex: '0102030405060708',
  fields,
  accounts: [
    { address: '$wallet', signer: true, writable: true },
    { address: '$event', signer: false, writable: true },
    { address: '$usdcMint', signer: false, writable: false },
    ...fees.map((k) => ({
      address: k.toBase58(),
      signer: false,
      writable: true,
    })),
  ],
  missingDataPolicies: ['fixture cancellation'],
  resolutionContract: 'fixture official observation',
  disputeContract: 'fixture dispute process',
  eligibilityContract: 'fixture eligibility',
  auditReference: 'offline fixture, never a deployment manifest',
};
function encode(value, type) {
  if (type === 'u64') {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(value));
    return b;
  }
  if (type === 'strings') {
    const length = Buffer.alloc(4);
    length.writeUInt32LE(value.length);
    return Buffer.concat([length, ...value.map((v) => encode(v, 'string'))]);
  }
  const b = Buffer.from(value),
    length = Buffer.alloc(4);
  length.writeUInt32LE(b.length);
  return Buffer.concat([length, b]);
}
const data = Buffer.concat([
  Buffer.from(manifest.discriminatorHex, 'hex'),
  ...fields.map((f) => encode(quote[f.name] ?? payload[f.name], f.type)),
]);
const creation = new TransactionInstruction({
  programId: program,
  keys: [
    { pubkey: wallet, isSigner: true, isWritable: true },
    { pubkey: event, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    ...fees.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
  ],
  data,
});
const table = new AddressLookupTableAccount({
  key: Keypair.generate().publicKey,
  state: {
    deactivationSlot: 18446744073709551615n,
    lastExtendedSlot: 0,
    lastExtendedSlotStartIndex: 0,
    authority: undefined,
    addresses: [event, mint, ...fees],
  },
});
function txFor(instructions, tables = []) {
  return new VersionedTransaction(
    new TransactionMessage({
      payerKey: wallet,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions,
    }).compileToV0Message(tables),
  );
}
function check(tx, m = manifest, p = payload, q = quote, tables = []) {
  verifyInstructions(
    tx,
    TransactionMessage.decompile(tx.message, {
      addressLookupTableAccounts: tables,
    }),
    m,
    p,
    q,
  );
}
assert.ok(parseManifest(JSON.stringify(manifest)));
check(txFor([creation]));
check(
  txFor([
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }),
    creation,
  ]),
);
const withTable = txFor([creation], [table]);
assert.equal(withTable.message.addressTableLookups.length, 1);
check(withTable, manifest, payload, quote, [table]);
assert.throws(() => check(withTable));
assert.throws(() =>
  check(
    txFor([
      creation,
      SystemProgram.transfer({
        fromPubkey: wallet,
        toPubkey: fees[0],
        lamports: 1,
      }),
    ]),
  ),
);
assert.throws(() =>
  check(txFor([creation]), manifest, payload, {
    ...quote,
    paymentUsdc: '25000001',
  }),
);
assert.throws(() =>
  check(txFor([creation]), manifest, {
    ...payload,
    question: 'Different event',
  }),
);
assert.throws(() =>
  check(
    txFor([
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000001 }),
      creation,
    ]),
  ),
);
assert.throws(() => check(txFor([creation, creation])));
const badSigner = new TransactionInstruction({
  ...creation,
  keys: [
    ...creation.keys,
    { pubkey: Keypair.generate().publicKey, isSigner: true, isWritable: false },
  ],
});
assert.throws(() => check(txFor([badSigner])));
const service = new CreationTransactionService({
  PANTA_CREATION_ENABLED: true,
  PANTA_CREATION_RPC_URL: 'https://offline.example',
  PANTA_CREATION_MANIFEST_JSON: JSON.stringify(manifest),
});
const valid = txFor([creation]),
  build = {
    ...quote,
    transaction: Buffer.from(valid.serialize()).toString('base64'),
    recentBlockhash: valid.message.recentBlockhash,
    lastValidBlockHeight: 100,
    buildFingerprint: 'fixture',
    derived: { event: event.toBase58() },
  };
service.network = async () => ({
  manifest,
  connection: {
    getBlockHeight: async () => 1,
    simulateTransaction: async () => ({ value: { err: null } }),
    getFeeForMessage: async () => ({ value: 5000 }),
    getAddressLookupTable: async () => ({ value: table }),
  },
});
assert.equal(
  (await service.verify(build, payload, quote)).networkFeeLamports,
  '5000',
);
await assert.rejects(() =>
  service.verify({ ...build, platformRevenueUsdc: '1' }, payload, quote),
);
service.network = async () => ({
  manifest,
  connection: { getBlockHeight: async () => 101 },
});
await assert.rejects(() => service.verify(build, payload, quote), {
  code: 'PANTA_CREATE_EXPIRED',
});
console.log(
  'Passed 12 offline transaction checks: real versioned messages, lookup tables, signer/payment/event/program/priority-fee rejection, simulation and expiry.',
);
