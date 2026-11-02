import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { inspectDelegatedJupiterTransaction } from './delegated-jupiter-guard';
import { staticJupiterAccounts } from '../signer-gate/static-jupiter-accounts';

const JUPITER = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const STOCK = new PublicKey('TSLAqBbv4CNCnzWFeB7LmydAyEiNMJtve7DYKLpdK4S');
const wallet = Keypair.generate().publicKey;
const sourceAta = getAssociatedTokenAddressSync(USDC, wallet);
const destinationAta = getAssociatedTokenAddressSync(
  STOCK,
  wallet,
  false,
  TOKEN_2022_PROGRAM_ID,
);
const random = () => Keypair.generate().publicKey;
const expected = {
  wallet: wallet.toBase58(),
  inputMint: USDC.toBase58(),
  outputMint: STOCK.toBase58(),
  sourceAta: sourceAta.toBase58(),
  destinationAta: destinationAta.toBase58(),
  rawInput: '1000000',
  quotedOutputRaw: '10000',
  maxInputRaw: '1000000',
  maxSlippageBps: 50,
};

function route(amount = 1_000_000n, overrides: Record<number, PublicKey> = {}) {
  const data = Buffer.alloc(8 + 1 + 4 + 8 + 8 + 2 + 1);
  Buffer.from('c1209b3341d69c81', 'hex').copy(data);
  data[8] = 0;
  data.writeUInt32LE(0, 9);
  data.writeBigUInt64LE(amount, 13);
  data.writeBigUInt64LE(10_000n, 21);
  data.writeUInt16LE(50, 29);
  const addresses = [
    TOKEN_PROGRAM_ID,
    random(),
    wallet,
    sourceAta,
    random(),
    random(),
    destinationAta,
    USDC,
    STOCK,
    random(),
    TOKEN_2022_PROGRAM_ID,
    random(),
    JUPITER,
  ];
  return new TransactionInstruction({
    programId: JUPITER,
    data,
    keys: addresses.map((pubkey, index) => ({
      pubkey: overrides[index] ?? pubkey,
      isSigner: index === 2,
      isWritable: index === 3 || index === 6,
    })),
  });
}

function transaction(
  instructions: TransactionInstruction[],
  tables: AddressLookupTableAccount[] = [],
) {
  const message = new TransactionMessage({
    payerKey: wallet,
    recentBlockhash: random().toBase58(),
    instructions,
  }).compileToV0Message(tables);
  return Buffer.from(new VersionedTransaction(message).serialize()).toString(
    'base64',
  );
}

const noTable = () => Promise.resolve(null);

describe('delegated Jupiter transaction guard', () => {
  it('accepts one bounded route with protected static accounts', async () => {
    await expect(
      inspectDelegatedJupiterTransaction(
        transaction([route()]),
        expected,
        noTable,
      ),
    ).resolves.toMatchObject({ rawInput: '1000000', lookupTableCount: 0 });
  });

  it('rejects two individually valid routes before any signing', async () => {
    await expect(
      inspectDelegatedJupiterTransaction(
        transaction([route(), route()]),
        expected,
        noTable,
      ),
    ).rejects.toThrow('exactly one Jupiter route');
  });

  it('rejects an added transfer and over-cap input', async () => {
    await expect(
      inspectDelegatedJupiterTransaction(
        transaction([
          route(),
          SystemProgram.transfer({
            fromPubkey: wallet,
            toPubkey: random(),
            lamports: 1,
          }),
        ]),
        expected,
        noTable,
      ),
    ).rejects.toThrow('unapproved top-level instruction');
    await expect(
      inspectDelegatedJupiterTransaction(
        transaction([route(1_000_001n)]),
        expected,
        noTable,
      ),
    ).rejects.toThrow('route amounts');
  });

  it('rejects changed protected accounts and ALT-loaded mints', async () => {
    await expect(
      inspectDelegatedJupiterTransaction(
        transaction([route(1_000_000n, { 6: random() })]),
        expected,
        noTable,
      ),
    ).rejects.toThrow('wrong destination_token_account');
    const table = new AddressLookupTableAccount({
      key: random(),
      state: {
        deactivationSlot: BigInt('18446744073709551615'),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        authority: undefined,
        addresses: [USDC, STOCK],
      },
    });
    await expect(
      inspectDelegatedJupiterTransaction(
        transaction([route()], [table]),
        expected,
        () => Promise.resolve(table),
      ),
    ).rejects.toThrow('protected account loaded through lookup table');
  });

  it('moves protected ALT accounts to static keys without changing the route', async () => {
    const instruction = route();
    const table = new AddressLookupTableAccount({
      key: random(),
      state: {
        deactivationSlot: BigInt('18446744073709551615'),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        authority: undefined,
        addresses: [
          USDC,
          STOCK,
          sourceAta,
          destinationAta,
          instruction.keys[1].pubkey,
        ],
      },
    });
    const original = transaction([instruction], [table]);
    const rewritten = await staticJupiterAccounts(
      original,
      new Set([
        expected.wallet,
        expected.inputMint,
        expected.outputMint,
        expected.sourceAta,
        expected.destinationAta,
      ]),
      () => Promise.resolve(table),
    );
    expect(rewritten).not.toBe(original);
    await expect(
      inspectDelegatedJupiterTransaction(rewritten, expected, () =>
        Promise.resolve(table),
      ),
    ).resolves.toMatchObject({ rawInput: '1000000', lookupTableCount: 1 });
    const repeatedRoute = await staticJupiterAccounts(
      transaction([route(), route()], [table]),
      new Set([
        expected.wallet,
        expected.inputMint,
        expected.outputMint,
        expected.sourceAta,
        expected.destinationAta,
      ]),
      () => Promise.resolve(table),
    );
    await expect(
      inspectDelegatedJupiterTransaction(repeatedRoute, expected, () =>
        Promise.resolve(table),
      ),
    ).rejects.toThrow('exactly one Jupiter route');
  });

  it('rejects priority fees above the delegated allowance', async () => {
    await expect(
      inspectDelegatedJupiterTransaction(
        transaction([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: 1_000_000,
          }),
          route(),
        ]),
        expected,
        noTable,
      ),
    ).rejects.toThrow('priority fee over cap');
  });

  it('rejects trailing data that could hide different decoded amounts', async () => {
    const altered = route();
    altered.data = Buffer.concat([altered.data, Buffer.from([0])]);
    await expect(
      inspectDelegatedJupiterTransaction(
        transaction([altered]),
        expected,
        noTable,
      ),
    ).rejects.toThrow('trailing route data');
  });
});
