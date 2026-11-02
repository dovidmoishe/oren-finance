import { dripToolsEnabled, type DripAccessConfig } from './drip-access';

const open: DripAccessConfig = {
  enabled: true,
  userIds: ['did:privy:owner'],
  emails: ['owner@example.com'],
  wallets: ['So11111111111111111111111111111111111111112'],
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
        { enabled: true, userIds: [], emails: [], wallets: [] },
        { userId: 'did:privy:owner', walletAddress: 'wallet' },
      ),
    ).toBe(false);
  });

  it('matches a Privy user id, an email, or the connected wallet', () => {
    expect(dripToolsEnabled(open, { userId: 'did:privy:owner' })).toBe(true);
    expect(dripToolsEnabled(open, { email: ' Owner@Example.com ' })).toBe(true);
    expect(
      dripToolsEnabled(open, {
        walletAddress: 'So11111111111111111111111111111111111111112',
      }),
    ).toBe(true);
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
});
