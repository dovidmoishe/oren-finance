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
