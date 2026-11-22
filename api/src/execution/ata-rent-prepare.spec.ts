import { ExecutionService } from './execution.service';
import { QuoteCache } from './quote-cache';
import type { Quote } from '../../types/quote';
import type { ExecutionFeature } from '../../types/execution';
import type { AtaRentReviewContext } from './ata-rent-sponsor.service';

const wallet = '11111111111111111111111111111111';
function fixture(origin: 'user_reviewed' | 'other' = 'user_reviewed') {
  const quote = {
    id: 'quote',
    side: 'buy',
    assetId: 'stock',
    ticker: 'STOCK',
    variant: { mint: 'mint', symbol: 'STOCK', name: 'Stock', tradable: true },
    inputMint: 'usdc',
    outputMint: 'mint',
    inputAmount: 10,
    outputAmount: 1,
    inputSymbol: 'USDC',
    outputSymbol: 'STOCK',
    estimatedPriceUsd: 10,
    amountUsd: 10,
    priceImpactPercent: 0,
    slippageBps: 50,
    provider: 'titan:Titan-DART',
    routePayload: { inAmount: '10000000' },
    quotedAt: new Date(),
    expiresAt: new Date(Date.now() + 30_000),
  } as Quote;
  const prepared = {
    quoteId: quote.id,
    wallet,
    transaction: 'exact-original-swap-bytes',
    provider: quote.provider,
    expiresAt: quote.expiresAt,
  };
  const router = { prepare: jest.fn().mockResolvedValue({ prepared, quote }) };
  const cache = new QuoteCache();
  cache.set(quote, origin);
  const repository = { insert: jest.fn().mockResolvedValue({ id: 'exec' }) };
  const sponsor = { enabled: true, cover: jest.fn().mockResolvedValue(true) };
  const inspection = { inspect: jest.fn().mockResolvedValue('5000') };
  const service = new ExecutionService(
    router as never,
    {} as never,
    {} as never,
    cache,
    {} as never,
    {} as never,
    {} as never,
    repository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    sponsor as never,
    inspection as never,
  );
  return { service, quote, router, cache, sponsor, inspection };
}
const context: AtaRentReviewContext = {
  flow: 'user_reviewed',
  userId: 'authenticated-user',
};
describe('reviewed prepare ATA boundary', () => {
  it('waits for coverage and returns byte-identical provider transactions', async () => {
    const f = fixture();
    let finish!: (result: boolean) => void;
    f.sponsor.cover.mockReturnValueOnce(
      new Promise<boolean>((yes) => {
        finish = yes;
      }),
    );
    let returned = false;
    const pending = f.service
      .prepare({ quoteId: 'quote', wallet }, 'direct', context)
      .then((result) => {
        returned = true;
        return result;
      });
    await new Promise((resolve) => setImmediate(resolve));
    expect(returned).toBe(false);
    finish(true);
    const result = await pending;
    expect(result.transaction).toBe('exact-original-swap-bytes');
    expect(result.ataRentSponsored).toBe(true);
    expect(f.router.prepare).toHaveBeenCalledWith(f.quote, wallet, undefined);
  });
  it.each([false, new Error('sponsor unavailable')])(
    'returns the same swap on sponsor fallback %s',
    async (result) => {
      const f = fixture();
      if (result instanceof Error)
        f.sponsor.cover.mockRejectedValueOnce(result);
      else f.sponsor.cover.mockResolvedValueOnce(result);
      const prepared = await f.service.prepare(
        { quoteId: 'quote', wallet },
        'direct',
        context,
      );
      expect(prepared.transaction).toBe('exact-original-swap-bytes');
      expect(prepared.ataRentSponsored).toBeUndefined();
    },
  );
  it.each([
    'agent',
    'basket',
    'copy_trade',
    'limit_order',
  ] as ExecutionFeature[])(
    'never invokes the sponsor for %s',
    async (source) => {
      const f = fixture();
      await f.service.prepare({ quoteId: 'quote', wallet }, source, context);
      expect(f.sponsor.cover).not.toHaveBeenCalled();
    },
  );
  it('preserves the existing prepare path when rent sponsorship is disabled', async () => {
    const f = fixture();
    f.sponsor.enabled = false;
    await f.service.prepare({ quoteId: 'quote', wallet }, 'direct', context);
    expect(f.sponsor.cover).not.toHaveBeenCalled();
    expect(f.inspection.inspect).not.toHaveBeenCalled();
  });
  it('defers coverage until the approval caller has validated the swap', async () => {
    const f = fixture();
    const result = await f.service.prepareWithQuote(
      { quoteId: 'quote', wallet },
      'direct',
      context,
    );
    expect(f.sponsor.cover).not.toHaveBeenCalled();
    expect(result.coverAtaRent).toBeDefined();
  });
  it('does not pay rent when direct prepare simulation fails', async () => {
    const f = fixture();
    f.inspection.inspect.mockRejectedValueOnce(new Error('simulation failed'));
    await expect(
      f.service.prepare({ quoteId: 'quote', wallet }, 'direct', context),
    ).rejects.toThrow('simulation failed');
    expect(f.sponsor.cover).not.toHaveBeenCalled();
  });
  it('does not promote agent/MCP quotes when they enter browser approval', async () => {
    const f = fixture('other');
    f.cache.set(f.quote, 'user_reviewed');
    f.cache.replace({ ...f.quote });
    await f.service.prepare({ quoteId: 'quote', wallet }, 'direct', context);
    expect(f.sponsor.cover).not.toHaveBeenCalled();
  });
});
