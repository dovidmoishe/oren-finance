import { QuoteCache } from './quote-cache';
import type { Quote } from '../../types/quote';
import { QuoteExpiredError } from '../common/errors/provider.errors';

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  const now = new Date();
  return {
    id: 'quote-1',
    side: 'buy',
    assetId: 'aapl',
    ticker: 'AAPL',
    variant: {
      mint: 'mintA',
      symbol: 'xAAPL',
      name: 'AAPL',
      tradable: true,
    },
    inputMint: 'usdc',
    outputMint: 'mintA',
    inputSymbol: 'USDC',
    outputSymbol: 'xAAPL',
    inputAmount: 100,
    outputAmount: 1,
    estimatedPriceUsd: 100,
    amountUsd: 100,
    priceImpactPercent: 0.1,
    slippageBps: 50,
    provider: 'jupiter',
    routePayload: { inAmount: '1' },
    quotedAt: now,
    expiresAt: new Date(now.getTime() + 30_000),
    ...overrides,
  };
}

describe('QuoteCache', () => {
  it('returns stored quotes before expiry', () => {
    const cache = new QuoteCache();
    const quote = makeQuote();
    cache.set(quote);
    expect(cache.get('quote-1').quote.id).toBe('quote-1');
  });

  it('rejects expired quotes', () => {
    const cache = new QuoteCache();
    const quote = makeQuote({
      expiresAt: new Date(Date.now() - 1_000),
    });
    cache.set(quote);
    expect(() => cache.get('quote-1')).toThrow(QuoteExpiredError);
  });

  it('tracks pending execution ids after prepare', () => {
    const cache = new QuoteCache();
    cache.set(makeQuote());
    cache.attachExecution('quote-1', 'exec-9', 'Wallet111');
    expect(cache.getPendingExecution('quote-1')).toEqual({
      executionId: 'exec-9',
      wallet: 'Wallet111',
    });
  });
});
