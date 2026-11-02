import { dripToolsEnabled, type DripAccessConfig } from './drip-access';

const open: DripAccessConfig = {
  enabled: true,
  userIds: ['did:privy:owner'],
  emails: ['owner@example.com'],
};

describe('dripToolsEnabled', () => {
  it('stays off when the flag is off, even for an allowlisted caller', () => {
    expect(
      dripToolsEnabled(
        { ...open, enabled: false },
        { userId: 'did:privy:owner', email: 'owner@example.com' },
      ),
    ).toBe(false);
  });

  it('denies everyone when the allowlists are empty', () => {
    expect(
      dripToolsEnabled(
        { enabled: true, userIds: [], emails: [] },
        { userId: 'did:privy:owner', walletAddress: 'wallet' },
      ),
    ).toBe(false);
  });

  it('matches verified user identities but not a submitted wallet', () => {
    expect(dripToolsEnabled(open, { userId: 'did:privy:owner' })).toBe(true);
    expect(dripToolsEnabled(open, { email: ' Owner@Example.com ' })).toBe(true);
    expect(
      dripToolsEnabled(open, {
        walletAddress: 'So11111111111111111111111111111111111111112',
      }),
    ).toBe(false);
  });

  it('denies a caller who matches none of the lists', () => {
    expect(
      dripToolsEnabled(open, {
        userId: 'did:privy:other',
        email: 'other@example.com',
        walletAddress: 'not-the-owner',
      }),
    ).toBe(false);
  });

  it('opens free research only to a verified user when the separate provider gate is enabled', () => {
    const publicConfig = {
      ...open,
      publicResearch: true,
      userIds: [],
      emails: [],
    };
    expect(dripToolsEnabled(publicConfig, { userId: 'did:privy:anyone' })).toBe(
      true,
    );
    expect(
      dripToolsEnabled(publicConfig, { walletAddress: 'wallet-owner' }),
    ).toBe(false);
  });
});
