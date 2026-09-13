import { VariantSelector } from './variant-selector';
import type { Equity } from '../../types/equity';

describe('VariantSelector.pickCandidates', () => {
  const selector = new VariantSelector(
    {} as never,
    {} as never,
  );

  const equity: Equity = {
    id: 'aapl',
    ticker: 'AAPL',
    name: 'Apple',
    category: 'equity',
    variants: [
      {
        mint: 'mintLow',
        symbol: 'a',
        name: 'a',
        liquidity: 10,
        tradable: true,
      },
      {
        mint: 'mintHigh',
        symbol: 'b',
        name: 'b',
        liquidity: 100,
        tradable: true,
      },
      {
        mint: 'mintDead',
        symbol: 'c',
        name: 'c',
        liquidity: 999,
        tradable: false,
      },
    ],
  };

  it('skips non-tradable variants', () => {
    const picked = selector.pickCandidates(equity);
    expect(picked.every((v) => v.tradable)).toBe(true);
    expect(picked.map((v) => v.mint)).not.toContain('mintDead');
  });

  it('ranks by liquidity descending', () => {
    const picked = selector.pickCandidates(equity);
    expect(picked[0].mint).toBe('mintHigh');
    expect(picked[1].mint).toBe('mintLow');
  });

  it('honors preferredMint when tradable', () => {
    const picked = selector.pickCandidates(equity, 'mintLow');
    expect(picked).toHaveLength(1);
    expect(picked[0].mint).toBe('mintLow');
  });

  it('ignores preferredMint when not tradable', () => {
    const picked = selector.pickCandidates(equity, 'mintDead');
    expect(picked.map((v) => v.mint)).toEqual(['mintHigh', 'mintLow']);
  });
});
