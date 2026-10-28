import { PrivyWalletAuth } from './privy-wallet-auth';

const verify = jest.fn();
const getUser = jest.fn();
jest.mock('@privy-io/node', () => ({
  PrivyClient: jest.fn().mockImplementation(() => ({
    utils: () => ({ auth: () => ({ verifyAccessToken: verify }) }),
    users: () => ({ _get: getUser }),
  })),
}));

describe('PrivyWalletAuth', () => {
  const auth = new PrivyWalletAuth('app', 'secret');
  beforeEach(() => {
    jest.resetAllMocks();
    verify.mockResolvedValue({ user_id: 'did:privy:user' });
    getUser.mockResolvedValue({ linked_accounts: [
      { type: 'wallet', chain_type: 'solana', address: 'owned' },
      { type: 'wallet', chain_type: 'ethereum', address: 'other-chain' },
    ] });
  });

  it('requires configuration and a bearer token', async () => {
    await expect(new PrivyWalletAuth().requireWallet('Bearer token', 'owned')).rejects.toMatchObject({ status: 503 });
    await expect(auth.requireWallet(undefined, 'owned')).rejects.toMatchObject({ status: 401 });
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects invalid tokens and mismatched wallets', async () => {
    verify.mockRejectedValueOnce(new Error('bad token'));
    await expect(auth.requireWallet('Bearer token', 'owned')).rejects.toMatchObject({ status: 401 });
    await expect(auth.requireWallet('Bearer token', 'other-chain')).rejects.toMatchObject({ status: 403 });
    await expect(auth.requireWallet('Bearer token', 'unlinked')).rejects.toMatchObject({ status: 403 });
  });

  it('fails closed when the user lookup fails', async () => {
    getUser.mockRejectedValueOnce(new Error('unavailable'));
    await expect(auth.requireWallet('Bearer token', 'owned')).rejects.toMatchObject({ status: 503 });
  });

  it('accepts a verified linked Solana wallet', async () => {
    await expect(auth.requireWallet('Bearer token', 'owned')).resolves.toBe('did:privy:user');
    expect(getUser).toHaveBeenCalledWith('did:privy:user');
  });
});
