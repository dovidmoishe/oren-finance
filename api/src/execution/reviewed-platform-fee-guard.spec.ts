jest.mock(
  'rpc-websockets',
  () => ({ CommonClient: class {}, WebSocket: class {} }),
  { virtual: true },
);
jest.mock('@solana/web3.js', () =>
  jest.requireActual<Record<string, unknown>>(
    '@solana/web3.js/lib/index.cjs.js',
  ),
);
jest.mock('@solana/spl-token', () =>
  jest.requireActual<Record<string, unknown>>(
    '../../node_modules/@solana/spl-token/lib/cjs/index.js',
  ),
);

import { createHash } from 'node:crypto';
import captured from '../../test/fixtures/jupiter-v2-platform-fee-tslax.json';
import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { platformFeeConfig } from '../config/platform-fee-config';
import { STOCK, USDC, WALLET, ALT_USED } from '../test/titan.fixtures';
import type { Quote } from '../../types/quote';
import { ReviewedPlatformFeeGuard } from './reviewed-platform-fee-guard';
import {
  checkSimulatedBalances,
  type SimulatedAccount,
} from './swap-balance-guard';

const feeAccount = USDC; // Synthetic recipient in unsigned offline fixtures only.
const quote = {
  platformFee: { bps: 50, amountRaw: '50000', mint: USDC },
  platformFeeAccount: feeAccount,
} as Quote;
function tx(
  shared: boolean,
  bps = 50,
  account = feeAccount,
  lookup = false,
  plan = false,
  trailing = false,
) {
  const data = Buffer.alloc(
    (shared ? 32 : 31) + (plan ? 4 : 0) + (trailing ? 1 : 0),
  );
  Buffer.from(shared ? 'c1209b3341d69c81' : 'e517cb977ae3ad2a', 'hex').copy(
    data,
  );
  if (plan) {
    const offset = shared ? 9 : 8;
    data.writeUInt32LE(1, offset);
    Buffer.from([0, 100, 0, 1]).copy(data, offset + 4); // Saber, 100%, input 0 -> output 1.
  }
  data[data.length - (trailing ? 2 : 1)] = bps;
  if (trailing) data[data.length - 1] = 50;
  const keys = Array.from({ length: shared ? 13 : 9 }, () => ({
    pubkey: new PublicKey(STOCK),
    isSigner: false,
    isWritable: false,
  }));
  keys[shared ? 9 : 6] = {
    pubkey: new PublicKey(account),
    isSigner: false,
    isWritable: true,
  };
  const table = new AddressLookupTableAccount({
    key: new PublicKey(ALT_USED),
    state: {
      deactivationSlot: 18446744073709551615n,
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      addresses: [new PublicKey(account)],
    },
  });
  const message = new TransactionMessage({
    payerKey: new PublicKey(WALLET),
    recentBlockhash: STOCK,
    instructions: [
      new TransactionInstruction({
        programId: new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'),
        keys,
        data,
      }),
    ],
  }).compileToV0Message(lookup ? [table] : []);
  return Buffer.from(new VersionedTransaction(message).serialize()).toString(
    'base64',
  );
}
describe('reviewed platform fee transaction checks', () => {
  const rpc = { call: jest.fn() };
  const guard = new ReviewedPlatformFeeGuard(rpc as never);
  it('uses the real classic USDC ATA derivation for owner configuration', () => {
    const account = getAssociatedTokenAddressSync(
      new PublicKey(USDC),
      new PublicKey(WALLET),
      false,
      TOKEN_PROGRAM_ID,
    ).toBase58();
    expect(
      platformFeeConfig({
        PLATFORM_FEE_BPS: '50',
        PLATFORM_FEE_OWNER: WALLET,
        PLATFORM_FEE_USDC_ACCOUNT: account,
      }),
    ).toEqual({ bps: 50, account });
  });
  it.each([false, true])(
    'accepts only the reviewed Jupiter fee rate and destination (shared=%s)',
    async (shared) => {
      await expect(guard.inspect(tx(shared), quote)).resolves.toBeUndefined();
      await expect(guard.inspect(tx(shared, 0), quote)).rejects.toThrow(
        'platform fee',
      );
      await expect(guard.inspect(tx(shared, 51), quote)).rejects.toThrow(
        'platform fee',
      );
      await expect(guard.inspect(tx(shared, 50, STOCK), quote)).rejects.toThrow(
        'platform fee',
      );
    },
  );
  it('resolves lookup-table fee accounts independently', async () => {
    const data = Buffer.alloc(88);
    data.writeUInt32LE(1, 0);
    data.writeBigUInt64LE(18446744073709551615n, 4);
    new PublicKey(feeAccount).toBuffer().copy(data, 56);
    rpc.call.mockResolvedValue({
      value: { data: [data.toString('base64'), 'base64'] },
    });
    await expect(
      guard.inspect(tx(true, 50, feeAccount, true), quote),
    ).resolves.toBeUndefined();
    expect(rpc.call).toHaveBeenCalledWith(
      'getAccountInfo',
      expect.arrayContaining([ALT_USED]),
    );
  });
  it('does no decoding or RPC for zero/absent fees', async () => {
    rpc.call.mockClear();
    await expect(
      guard.inspect('unchanged-delegated-bytes', {} as Quote),
    ).resolves.toBeUndefined();
    expect(rpc.call).not.toHaveBeenCalled();
  });
  const token = (value: bigint): SimulatedAccount => {
    const data = Buffer.alloc(165);
    data.writeBigUInt64LE(value, 64);
    return { data: [data.toString('base64'), 'base64'] };
  };
  it.each([false, true])(
    'checks the net user balances and fee recipient (sell=%s)',
    (sell) => {
      const expectation = {
        inputMint: sell ? STOCK : USDC,
        outputMint: sell ? USDC : STOCK,
        maxInRaw: '10000000',
        minOutRaw: '9900250',
        platformFee: { account: feeAccount, minAmountRaw: '50000' },
      };
      const probe = {
        wallet: WALLET,
        feeAccount,
        inputAccounts: ['in'],
        outputAccounts: ['out'],
        pre: new Map([
          ['in', 10000000n],
          ['out', 0n],
          [feeAccount, 123n],
        ]),
        preLamports: 1000000n,
      };
      const addresses = [WALLET, 'in', 'out', feeAccount];
      const accounts = [
        { lamports: 995000 },
        token(0n),
        token(9900250n),
        token(50123n),
      ];
      expect(
        checkSimulatedBalances(probe, expectation, addresses, accounts, 5000n)
          .ok,
      ).toBe(true);
      expect(
        checkSimulatedBalances(
          probe,
          expectation,
          addresses,
          [accounts[0], token(0n), token(9900249n), accounts[3]],
          5000n,
        ).ok,
      ).toBe(false);
      expect(
        checkSimulatedBalances(
          probe,
          expectation,
          addresses,
          [accounts[0], token(0n), accounts[2], token(123n)],
          5000n,
        ).ok,
      ).toBe(false);
      // Fee must fit inside the reviewed input, never an additional USDC debit.
      expect(
        checkSimulatedBalances(
          { ...probe, pre: new Map([...probe.pre, ['in', 10050000n]]) },
          expectation,
          addresses,
          accounts,
          5000n,
        ).ok,
      ).toBe(false);
    },
  );
});

