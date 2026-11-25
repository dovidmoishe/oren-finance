import type { AppEnv } from '../../config/env.schema';
import { GrowthRollupService } from './growth-rollup.service';
import type { GrowthRepository } from './growth.repository';

describe('growth rollup', () => {
  it('adds raw pageviews into the daily totals and deletes nothing else', async () => {
    const calls: string[] = [];
    const record = (name: string, value?: unknown) =>
      jest.fn(() => {
        calls.push(name);
        return Promise.resolve(value);
      });
    // Only these methods exist. Any other call, such as deleting visitor ids,
    // throws inside the tick and skips the checkpoint.
    const repository = {
      claimRollup: record('claim', { acquired: true, identitiesExact: true }),
      rollupPageviews: record('rollup'),
      markCheckpoint: record('checkpoint'),
      releaseRollup: record('release'),
    };
    const service = new GrowthRollupService(
      repository as unknown as GrowthRepository,
      { GROWTH_RAW_RETENTION_DAYS: 30 } as AppEnv,
    );

    await service.tick();

    expect(calls).toEqual(['claim', 'rollup', 'checkpoint', 'release']);
    const [now, cutoff, purgeBefore] = repository.rollupPageviews.mock
      .calls[0] as unknown as [Date, Date, Date];
    expect(now.getTime() - cutoff.getTime()).toBe(30 * 86_400_000);
    // Deletion stops at a day start before the cutoff, never after it.
    expect(purgeBefore.getTime()).toBeLessThanOrEqual(cutoff.getTime());
  });
});
