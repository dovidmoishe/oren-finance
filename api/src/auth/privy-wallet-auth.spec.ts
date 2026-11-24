import { PrivyWalletAuth } from './privy-wallet-auth';
import { Logger } from '@nestjs/common';
import bs58 from 'bs58';
import { SPONSORED_SOLANA_CHAIN } from '../execution/gas-sponsorship';

const verify = jest.fn();
const getUser = jest.fn();
const getWallet = jest.fn();
const signTransaction = jest.fn();
const signAndSendTransaction = jest.fn();
jest.mock('@privy-io/node', () => ({
  PrivyClient: jest.fn().mockImplementation(() => ({
    utils: () => ({ auth: () => ({ verifyAccessToken: verify }) }),
    users: () => ({ _get: getUser }),
    wallets: () => ({
      get: getWallet,
      solana: () => ({ signTransaction, signAndSendTransaction }),
    }),
  })),
}));

describe('PrivyWalletAuth', () => {
  const auth = new PrivyWalletAuth('app', 'secret');
  beforeEach(() => {
    jest.resetAllMocks();
    verify.mockResolvedValue({ user_id: 'did:privy:user' });
    getUser.mockResolvedValue({
      linked_accounts: [
        { type: 'wallet', chain_type: 'solana', address: 'owned' },
        { type: 'wallet', chain_type: 'ethereum', address: 'other-chain' },
      ],
    });
  });
  it('binds sponsorship, mainnet, reference and both quorum signatures to one request', async () => {
    const signature = bs58.encode(new Uint8Array(64).fill(7));
    signAndSendTransaction.mockResolvedValue({
      hash: signature,
      caip2: SPONSORED_SOLANA_CHAIN,
    });
    const expiry = new Date(Date.now() + 30_000);
    expect(
      auth.signingRequest('wallet-id', 'unsigned', 'reference', expiry, true)
        .body,
    ).toEqual({
      method: 'signAndSendTransaction',
      chain_type: 'solana',
      caip2: SPONSORED_SOLANA_CHAIN,
      sponsor: true,
      reference_id: 'reference',
      params: { transaction: 'unsigned', encoding: 'base64' },
    });
    await expect(
      auth.sendSponsoredTransaction(
        'wallet-id',
        ['api', 'gate'],
        'unsigned',
        'reference',
        expiry,
      ),
    ).resolves.toMatchObject({ signature });
    expect(signAndSendTransaction).toHaveBeenCalledWith('wallet-id', {
      transaction: 'unsigned',
      caip2: SPONSORED_SOLANA_CHAIN,
      sponsor: true,
      reference_id: 'reference',
      authorization_context: { signatures: ['api', 'gate'] },
      idempotency_key: 'reference',
      request_expiry: expiry.getTime(),
    });
    expect(signTransaction).not.toHaveBeenCalled();
  });
  it('recovers only a uniquely matching sponsored mainnet wallet transaction without sending', async () => {
    const signature = bs58.encode(new Uint8Array(64).fill(6));
    const match = {
      wallet_id: 'wallet-id',
      reference_id: 'reference',
      caip2: SPONSORED_SOLANA_CHAIN,
      sponsored: true,
      transaction_hash: signature,
    };
    const fetcher = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ transactions: [match] })),
      );
    try {
      await expect(
        auth.findSponsoredTransaction('wallet-id', 'reference'),
      ).resolves.toBe(signature);
      expect(fetcher.mock.calls[0][0]).toBe(
        'https://api.privy.io/v1/transactions?reference_id=reference',
      );
      for (const mismatch of [
        { wallet_id: 'other' },
        { reference_id: 'other' },
        { sponsored: false },
        { caip2: 'solana:devnet' },
      ]) {
        fetcher.mockResolvedValueOnce(
          new Response(
            JSON.stringify({ transactions: [{ ...match, ...mismatch }] }),
          ),
        );
        await expect(
          auth.findSponsoredTransaction('wallet-id', 'reference'),
        ).rejects.toThrow('mismatch');
      }
      fetcher.mockResolvedValueOnce(
        new Response(JSON.stringify({ transactions: [match, match] })),
      );
      await expect(
        auth.findSponsoredTransaction('wallet-id', 'reference'),
      ).rejects.toThrow('Ambiguous');
      fetcher.mockResolvedValueOnce(
        new Response(JSON.stringify({ transactions: [] })),
      );
      await expect(
        auth.findSponsoredTransaction('wallet-id', 'reference'),
      ).resolves.toBeUndefined();
      expect(signAndSendTransaction).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
    }
  });

  it('requires configuration and a bearer token', async () => {
    await expect(
      new PrivyWalletAuth().requireWallet('Bearer token', 'owned'),
    ).rejects.toMatchObject({ status: 503 });
    await expect(auth.requireWallet(undefined, 'owned')).rejects.toMatchObject({
      status: 401,
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects invalid tokens and mismatched wallets', async () => {
    verify.mockRejectedValueOnce(new Error('bad token'));
    await expect(
      auth.requireWallet('Bearer token', 'owned'),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      auth.requireWallet('Bearer token', 'other-chain'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      auth.requireWallet('Bearer token', 'unlinked'),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('fails closed when the user lookup fails', async () => {
    getUser.mockRejectedValueOnce(new Error('unavailable'));
    await expect(
      auth.requireWallet('Bearer token', 'owned'),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('identifies a bearer session and ignores a bad token', async () => {
    getUser.mockResolvedValueOnce({
      email: { address: 'owner@example.com' },
      linked_accounts: [],
    });
    await expect(auth.tryIdentify('Bearer token')).resolves.toEqual({
      userId: 'did:privy:user',
      email: 'owner@example.com',
    });
    verify.mockRejectedValueOnce(new Error('bad token'));
    await expect(auth.tryIdentify('Bearer token')).resolves.toBeUndefined();
    await expect(auth.tryIdentify(undefined)).resolves.toBeUndefined();
  });

  it('accepts a verified linked Solana wallet', async () => {
    await expect(auth.requireWallet('Bearer token', 'owned')).resolves.toBe(
      'did:privy:user',
    );
    expect(getUser).toHaveBeenCalledWith('did:privy:user');
  });
  it('supports external reviewed approvals without making the external wallet a server signer', async () => {
    await expect(
      auth.requireApprovalWallet('Bearer token', 'owned'),
    ).resolves.toEqual({
      userId: 'did:privy:user',
      walletId: 'external:owned',
      signingMode: 'external',
    });
    expect(getWallet).not.toHaveBeenCalled();
    await expect(
      auth.requireSigner('Bearer token', 'owned'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      auth.requireApprovalWallet('Bearer token', 'unlinked'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      auth.requireApprovalWallet(undefined, 'owned'),
    ).rejects.toMatchObject({ status: 401 });
  });
  it('uses a verified linked external wallet for email holdings without querying Privy wallet signing APIs', async () => {
    getUser.mockResolvedValue({
      linked_accounts: [
        { type: 'email', address: 'owner@example.test', verified_at: 1 },
        {
          type: 'wallet',
          chain_type: 'solana',
          wallet_client_type: 'phantom',
          address: 'external',
          verified_at: 2,
        },
      ],
    });
    await expect(
      auth.getNotificationIdentity('did:privy:user'),
    ).resolves.toEqual({ email: 'owner@example.test', wallet: 'external' });
    expect(getWallet).not.toHaveBeenCalled();
    await expect(
      auth.getNotificationIdentity('did:privy:user', 'unlinked'),
    ).resolves.toEqual({ email: 'owner@example.test', wallet: undefined });
  });
  it('binds research identity to the verified linked wallet', async () => {
    await expect(
      auth.requireResearchIdentity('Bearer token', 'owned'),
    ).resolves.toMatchObject({
      userId: 'did:privy:user',
      walletAddress: 'owned',
    });
    await expect(
      auth.requireResearchIdentity('Bearer token', 'unlinked'),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('requires an embedded wallet ID and matches its canonical address', async () => {
    await expect(
      auth.requireSigner('Bearer token', 'owned'),
    ).rejects.toMatchObject({ status: 403 });
    getUser.mockResolvedValue({
      linked_accounts: [
        {
          type: 'wallet',
          chain_type: 'solana',
          address: 'owned',
          wallet_client_type: 'privy',
          id: 'wallet-id',
        },
      ],
    });
    getWallet.mockResolvedValue({ chain_type: 'solana', address: 'owned' });
    getUser.mockClear();
    await expect(auth.requireSigner('Bearer token', 'owned')).resolves.toEqual({
      userId: 'did:privy:user',
      walletId: 'wallet-id',
      token: 'token',
    });
    expect(getUser).toHaveBeenCalledTimes(1);
    // A subsequent request must recheck current links, not use a cached owner.
    getUser.mockResolvedValueOnce({ linked_accounts: [] });
    await expect(
      auth.requireSigner('Bearer token', 'owned'),
    ).rejects.toMatchObject({ status: 403 });
    getWallet.mockResolvedValue({
      chain_type: 'solana',
      address: 'someone-else',
    });
    await expect(
      auth.requireSigner('Bearer token', 'owned'),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('authorizes sign-only with the exact request signature and approval idempotency key', async () => {
    const warning = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    signTransaction.mockResolvedValue({ signed_transaction: 'signed' });
    const expiry = new Date(Date.now() + 60000);
    await expect(
      auth.signTransaction(
        'wallet-id',
        'token',
        'unsigned',
        'approval-id',
        expiry,
      ),
    ).resolves.toBe('signed');
    expect(signTransaction).toHaveBeenCalledWith('wallet-id', {
      transaction: 'unsigned',
      authorization_context: { signatures: ['token'] },
      idempotency_key: 'approval-id',
      request_expiry: expiry.getTime(),
    });
    signTransaction.mockRejectedValue(
      new Error('secret-sdk-request-with-token'),
    );
    await expect(
      auth.signTransaction(
        'wallet-id',
        'token',
        'unsigned',
        'approval-id',
        expiry,
      ),
    ).rejects.toThrow('Privy could not authorize');
    expect(warning.mock.calls.flat().join(' ')).not.toContain(
      'secret-sdk-request-with-token',
    );
    warning.mockRestore();
  });
  it('returns a definite pre-submission failure and logs only safe provider metadata', async () => {
    const warning = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    signTransaction.mockRejectedValue({
      status: 403,
      error: { code: 'authorization_denied', message: 'private-request-token' },
      headers: new Headers({
        'x-request-id': 'request-123',
        authorization: 'private-request-token',
      }),
    });
    try {
      await auth.signTransaction(
        'wallet-id',
        'user-secret-token',
        'unsigned',
        'approval-id',
        new Date(Date.now() + 60000),
      );
      throw new Error('Expected refusal');
    } catch (error) {
      expect((error as { getResponse(): unknown }).getResponse()).toEqual(
        expect.objectContaining({
          code: 'PRIVY_SIGNING_FAILED',
          submissionState: 'not_submitted',
        }),
      );
      expect(warning.mock.calls.flat().join(' ')).toContain(
        'status=403 code=authorization_denied requestId=request-123',
      );
      expect(warning.mock.calls.flat().join(' ')).not.toMatch(
        /private-request-token|user-secret-token/,
      );
    } finally {
      warning.mockRestore();
    }
  });
});
