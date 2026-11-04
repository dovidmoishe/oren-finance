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
  MintLayout,
  MINT_SIZE,
} from '@solana/spl-token';
import { inspectDelegatedJupiterTransaction } from './delegated-jupiter-guard';
import { staticJupiterAccounts } from '../signer-gate/static-jupiter-accounts';
import { inspectApiTradeTransaction } from './api-trade-transaction';
import { buildGateJupiterRoute } from '../signer-gate/gate-jupiter';
import type { mcpTradeIntents } from '../database/schema';

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

function apiFixture() {
  const intent = {
    id: 'fixture',
    side: 'buy',
    wallet: expected.wallet,
    assetId: 'stock',
    stockMint: STOCK.toBase58(),
    maxInRaw: '1000000',
    minOutRaw: '9950',
    amountUsd: '1.000000',
    amountShares: null,
    slippageBps: 50,
    mode: 'delegated',
    status: 'prepared',
    expiresAt: new Date(Date.now() + 300000),
  } as typeof mcpTradeIntents.$inferSelect;
  const mintData = Buffer.alloc(MINT_SIZE);
  MintLayout.encode(
    {
      mintAuthorityOption: 0,
      mintAuthority: PublicKey.default,
      supply: 100000000n,
      decimals: 6,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    mintData,
  );
  const inspect = jest.fn().mockResolvedValue('5000');
  const deps = {
    connection: {
      getAccountInfo: jest
        .fn()
        .mockResolvedValue({ owner: TOKEN_2022_PROGRAM_ID, data: mintData }),
      getAddressLookupTable: jest.fn().mockResolvedValue({ value: null }),
    },
    tokens: {
      getStock: jest
        .fn()
        .mockResolvedValue({
          id: 'stock',
          price: 25,
          variants: [{ mint: STOCK.toBase58(), tradable: true }],
        }),
    },
    rpc: { inspect },
  };
  const check = (tx = transaction([route()])) =>
    inspectApiTradeTransaction(tx, intent, deps as never);
  return { intent, deps, check };
}

describe('independent API transaction validation with real Solana serialization', () => {
  it('accepts a bounded route and charges the actual raw USDC', async () => {
    const f = apiFixture();
    await expect(f.check()).resolves.toBe('1.000000');
    expect(f.deps.rpc.inspect).toHaveBeenCalledWith(
      expect.any(String),
      expected.wallet,
      {
        inputMint: expected.inputMint,
        outputMint: expected.outputMint,
        maxInRaw: '1000000',
        minOutRaw: '9950',
      },
    );
  });
  it('rejects the original understated-dollar exploit in both signing components', async () => {
    const f = apiFixture();
    f.intent.amountUsd = '0.010000';
    await expect(f.check()).rejects.toThrow('raw USDC');
    await expect(buildGateJupiterRoute(f.intent, {} as never)).rejects.toThrow(
      'raw USDC',
    );
    expect(f.deps.rpc.inspect).not.toHaveBeenCalled();
  });
  it('rejects wrong destination, oversized input, a second route and bundled transfer', async () => {
    const f = apiFixture();
    for (const instructions of [
      [route(1000000n, { 6: random() })],
      [route(1000001n)],
      [route(), route()],
      [
        route(),
        SystemProgram.transfer({
          fromPubkey: wallet,
          toPubkey: random(),
          lamports: 1,
        }),
      ],
    ])
      await expect(f.check(transaction(instructions))).rejects.toThrow();
    expect(f.deps.rpc.inspect).not.toHaveBeenCalled();
  });
  it('checks the encoded output floor independently of gate quote metadata', async () => {
    const f = apiFixture();
    const altered = route();
    altered.data.writeBigUInt64LE(9999n, 21);
    await expect(f.check(transaction([altered]))).rejects.toThrow(
      'reviewed minimum',
    );
    f.deps.rpc.inspect.mockRejectedValueOnce(new Error('simulation failed'));
    await expect(f.check()).rejects.toThrow('simulation failed');
  });
  it('derives sell reference value from mint decimals and rejects understated shares', async () => {
    const f = apiFixture();
    f.intent.side = 'sell';
    f.intent.amountUsd = null;
    f.intent.amountShares = '1.000000000000';
    const stockSource = getAssociatedTokenAddressSync(
      STOCK,
      wallet,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    const usdcDestination = getAssociatedTokenAddressSync(USDC, wallet);
    const tx = transaction([
      route(1000000n, {
        3: stockSource,
        6: usdcDestination,
        7: STOCK,
        8: USDC,
      }),
    ]);
    await expect(f.check(tx)).resolves.toBe('25.000000');
    f.intent.amountShares = '0.010000000000';
    await expect(f.check(tx)).rejects.toThrow('differs from raw');
  });
});

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
