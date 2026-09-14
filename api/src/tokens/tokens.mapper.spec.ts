import { mapEquity } from './tokens.mapper';

describe('tokens mapper', () => {
  it('maps the curated asset image and canonical stats', () => {
    const equity = mapEquity({
      assetId: 'nvidia',
      symbol: 'NVDA',
      name: 'NVIDIA',
      category: 'equity',
      imageUrl: 'https://cdn.tokens.xyz/nvidia.png',
      stats: {
        price: 182.14,
        priceChange24hPercent: 2.35,
        volume24hUSD: 12_000_000,
        liquidity: 4_500_000,
      },
    });

    expect(equity).toMatchObject({
      id: 'nvidia',
      ticker: 'NVDA',
      logo: 'https://cdn.tokens.xyz/nvidia.png',
      price: 182.14,
      priceChange24h: 2.35,
      volume24h: 12_000_000,
      liquidity: 4_500_000,
    });
  });

  it('falls back to the primary variant logo', () => {
    const equity = mapEquity({
      assetId: 'tesla',
      symbol: 'TSLA',
      primaryVariant: {
        mint: 'mint',
        market: { logoURI: 'ipfs://tesla-logo' },
      },
    });

    expect(equity.logo).toBe('ipfs://tesla-logo');
  });
});
