import { ServiceUnavailableException } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { USDC_MINT } from '../config/constants';

function balance(mint: string, uiAmount = 1) {
  return { mint, uiAmount, amount: uiAmount * 1e6, decimals: 6 };
}
function fixture(balances = [balance('stock')]) {
  const alchemy = { getTokenBalances: jest.fn().mockResolvedValue(balances) };
  const tokens = {
    resolveMint: jest.fn().mockImplementation((mint: string) =>
      Promise.resolve({
        id: mint,
        ticker: mint,
        name: mint,
        category: 'equity',
        price: 10,
        variants: [{ mint, symbol: mint, name: mint, tradable: true }],
      }),
    ),
    getMarketSnapshots: jest.fn().mockResolvedValue([]),
  };
  const repository = {
    listVaultPositions: jest.fn().mockResolvedValue([]),
    getLatestSnapshot: jest.fn().mockResolvedValue(null),
    insertSnapshot: jest.fn().mockResolvedValue(undefined),
  };
  return {
    alchemy,
    tokens,
    repository,
    service: new PortfolioService(
      alchemy as never,
      tokens as never,
      repository as never,
    ),
  };
}

describe('portfolio provider workload', () => {
  afterEach(() => jest.useRealTimers());

  it('resolves a thousand same-mint accounts once and preserves stock and cash totals', async () => {
    const f = fixture([
      ...Array.from({ length: 1000 }, () => balance('stock', 0.25)),
      balance(USDC_MINT, 2),
      balance(USDC_MINT, 3),
    ]);
    const result = await f.service.getPortfolio('wallet');
    expect(f.tokens.resolveMint).toHaveBeenCalledTimes(1);
    expect(result.positions[0].quantity).toBe(250);
    expect(result.totalValueUsd).toBe(2505);
  });

  it('rejects excessive distinct mints before provider resolution or snapshot writes', async () => {
    const f = fixture(
      Array.from({ length: 257 }, (_, i) => balance(`mint-${i}`)),
    );
    await expect(f.service.getPortfolio('wallet')).rejects.toThrow(
      'too many token types',
    );
    expect(f.tokens.resolveMint).not.toHaveBeenCalled();
    expect(f.repository.insertSnapshot).not.toHaveBeenCalled();
    f.alchemy.getTokenBalances.mockResolvedValue([balance('stock')]);
    await expect(f.service.getPortfolio('wallet')).resolves.toBeDefined();
  });

  it('coalesces overlapping same-wallet reads and writes one snapshot', async () => {
    const f = fixture();
    const [a, b] = await Promise.all([
      f.service.getPortfolio('wallet'),
      f.service.getPortfolio('wallet'),
    ]);
    expect(a).toEqual(b);
    expect(f.alchemy.getTokenBalances).toHaveBeenCalledTimes(1);
    expect(f.repository.insertSnapshot).toHaveBeenCalledTimes(1);
  });

  it('rejects a fifth active wallet without starting upstream work and releases slots after failures', async () => {
    const f = fixture();
    let fail!: (reason: Error) => void;
    f.alchemy.getTokenBalances.mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const active = ['a', 'b', 'c', 'd'].map((wallet) =>
      f.service.getPortfolio(wallet),
    );
    const settled = Promise.allSettled(active);
    await expect(f.service.getPortfolio('e')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(f.alchemy.getTokenBalances).toHaveBeenCalledTimes(4);
    fail(new Error('offline provider'));
    await settled;
    f.alchemy.getTokenBalances.mockResolvedValue([]);
    await expect(f.service.getPortfolio('e')).resolves.toBeDefined();
  });

  it('shares same-mint lookups between wallets, but always reloads balances and market prices', async () => {
    const f = fixture();
    await Promise.all([
      f.service.getPortfolio('a'),
      f.service.getPortfolio('b'),
    ]);
    await f.service.getPortfolio('a');
    expect(f.tokens.resolveMint).toHaveBeenCalledTimes(1);
    expect(f.alchemy.getTokenBalances).toHaveBeenCalledTimes(3);
    expect(f.tokens.getMarketSnapshots).toHaveBeenCalledTimes(3);
  });

  it.each([
    [true, 15_001],
    [false, 60_001],
  ])(
    'expires supported=%s metadata and negative results',
    async (supported, ttl) => {
      jest.useFakeTimers();
      const f = fixture();
      if (!supported) f.tokens.resolveMint.mockResolvedValue(null);
      await f.service.getPortfolio('a');
      await f.service.getPortfolio('b');
      expect(f.tokens.resolveMint).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(ttl);
      await f.service.getPortfolio('a');
      expect(f.tokens.resolveMint).toHaveBeenCalledTimes(2);
    },
  );
});
