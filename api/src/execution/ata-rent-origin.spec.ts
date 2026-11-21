import { ExecutionService } from './execution.service';
import { QuoteCache } from './quote-cache';

function fixture(resolved: boolean) {
  const cache = new QuoteCache();
  const variant = {
    mint: 'mint',
    symbol: 'STOCK',
    name: 'Stock',
    tradable: true,
    decimals: 6,
  };
  const tokens = {
    resolveMint: jest
      .fn()
      .mockResolvedValue(
        resolved
          ? { id: 'stock', ticker: 'STOCK', variants: [variant] }
          : undefined,
      ),
  };
  const router = {
    quote: jest.fn().mockResolvedValue({
      id: 'q',
      side: 'buy',
      assetId: 'client-claimed-stock',
      ticker: 'STOCK',
      variant,
      inputMint: 'usdc',
      outputMint: 'mint',
      quotedAt: new Date(),
      expiresAt: new Date(Date.now() + 30_000),
    }),
  };
  const service = new ExecutionService(
    router as never,
    {} as never,
    { withDecimals: (value: unknown) => Promise.resolve(value) } as never,
    cache,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    tokens as never,
    {} as never,
    {} as never,
  );
  return { service, cache };
}
describe('ATA subsidy quote provenance', () => {
  it.each([false, true])(
    'requires catalog resolution even with a claimed stock id: %s',
    async (resolved) => {
      const f = fixture(resolved);
      await f.service.getQuote(
        {
          side: 'buy',
          inputMint: 'usdc',
          outputMint: 'mint',
          amount: 10,
          assetId: 'client-claimed-stock',
          ticker: 'STOCK',
        },
        'user_reviewed',
      );
      expect(f.cache.get('q').origin).toBe(
        resolved ? 'user_reviewed' : 'other',
      );
    },
  );
});
