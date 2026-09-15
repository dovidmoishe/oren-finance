import { buildInstructions, portfolioToContext } from './agent-context';

describe('agent-context', () => {
  it('maps portfolio data into a compact agent snapshot', () => {
    const snapshot = portfolioToContext({
      walletAddress: 'wallet-1',
      totalValueUsd: 10_000,
      absoluteChangeUsd: 250,
      percentChange: 2.5,
      availableValueUsd: 8_000,
      lockedValueUsd: 500,
      cashValueUsd: 1_500,
      positions: [
        {
          assetId: 'nvda',
          ticker: 'NVDA',
          name: 'NVIDIA',
          currentPrice: 200,
          priceChange24h: 1.2,
          changePercent: 1.2,
          quantity: 10,
          valueUsd: 2_000,
          allocationPercent: 20,
          availableAmount: 10,
          lockedAmount: 0,
          availableValueUsd: 2_000,
          lockedValueUsd: 0,
        },
      ],
      updatedAt: new Date('2026-09-13T10:00:00Z'),
    });

    expect(snapshot.totalValueUsd).toBe(10_000);
    expect(snapshot.positions[0]).toMatchObject({
      ticker: 'NVDA',
      allocationPct: 20,
    });
  });

  it('includes wallet and portfolio context in instructions', () => {
    const instructions = buildInstructions('wallet-1', { page: 'dashboard' }, {
      totalValueUsd: 10_000,
      availableValueUsd: 8_000,
      lockedValueUsd: 500,
      cashValueUsd: 1_500,
      changeUsd: 250,
      changePct: 2.5,
      updatedAt: '2026-09-13T10:00:00Z',
      positions: [
        {
          assetId: 'nvda',
          ticker: 'NVDA',
          name: 'NVIDIA',
          quantity: 10,
          valueUsd: 2_000,
          allocationPct: 20,
        },
      ],
    });

    expect(instructions).toContain('wallet-1');
    expect(instructions).toContain('Never ask them to paste a wallet address');
    expect(instructions).toContain('Top holdings: NVDA 20.0%');
    expect(instructions).toContain('currently on the dashboard page');
  });

  it('tells the model to fetch portfolio when snapshot is unavailable', () => {
    const instructions = buildInstructions('wallet-1');

    expect(instructions).toContain('Portfolio snapshot: unavailable');
    expect(instructions).toContain('Call getPortfolio');
  });
});
