import captured from '../../test/fixtures/jupiter-v2-platform-fee-tslax.json';
import { mapJupiterQuoteToDomain } from './jupiter/jupiter.mapper';
import { ExecutionRepository } from './execution.repository';
import {
  checkSimulatedBalances,
  type SimulatedAccount,
} from './swap-balance-guard';
import { USDC_MINT } from '../config/constants';
import { JupiterClient } from './jupiter/jupiter.client';
import { JupiterService } from './jupiter/jupiter.service';
import { mappedPlatformFee } from './platform-fee';
import {
  enforcedMinimumOut,
  expectationFor,
  publicQuote,
  reviewedTermsFor,
} from './swap-terms';
import type { JupiterQuoteContext } from './jupiter/jupiter.service';

const config = { bps: 50, account: 'fee-account' };
function context(
  sell = false,
): JupiterQuoteContext & { inputMint: string; outputMint: string } {
  return {
    side: sell ? 'sell' : 'buy',
    assetId: 'stock',
    ticker: 'STOCK',
    variant: {
      mint: 'stock',
      symbol: 'STOCK',
      name: 'Stock',
      decimals: 6,
      tradable: true,
    },
    inputMint: sell ? 'stock' : USDC_MINT,
    outputMint: sell ? USDC_MINT : 'stock',
    inputSymbol: sell ? 'STOCK' : 'USDC',
    outputSymbol: sell ? 'USDC' : 'STOCK',
    inputDecimals: 6,
    outputDecimals: 6,
    amountUi: 10,
    amountUsd: 10,
  };
}
function fixture(failSwaps = 0) {
  let attempts = 0;
  const gateway = {
    fetch: jest.fn(async (url: string, init: RequestInit) => {
      await Promise.resolve(init);
      if (url.endsWith('/swap')) {
        attempts++;
        return attempts <= failSwaps
          ? new Response('retry', { status: 500 })
          : Response.json({ swapTransaction: 'original-swap-bytes' });
      }
      const params = new URL(url).searchParams;
      const fee = params.has('platformFeeBps');
      return Response.json({
        inputMint: params.get('inputMint'),
        outputMint: params.get('outputMint'),
        inAmount: params.get('amount'),
        outAmount: fee ? '9950000' : '10000000',
        otherAmountThreshold: fee ? '9900250' : '9950000',
        swapMode: 'ExactIn',
        slippageBps: 50,
        platformFee: fee ? { feeBps: 50, amount: '50000' } : null,
      });
    }),
  };
  const client = new JupiterClient(
    { JUPITER_TRACKING_ACCOUNT: 'tracking' } as never,
    gateway as never,
  );
  return { gateway, service: new JupiterService(client) };
}
describe('reviewed platform fee Jupiter requests and net terms', () => {
  it.each([false, true])(
    'quotes and swaps USDC-side fees (sell=%s)',
    async (sell) => {
      const { service, gateway } = fixture();
      const q = await service.getQuoteWithContext({
        ...context(sell),
        platformFee: config,
      });
      expect(
        new URL(gateway.fetch.mock.calls[0][0]).searchParams.get(
          'platformFeeBps',
        ),
      ).toBe('50');
      expect(
        new URL(gateway.fetch.mock.calls[0][0]).searchParams.get(
          'instructionVersion',
        ),
      ).toBe('V2');
      expect(q.platformFee).toEqual({
        bps: 50,
        amountRaw: '50000',
        mint: USDC_MINT,
      });
      expect(q.outputAmount).toBe(9.95);
      expect(enforcedMinimumOut(q)).toBe(9900250n);
      expect(reviewedTermsFor(q)?.minOutRaw).toBe('9900250');
      expect(expectationFor(q, reviewedTermsFor(q))).toEqual({
        inputMint: q.inputMint,
        outputMint: q.outputMint,
        maxInRaw: '10000000',
        minOutRaw: '9900250',
        platformFee: {
          account: config.account,
          minAmountRaw: sell ? '49750' : '50000',
        },
      });
      expect(publicQuote(q)).toMatchObject({
        platformFee: q.platformFee,
        minimumOutputAmount: 9.90025,
      });
      expect(publicQuote(q).platformFeeAccount).toBeUndefined();
      await service.prepareSwap(q, 'wallet');
      const body = JSON.parse(
        gateway.fetch.mock.calls[1][1].body as string,
      ) as Record<string, unknown>;
      expect(body).toMatchObject({
        feeAccount: config.account,
        useSharedAccounts: false,
        trackingAccount: 'tracking',
      });
    },
  );
  it('preserves feeAccount and the identical quote through every retry', async () => {
    const { service, gateway } = fixture(2);
    const q = await service.getQuoteWithContext({
      ...context(),
      platformFee: config,
    });
    await service.prepareSwap(q, 'wallet');
    const bodies = gateway.fetch.mock.calls
      .slice(1)
      .map(
        ([, init]) =>
          JSON.parse(init.body as string) as Record<string, unknown>,
      );
    expect(bodies).toHaveLength(3);
    for (const body of bodies) {
      expect(body.feeAccount).toBe(config.account);
      expect(body.quoteResponse).toEqual(q.routePayload);
      expect(
        new URL(gateway.fetch.mock.calls[0][0]).searchParams.get(
          'instructionVersion',
        ),
      ).toBe('V2');
    }
    expect(bodies[2].trackingAccount).toBeUndefined();
  });
  it.each([undefined, config])(
    'omits fee params on non-USDC pairs even with config %s',
    async (platformFee) => {
      const { service, gateway } = fixture();
      const q = await service.getQuoteWithContext({
        ...context(),
        inputMint: 'other',
        platformFee,
      });
      await service.prepareSwap(q, 'wallet');
      expect(
        new URL(gateway.fetch.mock.calls[0][0]).searchParams.has(
          'platformFeeBps',
        ),
      ).toBe(false);
      expect(
        JSON.parse(gateway.fetch.mock.calls[1][1].body as string),
      ).not.toHaveProperty('feeAccount');
      expect(publicQuote(q)).not.toHaveProperty('platformFee');
    },
  );
  it('fee-free delegated requests retain the original params, response shape and bytes', async () => {
    const { service, gateway } = fixture();
    const ctx = context();
    const q = await service.getQuoteWithContext(ctx);
    expect(gateway.fetch.mock.calls[0][0]).toBe(
      'https://api.jup.ag/swap/v1/quote?inputMint=' +
        USDC_MINT +
        '&outputMint=stock&amount=10000000&slippageBps=50',
    );
    expect(publicQuote(q)).not.toHaveProperty('platformFee');
    expect(publicQuote(q)).not.toHaveProperty('minimumOutputAmount');
    expect((await service.prepareSwap(q, 'wallet')).transaction).toBe(
      'original-swap-bytes',
    );
    expect(JSON.parse(gateway.fetch.mock.calls[1][1].body as string)).toEqual({
      quoteResponse: q.routePayload,
      userPublicKey: 'wallet',
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      useSharedAccounts: false,
      trackingAccount: 'tracking',
    });
  });
  it('does not request V2 for an explicitly zero fee', async () => {
    const { service, gateway } = fixture();
    await service.getQuoteWithContext({
      ...context(),
      platformFee: { ...config, bps: 0 },
    });
    expect(
      new URL(gateway.fetch.mock.calls[0][0]).searchParams.has(
        'instructionVersion',
      ),
    ).toBe(false);
  });
  it('rejects missing, mismatched or unexpected upstream fees', () => {
    expect(() => mappedPlatformFee(null, config)).toThrow(
      'requested platform fee',
    );
    expect(() =>
      mappedPlatformFee({ feeBps: 51, amount: '5' }, config),
    ).toThrow();
    expect(() =>
      mappedPlatformFee({ feeBps: 50, amount: '-1' }, config),
    ).toThrow();
    expect(() =>
      mappedPlatformFee({ feeBps: 50, amount: '5' }, undefined),
    ).toThrow('Unexpected');
  });
});