describe('canonical Jupiter fee decoding', () => {
  const guard = new ReviewedPlatformFeeGuard({ call: jest.fn() } as never);
  it.each([false, true])(
    'walks a populated route plan (shared=%s)',
    async (shared) => {
      await expect(
        guard.inspect(tx(shared, 50, feeAccount, false, true), quote),
      ).resolves.toBeUndefined();
    },
  );
  it('rejects trailing data that disguises a different on-chain fee rate', async () => {
    await expect(
      guard.inspect(tx(false, 0, feeAccount, false, true, true), quote),
    ).rejects.toThrow('platform fee');
  });
});

describe('Jupiter V2 reviewed fees', () => {
  // The captured transactions keep the fee account static. These placeholder
  // lookup entries resolve unrelated DEX accounts for decompilation, offline.
  const table = Buffer.alloc(56 + 256 * 32);
  table.writeUInt32LE(1);
  table.writeBigUInt64LE(18446744073709551615n, 4);
  for (let i = 0; i < 256; i++)
    new PublicKey(STOCK).toBuffer().copy(table, 56 + i * 32);
  const rpc = {
    call: jest.fn().mockResolvedValue({
      value: { data: [table.toString('base64'), 'base64'] },
    }),
  };
  const guard = new ReviewedPlatformFeeGuard(rpc as never);
  const approved = {
    platformFee: { bps: 50, amountRaw: '25000', mint: captured.usdcMint },
    platformFeeAccount: captured.feeAccount,
  } as Quote;
  function mutate(
    original: string,
    change: (
      tx: VersionedTransaction,
      ix: VersionedTransaction['message']['compiledInstructions'][number],
    ) => void,
  ) {
    const transaction = VersionedTransaction.deserialize(
      Buffer.from(original, 'base64'),
    );
    const ix = transaction.message.compiledInstructions.find(
      (i) =>
        transaction.message.staticAccountKeys[i.programIdIndex]?.toBase58() ===
        'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    )!;
    change(transaction, ix);
    return Buffer.from(transaction.serialize()).toString('base64');
  }
  it.each(['buy', 'sell'] as const)(
    'accepts the real unsigned %s and rejects changed fees',
    async (side) => {
      const original = captured.cases[side].swapResponse.swapTransaction;
      await expect(guard.inspect(original, approved)).resolves.toBeUndefined();
      for (const bps of [0, 51, 306]) {
        const changed = mutate(original, (_tx, ix) =>
          Buffer.from(
            ix.data.buffer,
            ix.data.byteOffset,
            ix.data.byteLength,
          ).writeUInt16LE(bps, 26),
        );
        await expect(guard.inspect(changed, approved)).rejects.toThrow(
          'platform fee',
        );
      }
      const changedAccount = mutate(original, (tx, ix) => {
        tx.message.staticAccountKeys[ix.accountKeyIndexes[10]] = new PublicKey(
          STOCK,
        );
      });
      await expect(guard.inspect(changedAccount, approved)).rejects.toThrow(
        'platform fee',
      );
      const trailing = mutate(original, (_tx, ix) => {
        ix.data = Buffer.concat([ix.data, Buffer.from([50])]);
      });
      await expect(guard.inspect(trailing, approved)).rejects.toThrow(
        'platform fee',
      );
      const truncated = mutate(original, (_tx, ix) => {
        ix.data = ix.data.subarray(0, ix.data.length - 1);
      });
      await expect(guard.inspect(truncated, approved)).rejects.toThrow(
        'platform fee',
      );
      const unknown = mutate(original, (_tx, ix) => {
        ix.data[0] ^= 255;
      });
      await expect(guard.inspect(unknown, approved)).rejects.toThrow(
        'platform fee',
      );
    },
  );
  it.each([
    ['route_v2', 'bb64facc31c4af14', false],
    ['shared_accounts_route_v2', 'd19853937cfed8e9', true],
    ['exact_out_route_v2', '9d8ab85215f4f324', false],
    ['shared_accounts_exact_out_route_v2', '3560e5cad8bbfa18', true],
  ] as const)(
    'validates the IDL layout and first remaining fee account for %s',
    async (name, hex, shared) => {
      const discriminator = createHash('sha256')
        .update('global:' + name)
        .digest()
        .subarray(0, 8);
      expect(discriminator.toString('hex')).toBe(hex);
      const source = VersionedTransaction.deserialize(
        Buffer.from(captured.cases.buy.swapResponse.swapTransaction, 'base64'),
      );
      const plan = source.message.compiledInstructions.find(
        (i) =>
          Buffer.from(i.data).subarray(0, 8).toString('hex') ===
          'bb64facc31c4af14',
      )!.data;
      const data = Buffer.concat([
        discriminator,
        ...(shared ? [Buffer.from([0])] : []),
        plan.subarray(8),
      ]);
      function encode(
        bps: number,
        destination: string,
        index = shared ? 12 : 10,
      ) {
        data.writeUInt16LE(bps, shared ? 27 : 26);
        const keys = Array.from({ length: 14 }, () => ({
          pubkey: new PublicKey(STOCK),
          isSigner: false,
          isWritable: false,
        }));
        keys[index] = {
          pubkey: new PublicKey(destination),
          isSigner: false,
          isWritable: true,
        };
        const message = new TransactionMessage({
          payerKey: new PublicKey(WALLET),
          recentBlockhash: STOCK,
          instructions: [
            new TransactionInstruction({
              programId: new PublicKey(
                'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
              ),
              keys,
              data,
            }),
          ],
        }).compileToV0Message();
        return Buffer.from(
          new VersionedTransaction(message).serialize(),
        ).toString('base64');
      }
      await expect(
        guard.inspect(encode(50, captured.feeAccount), approved),
      ).resolves.toBeUndefined();
      await expect(
        guard.inspect(encode(51, captured.feeAccount), approved),
      ).rejects.toThrow('platform fee');
      await expect(guard.inspect(encode(50, STOCK), approved)).rejects.toThrow(
        'platform fee',
      );
      // An approved recipient in V1's slot must not satisfy a V2 route.
      await expect(
        guard.inspect(
          encode(50, captured.feeAccount, shared ? 9 : 6),
          approved,
        ),
      ).rejects.toThrow('platform fee');
    },
  );
});
