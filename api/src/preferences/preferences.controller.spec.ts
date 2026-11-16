import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/pg-proxy';
import type { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import type { Database } from '../database/database.provider';
import { PreferencesController } from './preferences.controller';
import { interestIds } from '../../types/sectors';

jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));

const draft = {
  sectors: ['energy', 'informationTechnology'],
  morningBrief: true,
  breakingNews: false,
  briefTime: '08:00',
  timeZone: 'Africa/Lagos',
};

function setup() {
  const rows = new Map<string, unknown[]>();
  const query = jest.fn((sql: string, params: unknown[]) => {
    const [userId, ...values] = params as [string, ...unknown[]];
    if (sql.startsWith('insert')) rows.set(userId, values.slice(0, 5));
    const row = rows.get(userId);
    return Promise.resolve({ rows: row ? [row] : [] });
  });
  const db = drizzle(query);
  const auth = {
    requireAccountIdentity: jest.fn((token?: string) => {
      if (token === 'Bearer alice')
        return Promise.resolve({
          userId: 'did:privy:alice',
          email: 'alice@example.test',
        });
      if (token === 'Bearer bob')
        return Promise.resolve({ userId: 'did:privy:bob' });
      return Promise.reject(new UnauthorizedException());
    }),
  };
  const controller = new PreferencesController(
    auth as unknown as PrivyWalletAuth,
    db as unknown as Database,
  );
  return { controller, query };
}

describe('account preferences', () => {
  it('stores one set per authenticated user and can revoke either opt-in independently', async () => {
    const { controller } = setup();
    const alice = 'Bearer alice';
    expect(await controller.get(alice)).toEqual({
      preferences: null,
      emailEligible: true,
      supportedInterests: interestIds,
    });
    expect(await controller.put(draft, alice)).toEqual({
      preferences: draft,
      emailEligible: true,
      supportedInterests: interestIds,
    });
    const update = {
      ...draft,
      morningBrief: false,
      breakingNews: true,
      briefTime: '17:45',
    };
    await controller.put(update, alice);
    expect(await controller.get(alice)).toEqual({
      preferences: update,
      emailEligible: true,
      supportedInterests: interestIds,
    });
    expect(await controller.get('Bearer bob')).toEqual({
      preferences: null,
      emailEligible: false,
      supportedInterests: interestIds,
    });
  });

  it('round-trips sector and theme selections without changing existing opt-ins', async () => {
    const { controller } = setup();
    const preferences = {
      ...draft,
      sectors: ['artificialIntelligence', 'semiconductors', 'energy'],
    };
    await controller.put(preferences, 'Bearer alice');
    expect(await controller.get('Bearer alice')).toEqual({
      preferences,
      emailEligible: true,
      supportedInterests: interestIds,
    });
  });

  it('rejects missing authorization and email opt-in without a verified email before reaching storage', async () => {
    const { controller, query } = setup();
    await expect(controller.get()).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(controller.put(draft)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(controller.put(draft, 'Bearer bob')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    { sectors: ['crypto'] },
    { sectors: ['energy', 'energy'] },
    { sectors: ['artificialIntelligence', 'artificialIntelligence'] },
    { sectors: ['artificialIntelligence', 'madeUpTheme'] },
    { morningBrief: 'true' },
    { briefTime: '24:00' },
    { timeZone: '+01:00' },
    { timeZone: 'Africa/Invalid' },
    { userId: 'did:privy:bob' },
    { email: 'other@example.test' },
  ])('rejects malformed or identity fields %p', async (change) => {
    const { controller, query } = setup();
    await expect(
      controller.put({ ...draft, ...change }, 'Bearer alice'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });
});
