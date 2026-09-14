import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SocialService } from './social.service';

describe('SocialService', () => {
  const socialRepository = {
    listPublicProfiles: jest.fn(),
    findBySlug: jest.fn(),
    findByWallet: jest.fn(),
    upsertProfile: jest.fn(),
  };
  const portfolioRepository = {
    listSnapshots: jest.fn(),
  };
  const portfolio = {
    getPortfolio: jest.fn(),
    getHistory: jest.fn(),
    getActivity: jest.fn(),
  };
  const execution = {
    createBasketFromAllocations: jest.fn(),
  };

  let service: SocialService;

  const now = Date.now();
  const profileA = profileRow('wallet-a', 'alpha', 'Alpha');
  const profileB = profileRow('wallet-b', 'beta', 'Beta');

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SocialService(
      socialRepository as never,
      portfolioRepository as never,
      portfolio as never,
      execution as never,
    );
  });

  it('excludes private profiles from the leaderboard source list', async () => {
    socialRepository.listPublicProfiles.mockResolvedValue([profileA]);
    portfolioRepository.listSnapshots.mockResolvedValue([
      snapshot('wallet-a', 150, now),
      snapshot('wallet-a', 100, now - 5 * 86_400_000),
    ]);

    const leaderboard = await service.getLeaderboard({ timeframe: '30D' });

    expect(leaderboard.rows).toHaveLength(1);
    expect(leaderboard.rows[0].slug).toBe('alpha');
    expect(socialRepository.listPublicProfiles).toHaveBeenCalledTimes(1);
  });

  it('ranks 30D observed P&L percentage descending', async () => {
    socialRepository.listPublicProfiles.mockResolvedValue([profileA, profileB]);
    portfolioRepository.listSnapshots.mockImplementation((wallet: string) => {
      if (wallet === 'wallet-a') {
        return Promise.resolve([
          snapshot('wallet-a', 120, now),
          snapshot('wallet-a', 100, now - 10 * 86_400_000),
        ]);
      }
      return Promise.resolve([
        snapshot('wallet-b', 180, now),
        snapshot('wallet-b', 100, now - 10 * 86_400_000),
      ]);
    });

    const leaderboard = await service.getLeaderboard({ timeframe: '30D' });

    expect(leaderboard.rows.map((row) => row.slug)).toEqual(['beta', 'alpha']);
    expect(leaderboard.rows[0].pnlPct).toBe(80);
    expect(leaderboard.rows[1].pnlPct).toBe(20);
  });

  it('returns a safe 404 for private or missing trader profiles', async () => {
    socialRepository.findBySlug.mockResolvedValue({
      ...profileA,
      isPublic: false,
    });

    await expect(service.getTraderDetail('alpha')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('preserves source portfolio weights when creating copy proposals', async () => {
    socialRepository.findBySlug.mockResolvedValue(profileA);
    portfolioRepository.listSnapshots.mockResolvedValue([
      snapshot('wallet-a', 1000, now, [
        position('nvda', 'NVDA', 700, 70),
        position('aapl', 'AAPL', 300, 30),
        position('cash', 'CASH', 0, 0),
      ]),
    ]);
    execution.createBasketFromAllocations.mockImplementation((input) => ({
      id: 'basket-1',
      totalAmountUsd: input.totalAmountUsd,
      allocations: input.allocations,
      thesis: input.thesis,
      createdAt: new Date(now),
    }));

    const proposal = await service.prepareCopyPortfolio({
      sourceSlug: 'alpha',
      wallet: 'target-wallet',
      amountUsd: 100,
    });

    expect(proposal.allocations.map((allocation) => allocation.ticker)).toEqual([
      'NVDA',
      'AAPL',
    ]);
    expect(proposal.allocations.map((allocation) => allocation.amountUsd)).toEqual([
      69.6,
      30.4,
    ]);
    expect(proposal.skippedAssets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ticker: 'CASH' }),
      ]),
    );
  });

  it('rejects invalid signed visibility updates', async () => {
    const wallet = '11111111111111111111111111111111';
    const message = [
      'Oren social profile visibility',
      `Wallet: ${wallet}`,
      'Public: true',
      'Slug: alpha',
      'Display name: Alpha',
    ].join('\n');

    socialRepository.findByWallet.mockResolvedValue(null);

    await expect(
      service.updateVisibility(wallet, {
        isPublic: true,
        displayName: 'Alpha',
        slug: 'alpha',
        message,
        signature: 'bad-signature',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(socialRepository.upsertProfile).not.toHaveBeenCalled();
  });
});

function profileRow(walletAddress: string, slug: string, displayName: string) {
  return {
    id: `${slug}-id`,
    walletAddress,
    slug,
    displayName,
    avatarUrl: null,
    bio: null,
    isPublic: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function snapshot(
  walletAddress: string,
  totalValueUsd: number,
  timestampMs: number,
  positionsJson?: unknown[],
) {
  return {
    id: `${walletAddress}-${timestampMs}`,
    walletAddress,
    timestamp: new Date(timestampMs),
    totalValueUsd: String(totalValueUsd),
    availableValueUsd: String(totalValueUsd),
    lockedValueUsd: '0',
    positionsJson: positionsJson ?? [
      {
        assetId: 'nvda',
        ticker: 'NVDA',
        name: 'Nvidia',
        allocationPercent: 100,
        valueUsd: totalValueUsd,
      },
    ],
  };
}

function position(assetId: string, ticker: string, valueUsd: number, allocationPercent: number) {
  return {
    assetId,
    ticker,
    name: ticker,
    currentPrice: valueUsd || 0,
    changePercent: 0,
    quantity: 1,
    valueUsd,
    allocationPercent,
    availableAmount: 1,
    lockedAmount: 0,
    availableValueUsd: valueUsd,
    lockedValueUsd: 0,
    variants: [
      {
        variant: {
          mint: `${assetId}-mint`,
          symbol: ticker,
          name: ticker,
          tradable: true,
        },
        availableAmount: 1,
        lockedAmount: 0,
        totalAmount: 1,
      },
    ],
  };
}
