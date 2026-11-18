import { BadRequestException } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';

describe('portfolio chart history', () => {
  const now = new Date('2026-11-18T12:00:00Z');
  const wallet = '11111111111111111111111111111111';
  const snapshot = (daysAgo: number) => ({
    timestamp: new Date(now.getTime() - daysAgo * 86_400_000),
    totalValueUsd: String(1000 + daysAgo),
    availableValueUsd: '900',
    lockedValueUsd: '100',
  });
  const snapshots = [400, 365, 100, 90, 30, 7, 2, 1, 0.5].map(snapshot);
  let repository: { listSnapshots: jest.Mock; listSnapshotsInRange: jest.Mock };
  let service: PortfolioService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    repository = {
      listSnapshots: jest.fn().mockResolvedValue([...snapshots].reverse()),
      listSnapshotsInRange: jest
        .fn()
        .mockImplementation((_wallet, start: Date, end: Date) =>
          Promise.resolve(
            snapshots.filter(
              (row) => row.timestamp >= start && row.timestamp < end,
            ),
          ),
        ),
    };
    service = new PortfolioService(
      {} as never,
      {} as never,
      repository as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  it.each([
    ['1D', 1],
    ['1W', 7],
    ['1M', 30],
    ['3M', 90],
    ['1Y', 365],
  ] as const)(
    'returns only recorded snapshots in %s, oldest first',
    async (range, days) => {
      const history = await service.getHistory(wallet, range);
      const start = new Date(now.getTime() - days * 86_400_000);
      expect(repository.listSnapshotsInRange).toHaveBeenCalledWith(
        wallet,
        start,
        now,
      );
      expect(repository.listSnapshots).not.toHaveBeenCalled();
      expect(history.points).toEqual(
        snapshots
          .filter((row) => row.timestamp >= start)
          .map((row) => ({
            ...row,
            totalValueUsd: Number(row.totalValueUsd),
            availableValueUsd: 900,
            lockedValueUsd: 100,
          })),
      );
    },
  );

  it('preserves the legacy history order when no range is requested', async () => {
    const history = await service.getHistory(wallet);
    expect(repository.listSnapshots).toHaveBeenCalledWith(wallet);
    expect(history.points.map((point) => point.timestamp)).toEqual(
      snapshots.map((row) => row.timestamp),
    );
  });

  it('returns no invented points when a range has no snapshots', async () => {
    repository.listSnapshotsInRange.mockResolvedValue([]);
    await expect(service.getHistory(wallet, '1D')).resolves.toEqual({
      walletAddress: wallet,
      points: [],
    });
  });

  it('rejects invalid ranges before querying history', async () => {
    await expect(
      service.getHistory(wallet, 'invalid' as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.listSnapshots).not.toHaveBeenCalled();
    expect(repository.listSnapshotsInRange).not.toHaveBeenCalled();
  });
});
