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
jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));
import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import captured from '../../test/fixtures/jupiter-v2-platform-fee-tslax.json';
import { ApprovalService } from './approval.service';
import { ApprovalRpc } from './approval-rpc.service';
import { ExecutionService } from './execution.service';
import { QuoteCache } from './quote-cache';
import { mapJupiterQuoteToDomain } from './jupiter/jupiter.mapper';
import { expectationFor, reviewedTermsFor } from './swap-terms';
import { ATA_PROGRAM_ID, type SimulatedAccount } from './swap-balance-guard';

const wallet = captured.cases.buy.userPublicKey;
const simulationPayer = captured.cases.sell.userPublicKey;
const mint = new PublicKey(captured.stockMint);
const stockAta = getAssociatedTokenAddressSync(
  mint,
  new PublicKey(wallet),
  false,
  TOKEN_2022_PROGRAM_ID,
).toBase58();
const usdcAta = getAssociatedTokenAddressSync(
  new PublicKey(captured.usdcMint),
  new PublicKey(wallet),
  false,
  TOKEN_PROGRAM_ID,
).toBase58();
const token = (amount: bigint): SimulatedAccount => {
  const data = Buffer.alloc(165);
  data.writeBigUInt64LE(amount, 64);
  return { data: [data.toString('base64'), 'base64'] };
};
function fixture(
  options: {
    unhealthy?: boolean;
    simulationFailure?: boolean;
    balanceFailure?: boolean;
    covered?: boolean;
    lookup?: boolean;
  } = {},
) {
  const quote = mapJupiterQuoteToDomain({
    raw: { ...captured.cases.buy.quoteResponse, instructionVersion: 'V2' },
    platformFee: { bps: 50, account: captured.feeAccount },
    side: 'buy',
    assetId: 'tesla',
    ticker: 'TSLA',
    variant: {
      mint: captured.stockMint,
      symbol: 'TSLAx',
      name: 'Tesla',
      decimals: 8,
      tradable: true,
    },
    inputSymbol: 'USDC',
    outputSymbol: 'TSLAx',
    inputDecimals: 6,
    outputDecimals: 8,
    amountUsd: 5,
    slippageBps: 100,
  });
  const lookupKey = new PublicKey(
    'E28CeoRY3g4RJcHN7LFPMvzCzUSp8Yg6nCFRUJSYkLES',
  );
  const table = new AddressLookupTableAccount({
    key: lookupKey,
    state: {
      deactivationSlot: 18446744073709551615n,
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      addresses: [mint, new PublicKey(stockAta)],
    },
  });
  const tableData = Buffer.alloc(120);
  tableData.writeUInt32LE(1);
  tableData.writeBigUInt64LE(18446744073709551615n, 4);
  mint.toBuffer().copy(tableData, 56);
  new PublicKey(stockAta).toBuffer().copy(tableData, 88);
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: new PublicKey(wallet),
      recentBlockhash: captured.stockMint,
      instructions: [
        createAssociatedTokenAccountIdempotentInstruction(
          new PublicKey(wallet),
          new PublicKey(stockAta),
          new PublicKey(wallet),
          mint,
          TOKEN_2022_PROGRAM_ID,
        ),
      ],
    }).compileToV0Message(options.lookup ? [table] : []),
  );
  const transaction = Buffer.from(tx.serialize()).toString('base64');
  const expectation = expectationFor(quote, reviewedTermsFor(quote))!;
  const router = {
    prepare: jest.fn().mockResolvedValue({
      prepared: {
        quoteId: quote.id,
        wallet,
        transaction,
        provider: 'jupiter',
        expiresAt: quote.expiresAt,
      },
      quote,
      expectation,
    }),
  };
  const cache = new QuoteCache();
  cache.set(quote, 'user_reviewed');
  const sponsor = {
    enabled: true,
    cover: jest.fn().mockResolvedValue(options.covered ?? true),
  };
  const rpc = {
    call: jest.fn(async (method: string, params: unknown[]) => {
      await Promise.resolve();
      if (method === 'getAccountInfo' && params[0] === lookupKey.toBase58())
        return { value: { data: [tableData.toString('base64'), 'base64'] } };
      if (method === 'getAccountInfo')
        return {
          value:
            params[0] === simulationPayer
              ? {
                  owner: '11111111111111111111111111111111',
                  executable: false,
                  lamports: options.unhealthy ? 0 : 100000000,
                }
              : null,
        };
      if (method === 'getTokenAccountsByOwner')
        return {
          value:
            (params[1] as { mint: string }).mint === captured.usdcMint
              ? [{ pubkey: usdcAta, account: token(5000000n) }]
              : [],
        };
      if (method === 'getBalance') return { value: 0 };
      if (method === 'getFeeForMessage') return { value: 5000 };
      if (method === 'getLatestBlockhash')
        return { value: { lastValidBlockHeight: 200 } };
      if (method === 'simulateTransaction') {
        const preview = VersionedTransaction.deserialize(
          Buffer.from(params[0] as string, 'base64'),
        );
        const ix = preview.message.compiledInstructions.find(
          (i) =>
            preview.message.staticAccountKeys[i.programIdIndex].toBase58() ===
            ATA_PROGRAM_ID,
        )!;
        const rentPayer =
          preview.message.staticAccountKeys[ix.accountKeyIndexes[0]].toBase58();
        const config = params[1] as {
          accounts: { addresses: string[] };
          sigVerify: boolean;
        };
        expect(config.sigVerify).toBe(false);
        if (rentPayer !== simulationPayer)
          return {
            value: { err: { InsufficientFundsForRent: { account_index: 1 } } },
          };
        const err = options.simulationFailure
          ? { InstructionError: [0, { Custom: 6014 }] }
          : null;
        return {
          value: {
            err,
            accounts: config.accounts.addresses.map((address) =>
              address === wallet
                ? null
                : address === usdcAta
                  ? token(0n)
                  : address === stockAta
                    ? token(
                        BigInt(expectation.minOutRaw) -
                          (options.balanceFailure ? 1n : 0n),
                      )
                    : address === captured.feeAccount
                      ? token(25000n)
                      : null,
            ),
          },
        };
      }
      throw new Error('Unexpected offline RPC: ' + method);
    }),
  };
  const inspection = new ApprovalRpc(rpc as never);
  const execution = new ExecutionService(
    router as never,
    {} as never,
    {} as never,
    cache,
    {} as never,
    {} as never,
    {} as never,
    { insert: jest.fn().mockResolvedValue({ id: 'execution' }) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    sponsor as never,
    inspection,
  );
  const approvals = {
    create: jest.fn((input: Record<string, unknown>) =>
      Promise.resolve({
        ...input,
        id: 'approval',
        status: 'prepared',
      }),
    ),
  };
  const auth = {
    requireApprovalWallet: jest.fn().mockResolvedValue({
      userId: 'user',
      walletId: 'wallet',
      signingMode: 'privy',
    }),
  };
  const service = new ApprovalService(
    auth as never,
    approvals as never,
    inspection,
    execution,
    {} as never,
    {} as never,
    cache,
    {} as never,
    {
      SOLANA_NETWORK: 'mainnet',
      PRIVY_REVIEWED_GAS_SPONSORSHIP: true,
      PRIVY_GAS_SIMULATION_PAYER: simulationPayer,
    } as never,
    {} as never,
  );
  return { service, rpc, sponsor, approvals, transaction, quote };
}
describe('ATA rent after approval validation', () => {
  it.each([
    { unhealthy: true },
    { simulationFailure: true },
    { balanceFailure: true },
  ])('pays no rent when a read-only check fails: %j', async (options) => {
    const f = fixture(options);
    await expect(
      f.service.prepare('Bearer offline', {
        kind: 'swap',
        referenceId: f.quote.id,
        wallet,
      }),
    ).rejects.toThrow();
    expect(f.sponsor.cover).not.toHaveBeenCalled();
    expect(f.approvals.create).not.toHaveBeenCalled();
    if (options.unhealthy)
      expect(
        f.rpc.call.mock.calls.some(
          ([method]) => method === 'simulateTransaction',
        ),
      ).toBe(false);
  });
  it.each([false, true])(
    'simulates a missing Token-2022 ATA, then covers it exactly once (lookup=%s)',
    async (lookup) => {
      const f = fixture({ lookup });
      await f.service.prepare('Bearer offline', {
        kind: 'swap',
        referenceId: f.quote.id,
        wallet,
      });
      expect(f.sponsor.cover).toHaveBeenCalledTimes(1);
      expect(f.sponsor.cover).toHaveBeenCalledWith(
        f.quote,
        wallet,
        { flow: 'user_reviewed', userId: 'user' },
        f.transaction,
      );
      expect(f.approvals.create).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction: f.transaction,
          details: expect.objectContaining({
            ataRentSponsored: true,
          }) as unknown,
        }),
      );
      const called = f.rpc.call.mock.invocationCallOrder;
      const sim = f.rpc.call.mock.calls.findIndex(
        ([method]) => method === 'simulateTransaction',
      );
      expect(f.sponsor.cover.mock.invocationCallOrder[0]).toBeGreaterThan(
        called[sim],
      );
      expect(f.sponsor.cover.mock.invocationCallOrder[0]).toBeLessThan(
        f.approvals.create.mock.invocationCallOrder[0],
      );
      expect(
        f.rpc.call.mock.calls.some(([method]) => /send|sign/i.test(method)),
      ).toBe(false);
    },
  );
  it('rechecks original rent obligations if coverage is skipped', async () => {
    const f = fixture({ covered: false });
    await expect(
      f.service.prepare('Bearer offline', {
        kind: 'swap',
        referenceId: f.quote.id,
        wallet,
      }),
    ).rejects.toThrow();
    expect(f.sponsor.cover).toHaveBeenCalledTimes(1);
    expect(
      f.rpc.call.mock.calls.filter(
        ([method]) => method === 'simulateTransaction',
      ),
    ).toHaveLength(2);
    expect(f.approvals.create).not.toHaveBeenCalled();
  });
});