describe('captured V2 fee amounts, reviewed balances and persistence', () => {
  const token = (amount: bigint): SimulatedAccount => {
    const data = Buffer.alloc(165);
    data.writeBigUInt64LE(amount, 64);
    return { data: [data.toString('base64'), 'base64'] };
  };
  it.each(['buy', 'sell'] as const)(
    'keeps the %s fee in USDC across the API, guard and database',
    async (side) => {
      const raw = captured.cases[side].quoteResponse;
      const q = mapJupiterQuoteToDomain({
        ...context(side === 'sell'),
        raw: { ...raw, instructionVersion: 'V2' },
        variant: {
          ...context().variant,
          mint: captured.stockMint,
          decimals: 8,
        },
        inputDecimals: side === 'buy' ? 6 : 8,
        outputDecimals: side === 'buy' ? 8 : 6,
        platformFee: { bps: 50, account: captured.feeAccount },
        slippageBps: 100,
      });
      const amountRaw = side === 'buy' ? '25000' : '35901';
      expect(q.platformFee).toEqual({ bps: 50, amountRaw, mint: USDC_MINT });
      expect(q.inputAmount).toBe(side === 'buy' ? 5 : 0.02);
      expect(q.outputAmount).toBe(side === 'buy' ? 0.01384967 : 7.144422);
      expect(publicQuote(q)).toMatchObject({
        platformFee: { amountRaw, mint: USDC_MINT },
      });
      const expectation = expectationFor(q, reviewedTermsFor(q))!;
      expect(expectation).toMatchObject({
        maxInRaw: raw.inAmount,
        minOutRaw: raw.otherAmountThreshold,
        platformFee: { minAmountRaw: side === 'buy' ? '25000' : '35541' },
      });
      const fee = BigInt(expectation.platformFee!.minAmountRaw);
      const probe = {
        wallet: 'wallet',
        feeAccount: captured.feeAccount,
        inputAccounts: ['in'],
        outputAccounts: ['out'],
        pre: new Map([
          ['in', BigInt(raw.inAmount)],
          ['out', 0n],
          [captured.feeAccount, 123n],
        ]),
        preLamports: 0n,
      };
      const addresses = ['wallet', 'in', 'out', captured.feeAccount];
      const accounts = [
        { lamports: 0 },
        token(0n),
        token(BigInt(raw.otherAmountThreshold)),
        token(123n + fee),
      ];
      expect(
        checkSimulatedBalances(probe, expectation, addresses, accounts, 0n).ok,
      ).toBe(true);
      expect(
        checkSimulatedBalances(
          probe,
          expectation,
          addresses,
          [...accounts.slice(0, 3), token(122n + fee)],
          0n,
        ).ok,
      ).toBe(false);
      expect(
        checkSimulatedBalances(
          {
            ...probe,
            pre: new Map([...probe.pre, ['in', BigInt(raw.inAmount) + 1n]]),
          },
          expectation,
          addresses,
          accounts,
          0n,
        ).ok,
      ).toBe(false);
      // The floor follows the reviewed minimum, even when it is stricter than slippage.
      const stricter = expectationFor(q, {
        ...reviewedTermsFor(q)!,
        minOutRaw: raw.outAmount,
      })!;
      expect(stricter.platformFee!.minAmountRaw).toBe(amountRaw);
      const returning = jest.fn().mockResolvedValue([{ id: 'execution' }]);
      const values = jest.fn().mockReturnValue({ returning });
      const repository = new ExecutionRepository({
        insert: jest.fn().mockReturnValue({ values }),
      } as never);
      await repository.insert({
        walletAddress: 'offline-wallet',
        type: side === 'buy' ? 'stock_purchase' : 'stock_sale',
        status: 'awaiting_signature',
        platformFee: q.platformFee,
      });
      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({
          platformFeeBps: 50,
          platformFeeAmountRaw: amountRaw,
          platformFeeMint: USDC_MINT,
        }),
      );
    },
  );
  it('floors fractional input fees using bigint arithmetic', () => {
    expect(
      mappedPlatformFee({ feeBps: 50, amount: '6959' }, config, '5000199')
        ?.amountRaw,
    ).toBe('25000');
  });
});
