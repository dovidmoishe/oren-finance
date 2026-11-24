import { ApprovalService } from './approval.service';
import type { ApprovalRow } from './approval.repository';
import type { AppEnv } from '../config/env.schema';
jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));
function fixture(status = 'prepared', env: Partial<AppEnv> = {}) {
  let row = {
    id: 'approval',
    userId: 'user',
    walletId: 'privy-wallet',
    wallet: 'wallet',
    kind: 'swap',
    referenceId: 'quote',
    executionId: 'execution',
    transaction: 'unsigned',
    signedTransaction: null,
    signature: null,
    status,
    details: { quote: { id: 'quote' } },
    feeLamports: '5000',
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
  } as ApprovalRow;
  const auth = {
    signingRequest: jest.fn().mockReturnValue({
      version: 1,
      method: 'POST',
      body: { transaction: 'unsigned' },
    }),
    requireWallet: jest.fn().mockResolvedValue('user'),
    requireApprovalWallet: jest.fn().mockResolvedValue({
      userId: 'user',
      walletId: 'privy-wallet',
      signingMode: 'privy',
      token: 'user-jwt',
    }),
    signTransaction: jest.fn().mockResolvedValue('signed'),
    sendSponsoredTransaction: jest
      .fn()
      .mockResolvedValue({ signature: 'sponsored-signature' }),
    findSponsoredTransaction: jest.fn().mockResolvedValue(undefined),
  };
  const approvals = {
    pending: jest.fn(() => Promise.resolve([{ ...row }])),
    get: jest.fn(() => Promise.resolve({ ...row })),
    create: jest.fn(() => Promise.resolve(row)),
    claim: jest.fn(() => {
      if (row.status !== 'prepared') return Promise.resolve(undefined);
      row = { ...row, status: 'signing' };
      return Promise.resolve({ ...row });
    }),
    patch: jest.fn((_id: string, patch: Partial<ApprovalRow>) => {
      row = { ...row, ...patch };
      return Promise.resolve({ ...row });
    }),
  };
  const rpc = {
    expiryHeight: jest.fn().mockResolvedValue(200),
    inspect: jest.fn().mockResolvedValue('5000'),
    validateSigned: jest.fn().mockReturnValue('signature'),
    broadcast: jest.fn().mockResolvedValue('signature'),
    status: jest.fn().mockResolvedValue(null),
    blockhashValid: jest.fn().mockResolvedValue(true),
    currentSlot: jest.fn().mockResolvedValue(100),
    verifySponsored: jest.fn().mockResolvedValue('verified-sponsored-bytes'),
  };
  const executedQuote = {
    id: 'quote',
    provider: 'jupiter',
    expiresAt: new Date(Date.now() + 60000),
    routePayload: { secret: 'route' },
  };
  const expectation = {
    inputMint: 'in',
    outputMint: 'out',
    maxInRaw: '100',
    minOutRaw: '99',
  };
  const execution = {
    prepareWithQuote: jest.fn().mockResolvedValue({
      prepared: {
        transaction: 'unsigned',
        executionId: 'execution',
        expiresAt: new Date(Date.now() + 60000),
      },
      quote: executedQuote,
      expectation,
    }),
  };
  const executions = {
    findById: jest.fn().mockResolvedValue({ status: 'awaiting_signature' }),
    submitAndEnqueue: jest.fn(),
    updateStatus: jest.fn(),
  };
  const cachedQuote = {
    quote: { id: 'quote', expiresAt: new Date(Date.now() + 60000) },
  };
  const quotes = {
    get: jest.fn().mockReturnValue(cachedQuote),
    peek: jest.fn().mockReturnValue(cachedQuote),
  };
  const orders = {
    upsert: jest.fn(),
    updateStatus: jest.fn(),
    findByOrderKey: jest.fn(),
  };
  const withdrawalStocks = {
    assertReviewed: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ApprovalService(
    auth as never,
    approvals as never,
    rpc as never,
    execution as never,
    executions as never,
    orders as never,
    quotes as never,
    {} as never,
    { SOLANA_NETWORK: 'mainnet', ...env } as never,
    withdrawalStocks as never,
  );
  return {
    service,
    withdrawalStocks,
    auth,
    approvals,
    rpc,
    execution,
    executions,
    orders,
    quotes,
    executedQuote,
    expectation,
    row: () => row,
    set: (patch: Partial<ApprovalRow>) => {
      row = { ...row, ...patch };
    },
  };
}
describe('server trade approvals', () => {
  function sponsoredFixture(status = 'prepared') {
    const f = fixture(status);
    f.set({
      details: { gasSponsorship: true, gasSimulationPayer: 'simulation-payer' },
      feeLamports: '0',
    });
    return f;
  }
  it('uses the same user approval with a sponsored send, never a second RPC broadcast', async () => {
    const f = sponsoredFixture();
    await f.service.authorizationRequest('Bearer token', 'approval');
    expect(f.auth.signingRequest).toHaveBeenCalledWith(
      'privy-wallet',
      'unsigned',
      'approval',
      expect.any(Date),
      true,
    );
    const result = await f.service.approve(
      'Bearer token',
      'approval',
      'owner-signature',
    );
    expect(result.status).toBe('submitted');
    expect(f.rpc.inspect).toHaveBeenCalledWith(
      'unsigned',
      'wallet',
      undefined,
      'simulation-payer',
    );
    expect(f.auth.sendSponsoredTransaction).toHaveBeenCalledWith(
      'privy-wallet',
      ['owner-signature'],
      'unsigned',
      'approval',
      expect.any(Date),
    );
    expect(f.auth.signTransaction).not.toHaveBeenCalled();
    expect(f.rpc.broadcast).not.toHaveBeenCalled();
    await f.service.approve('Bearer token', 'approval', 'owner-signature');
    expect(f.auth.sendSponsoredTransaction).toHaveBeenCalledTimes(1);
  });
  it('never sponsors without the exact user authorization', async () => {
    const f = sponsoredFixture();
    await expect(f.service.approve('Bearer token', 'approval')).rejects.toThrow(
      'Authorize',
    );
    expect(f.auth.sendSponsoredTransaction).not.toHaveBeenCalled();
  });
  it('keeps ambiguous sponsored sends pending beyond original transaction expiry', async () => {
    const f = sponsoredFixture();
    f.auth.sendSponsoredTransaction.mockRejectedValue(new Error('timeout'));
    await f.service.approve('Bearer token', 'approval', 'owner-signature');
    f.set({ expiresAt: new Date(0) });
    f.rpc.blockhashValid.mockResolvedValue(false);
    expect((await f.service.status('Bearer token', 'approval')).status).toBe(
      'signing',
    );
    await f.service.approve('Bearer token', 'approval', 'owner-signature');
    expect(f.auth.sendSponsoredTransaction).toHaveBeenCalledTimes(1);
    expect(f.rpc.blockhashValid).not.toHaveBeenCalled();
    expect(f.rpc.broadcast).not.toHaveBeenCalled();
  });
  it('recovers the hash read-only and verifies the landed trade before recording a fill', async () => {
    const f = sponsoredFixture('signing');
    f.auth.findSponsoredTransaction.mockResolvedValue('recovered-signature');
    f.rpc.status.mockResolvedValue({
      confirmationStatus: 'confirmed',
      err: null,
    });
    expect((await f.service.status('Bearer token', 'approval')).status).toBe(
      'confirmed',
    );
    expect(f.rpc.verifySponsored).toHaveBeenCalledWith(
      'recovered-signature',
      'unsigned',
      'wallet',
    );
    expect(f.executions.submitAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ transactionSignature: 'recovered-signature' }),
    );
    expect(f.auth.sendSponsoredTransaction).not.toHaveBeenCalled();
  });
  it('does not record success for a sponsored transaction with changed instructions', async () => {
    const f = sponsoredFixture('submitted');
    f.set({ signature: 'known-signature' });
    f.rpc.status.mockResolvedValue({
      confirmationStatus: 'confirmed',
      err: null,
    });
    f.rpc.verifySponsored.mockRejectedValue(new Error('changed instruction'));
    await expect(f.service.status('Bearer token', 'approval')).rejects.toThrow(
      'changed instruction',
    );
    expect(f.executions.submitAndEnqueue).not.toHaveBeenCalled();
    expect(f.row().status).toBe('submitted');
  });
  it('releases an explicitly rejected request without falling back to a user-paid send', async () => {
    const f = sponsoredFixture();
    f.auth.sendSponsoredTransaction.mockRejectedValue({ status: 403 });
    expect(
      (await f.service.approve('Bearer token', 'approval', 'owner-signature'))
        .status,
    ).toBe('failed');
    expect(f.auth.signTransaction).not.toHaveBeenCalled();
    expect(f.rpc.broadcast).not.toHaveBeenCalled();
  });
  it('ignores sponsorship metadata on withdrawals', async () => {
    const f = sponsoredFixture();
    f.set({ kind: 'withdrawal' });
    await f.service.approve('Bearer token', 'approval', 'owner-signature');
    expect(f.auth.sendSponsoredTransaction).not.toHaveBeenCalled();
    expect(f.auth.signTransaction).toHaveBeenCalledTimes(1);
  });
  it('keeps an uncertain prepared withdrawal pending until its approval expires', async () => {
    const f = fixture();
    f.set({ kind: 'withdrawal' });
    expect((await f.service.status('Bearer token', 'approval')).status).toBe(
      'prepared',
    );
    f.set({ expiresAt: new Date(0) });
    expect((await f.service.status('Bearer token', 'approval')).status).toBe(
      'failed',
    );
    expect(f.auth.signTransaction).not.toHaveBeenCalled();
    expect(f.rpc.broadcast).not.toHaveBeenCalled();
  });
  it('does not sign or broadcast a stock withdrawal after its share adjustment changes', async () => {
    const f = fixture();
    f.set({ kind: 'withdrawal', details: { asset: 'STOCK', mint: 'mint' } });
    f.withdrawalStocks.assertReviewed.mockRejectedValue(
      new Error('Share adjustment changed'),
    );
    await expect(
      f.service.approve('Bearer token', 'approval', 'owner-authorization'),
    ).rejects.toThrow('Share adjustment changed');
    expect(f.auth.signTransaction).not.toHaveBeenCalled();
    expect(f.rpc.broadcast).not.toHaveBeenCalled();
  });
  it('requires explicit authorization before signing a withdrawal', async () => {
    const f = fixture();
    f.set({ kind: 'withdrawal' });
    await expect(
      f.service.approve('Bearer token', 'approval'),
    ).rejects.toThrow();
    expect(f.auth.signTransaction).not.toHaveBeenCalled();
    expect(f.rpc.broadcast).not.toHaveBeenCalled();
  });
  it('confirms a withdrawal without treating it as a stock execution', async () => {
    const f = fixture('submitted');
    f.set({ kind: 'withdrawal', signature: 'signature' });
    f.rpc.status.mockResolvedValue({
      err: null,
      confirmationStatus: 'confirmed',
    });
    expect((await f.service.status('Bearer token', 'approval')).status).toBe(
      'confirmed',
    );
    expect(f.executions.updateStatus).not.toHaveBeenCalled();
    expect(f.orders.upsert).not.toHaveBeenCalled();
  });
  it('persists a signed withdrawal before broadcast and retries only those same bytes', async () => {
    const f = fixture();
    f.set({ kind: 'withdrawal' });
    f.rpc.broadcast.mockRejectedValueOnce(new Error('Lost response'));
    expect(
      (
        await f.service.approve(
          'Bearer token',
          'approval',
          'owner-authorization',
        )
      ).status,
    ).toBe('signed');
    expect(f.approvals.patch).toHaveBeenCalledWith(
      'approval',
      expect.objectContaining({
        status: 'signed',
        signedTransaction: 'signed',
      }),
      'signing',
    );
    expect(f.auth.signTransaction).toHaveBeenCalledTimes(1);
    await f.service.approve('Bearer token', 'approval');
    expect(f.auth.signTransaction).toHaveBeenCalledTimes(1);
    expect(f.rpc.broadcast.mock.calls).toEqual([['signed'], ['signed']]);
    expect(f.executions.updateStatus).not.toHaveBeenCalled();
  });
  it('binds the approval to the quote prepare executed, without re-reading the cache (H5)', async () => {
    const f = fixture();
    await f.service.prepare('Bearer token', {
      kind: 'swap',
      referenceId: 'quote',
      wallet: 'wallet',
    });
    expect(f.execution.prepareWithQuote).toHaveBeenCalledWith(
      {
        quoteId: 'quote',
        wallet: 'wallet',
      },
      'direct',
    );
    expect(f.quotes.peek).not.toHaveBeenCalled();
    expect(f.quotes.get).not.toHaveBeenCalled();
    const { routePayload: _omit, ...publicExecuted } = f.executedQuote;
    void _omit;
    expect(f.approvals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          quote: publicExecuted,
          expectation: f.expectation,
        }) as unknown,
      }),
    );
    // Route payloads never reach the approval row / client.
    const created = (f.approvals.create.mock.calls[0] as unknown[])[0] as {
      details: { quote: Record<string, unknown> };
    };
    expect(created.details.quote).not.toHaveProperty('routePayload');
  });
  it('caps approval validity at the route expiry from prepare', async () => {
    const f = fixture();
    const routeExpiry = new Date(Date.now() + 10_000);
    f.execution.prepareWithQuote.mockResolvedValueOnce({
      prepared: {
        transaction: 'unsigned',
        executionId: 'execution',
        expiresAt: routeExpiry,
        expiresAfterSlot: 500,
      },
      quote: f.executedQuote,
      expectation: f.expectation,
    });
    await f.service.prepare('Bearer token', {
      kind: 'swap',
      referenceId: 'quote',
      wallet: 'wallet',
    });
    expect(f.approvals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresAt: routeExpiry,
        details: expect.objectContaining({ expiresAfterSlot: 500 }) as unknown,
      }),
    );
  });
  it('re-checks balances against the reviewed expectation and the slot before signing', async () => {
    const f = fixture();
    f.set({
      details: {
        quote: { id: 'quote' },
        expectation: f.expectation,
        expiresAfterSlot: 150,
      },
    });
    await f.service.approve('Bearer token', 'approval', 'request-signature');
    expect(f.rpc.inspect).toHaveBeenCalledWith(
      'unsigned',
      'wallet',
      f.expectation,
    );
    expect(f.rpc.currentSlot).toHaveBeenCalled();
  });
  it('refuses to sign once the route slot has passed', async () => {
    const f = fixture();
    f.set({ details: { quote: { id: 'quote' }, expiresAfterSlot: 99 } });
    await expect(
      f.service.approve('Bearer token', 'approval', 'request-signature'),
    ).rejects.toThrow('expired');
    expect(f.auth.signTransaction).not.toHaveBeenCalled();
    expect(f.approvals.claim).not.toHaveBeenCalled();
  });
  it('checks fresh wallet ownership for status without reloading the signing wallet', async () => {
    const f = fixture('submitted');
    f.set({ signature: 'signature' });
    await f.service.status('Bearer token', 'approval');
    expect(f.auth.requireWallet).toHaveBeenCalledWith('Bearer token', 'wallet');
    expect(f.auth.requireApprovalWallet).not.toHaveBeenCalled();
    f.rpc.status.mockClear();
    f.auth.requireWallet.mockResolvedValueOnce('other-user');
    await expect(
      f.service.status('Bearer token', 'approval'),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.rpc.status).not.toHaveBeenCalled();
  });
  it('requires request authorization before signing and returns only the stored canonical request for authorization', async () => {
    const f = fixture();
    await expect(f.service.approve('Bearer token', 'approval')).rejects.toThrow(
      'Authorize this trade',
    );
    expect(f.auth.signTransaction).not.toHaveBeenCalled();
    expect(f.rpc.inspect).not.toHaveBeenCalled();
    await f.service.authorizationRequest('Bearer token', 'approval');
    expect(f.auth.signingRequest).toHaveBeenCalledWith(
      'privy-wallet',
      'unsigned',
      'approval',
      f.row().expiresAt,
    );
    f.set({ expiresAt: new Date(0) });
    f.auth.signingRequest.mockClear();
    await expect(
      f.service.authorizationRequest('Bearer token', 'approval'),
    ).rejects.toThrow('expired');
    expect(f.auth.signingRequest).not.toHaveBeenCalled();
  });
  it('does not submit when expiry recovery wins the atomic signed-state transition', async () => {
    const f = fixture();
    f.approvals.patch.mockResolvedValueOnce(undefined as never);
    await expect(
      f.service.approve('Bearer token', 'approval', 'request-signature'),
    ).rejects.toThrow('expired before submission');
    expect(f.approvals.patch).toHaveBeenCalledWith(
      'approval',
      expect.objectContaining({ status: 'signed' }),
      'signing',
    );
    expect(f.rpc.broadcast).not.toHaveBeenCalled();
  });
  it('recovers pending approvals only for the authenticated wallet without returning signing material', async () => {
    const f = fixture('signed');
    const rows = await f.service.pending('Bearer token', 'wallet');
    expect(f.auth.requireWallet).toHaveBeenCalledWith('Bearer token', 'wallet');
    expect(f.approvals.pending).toHaveBeenCalledWith('user', 'wallet');
    expect(rows[0]).not.toHaveProperty('transaction');
    expect(rows[0]).not.toHaveProperty('signedTransaction');
    expect(rows[0]).not.toHaveProperty('walletId');
    f.auth.requireWallet.mockRejectedValueOnce(new Error('unlinked'));
    f.approvals.pending.mockClear();
    await expect(f.service.pending('Bearer token', 'other')).rejects.toThrow(
      'unlinked',
    );
    expect(f.approvals.pending).not.toHaveBeenCalled();
    expect(f.auth.signTransaction).not.toHaveBeenCalled();
  });
  it('prepares a canonical server transaction without signing or submitting', async () => {
    const f = fixture();
    await f.service.prepare('Bearer token', {
      wallet: 'wallet',
      kind: 'swap',
      referenceId: 'quote',
    });
    expect(f.rpc.inspect).toHaveBeenCalledWith(
      'unsigned',
      'wallet',
      f.expectation,
    );
    expect(f.auth.signTransaction).not.toHaveBeenCalled();
    expect(f.rpc.broadcast).not.toHaveBeenCalled();
  });
  it('rejects another user or unlinked wallet before signing', async () => {
    const f = fixture();
    f.auth.requireApprovalWallet.mockResolvedValue({
      userId: 'other',
      walletId: 'privy-wallet',
      signingMode: 'privy',
      token: 'jwt',
    });
    await expect(
      f.service.approve('Bearer token', 'approval', 'request-signature'),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.auth.signTransaction).not.toHaveBeenCalled();
  });
  it('rejects expired approvals and simulation failures', async () => {
    const f = fixture();
    f.set({ expiresAt: new Date(0) });
    await expect(
      f.service.approve('Bearer token', 'approval', 'request-signature'),
    ).rejects.toMatchObject({ status: 400 });
    f.set({ expiresAt: new Date(Date.now() + 60000) });
    f.rpc.inspect.mockRejectedValueOnce(new Error('simulation failed'));
    await expect(
      f.service.approve('Bearer token', 'approval', 'request-signature'),
    ).rejects.toThrow('simulation failed');
    expect(f.auth.signTransaction).not.toHaveBeenCalled();
  });
  it('claims once and never signs twice on concurrent approvals', async () => {
    const f = fixture();
    const outcomes = await Promise.allSettled([
      f.service.approve('Bearer token', 'approval', 'request-signature'),
      f.service.approve('Bearer token', 'approval', 'request-signature'),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(f.auth.signTransaction).toHaveBeenCalledTimes(1);
    expect(f.rpc.broadcast).toHaveBeenCalledTimes(1);
    expect(f.approvals.patch.mock.calls[0][1]).toMatchObject({
      status: 'signed',
      signedTransaction: 'signed',
      signature: 'signature',
    });
  });
  it('never broadcasts a signature that changes the reviewed transaction', async () => {
    const f = fixture();
    f.rpc.validateSigned.mockImplementation(() => {
      throw new Error('message changed');
    });
    await expect(
      f.service.approve('Bearer token', 'approval', 'request-signature'),
    ).rejects.toThrow('message changed');
    expect(f.rpc.broadcast).not.toHaveBeenCalled();
    expect(f.row().status).toBe('failed');
  });
  it('preserves signed bytes after an uncertain send and retries only the same transaction', async () => {
    const f = fixture();
    f.rpc.broadcast.mockRejectedValueOnce(new Error('network timeout'));
    const pending = await f.service.approve(
      'Bearer token',
      'approval',
      'request-signature',
    );
    expect(pending.status).toBe('signed');
    const sent = await f.service.approve(
      'Bearer token',
      'approval',
      'request-signature',
    );
    expect(sent.status).toBe('submitted');
    expect(f.auth.signTransaction).toHaveBeenCalledTimes(1);
    expect(f.rpc.broadcast.mock.calls).toEqual([['signed'], ['signed']]);
    await f.service.approve('Bearer token', 'approval', 'request-signature');
    expect(f.rpc.broadcast).toHaveBeenCalledTimes(2);
  });
  it('retains the wallet lock while a signed transaction can still land', async () => {
    const f = fixture('signed');
    f.set({
      signature: 'signature',
      signedTransaction: 'signed',
      expiresAt: new Date(0),
    });
    expect((await f.service.status('Bearer token', 'approval')).status).toBe(
      'signed',
    );
    f.rpc.blockhashValid.mockResolvedValue(false);
    expect((await f.service.status('Bearer token', 'approval')).status).toBe(
      'failed',
    );
    expect(f.rpc.broadcast).not.toHaveBeenCalled();
  });
  it('clears an expired signing claim without submitting anything', async () => {
    const f = fixture('signing');
    f.set({ expiresAt: new Date(0) });
    expect((await f.service.status('Bearer token', 'approval')).status).toBe(
      'failed',
    );
    expect(f.rpc.broadcast).not.toHaveBeenCalled();
  });
  it('does not mark a limit order open until confirmation', async () => {
    const f = fixture('submitted');
    f.set({
      kind: 'limit',
      signature: 'signature',
      details: { orderKey: 'order', proposal: { expiredAt: 1900000000 } },
    });
    expect((await f.service.status('Bearer token', 'approval')).status).toBe(
      'submitted',
    );
    expect(f.orders.upsert).not.toHaveBeenCalled();
    f.rpc.status.mockResolvedValue({
      err: null,
      confirmationStatus: 'confirmed',
    });
    expect((await f.service.status('Bearer token', 'approval')).status).toBe(
      'confirmed',
    );
    expect(f.orders.upsert).toHaveBeenCalledTimes(1);
  });
});

describe('external wallet reviewed approvals', () => {
  function connected(status = 'prepared') {
    const f = fixture(status, { PRIVY_REVIEWED_GAS_SPONSORSHIP: true });
    f.auth.requireApprovalWallet.mockResolvedValue({
      userId: 'user',
      walletId: 'external:wallet',
      signingMode: 'external',
    });
    f.set({
      walletId: 'external:wallet',
      details: { signingMode: 'external' },
    });
    return f;
  }
  it('prepares external approvals without sponsorship and returns only canonical sign-only bytes', async () => {
    const f = connected();
    await f.service.prepare('Bearer token', {
      kind: 'swap',
      wallet: 'wallet',
      referenceId: 'quote',
    });
    expect(f.approvals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: 'external:wallet',
        details: expect.objectContaining({ signingMode: 'external' }) as Record<
          string,
          unknown
        >,
      }),
    );
    expect(f.approvals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.not.objectContaining({
          gasSponsorship: true,
        }) as Record<string, unknown>,
      }),
    );
    expect(
      await f.service.authorizationRequest('Bearer token', 'approval'),
    ).toEqual({
      signingMode: 'external',
      approvalId: 'approval',
      wallet: 'wallet',
      transaction: 'unsigned',
      expiresAt: f.row().expiresAt.toISOString(),
      network: 'mainnet',
    });
    expect(f.auth.signingRequest).not.toHaveBeenCalled();
    expect(f.auth.signTransaction).not.toHaveBeenCalled();
  });
  it.each(['swap', 'limit', 'cancel', 'withdrawal'])(
    'verifies and persists a %s signature before a single broadcast',
    async (kind) => {
      const f = connected();
      f.set({ kind });
      const result = await f.service.approve(
        'Bearer token',
        'approval',
        undefined,
        'external-signed',
      );
      expect(result.status).toBe('submitted');
      expect(f.rpc.validateSigned).toHaveBeenCalledWith(
        'unsigned',
        'external-signed',
        'wallet',
      );
      expect(f.rpc.inspect).toHaveBeenCalled();
      expect(f.approvals.patch).toHaveBeenCalledWith(
        'approval',
        expect.objectContaining({
          status: 'signed',
          signedTransaction: 'external-signed',
          signature: 'signature',
        }),
        'signing',
      );
      expect(f.approvals.patch.mock.invocationCallOrder[0]).toBeLessThan(
        f.rpc.broadcast.mock.invocationCallOrder[0],
      );
      if (kind === 'withdrawal')
        expect(f.withdrawalStocks.assertReviewed).toHaveBeenCalled();
      await f.service.approve(
        'Bearer token',
        'approval',
        undefined,
        'external-signed',
      );
      expect(f.rpc.broadcast).toHaveBeenCalledTimes(1);
      expect(f.auth.signTransaction).not.toHaveBeenCalled();
      expect(f.auth.sendSponsoredTransaction).not.toHaveBeenCalled();
    },
  );
  it('rejects missing signatures, Privy authorization, altered bytes and removed wallet ownership before claim', async () => {
    const f = connected();
    await expect(f.service.approve('Bearer token', 'approval')).rejects.toThrow(
      'Authorize',
    );
    await expect(
      f.service.approve('Bearer token', 'approval', 'privy-request'),
    ).rejects.toThrow('signing method');
    f.rpc.validateSigned.mockImplementation(() => {
      throw new Error('altered bytes');
    });
    await expect(
      f.service.approve('Bearer token', 'approval', undefined, 'altered'),
    ).rejects.toThrow('altered bytes');
    f.auth.requireApprovalWallet.mockRejectedValueOnce(new Error('unlinked'));
    await expect(
      f.service.approve(
        'Bearer token',
        'approval',
        undefined,
        'external-signed',
      ),
    ).rejects.toThrow('unlinked');
    expect(f.approvals.claim).not.toHaveBeenCalled();
    expect(f.rpc.broadcast).not.toHaveBeenCalled();
  });
  it('rejects another account and refuses externally signed bytes for an embedded approval', async () => {
    const f = connected();
    f.auth.requireApprovalWallet.mockResolvedValueOnce({
      userId: 'other',
      walletId: 'external:wallet',
      signingMode: 'external',
    });
    await expect(
      f.service.authorizationRequest('Bearer token', 'approval'),
    ).rejects.toMatchObject({ status: 403 });
    const embedded = fixture();
    await expect(
      embedded.service.approve(
        'Bearer token',
        'approval',
        undefined,
        'external-signed',
      ),
    ).rejects.toThrow('signing method');
    expect(embedded.auth.signTransaction).not.toHaveBeenCalled();
  });
  it('does not broadcast signatures after expiry or a failed balance/route recheck', async () => {
    const expired = connected();
    expired.set({ expiresAt: new Date(0) });
    await expect(
      expired.service.approve('Bearer token', 'approval', undefined, 'signed'),
    ).rejects.toThrow('expired');
    const failed = connected();
    failed.rpc.inspect.mockRejectedValueOnce(new Error('balance changed'));
    await expect(
      failed.service.approve('Bearer token', 'approval', undefined, 'signed'),
    ).rejects.toThrow('balance changed');
    const late = connected();
    late.rpc.inspect.mockImplementationOnce(() => {
      late.row().expiresAt.setTime(0);
      return Promise.resolve('5000');
    });
    await expect(
      late.service.approve('Bearer token', 'approval', undefined, 'signed'),
    ).rejects.toThrow('expired');
    expect(late.approvals.claim).not.toHaveBeenCalled();
    for (const f of [expired, failed, late])
      expect(f.rpc.broadcast).not.toHaveBeenCalled();
  });
  it('retries only persisted signed bytes after an uncertain broadcast, without prompting the wallet again', async () => {
    const f = connected();
    f.rpc.broadcast.mockRejectedValueOnce(new Error('timeout'));
    expect(
      (
        await f.service.approve(
          'Bearer token',
          'approval',
          undefined,
          'external-signed',
        )
      ).status,
    ).toBe('signed');
    await f.service.approve('Bearer token', 'approval');
    expect(f.rpc.broadcast.mock.calls).toEqual([
      ['external-signed'],
      ['external-signed'],
    ]);
    expect(f.auth.signTransaction).not.toHaveBeenCalled();
  });
});

describe('reviewed platform fee approval details', () => {
  it('persists the displayed fee and its net balance expectation', async () => {
    const f = fixture();
    const fee = { bps: 50, amountRaw: '50000', mint: 'usdc' };
    Object.assign(f.executedQuote, {
      platformFee: fee,
      platformFeeAccount: 'fee-destination',
      inputMint: 'stock',
      outputMint: 'usdc',
      variant: { mint: 'stock', decimals: 6 },
      routePayload: {
        inAmount: '10000000',
        outAmount: '9950000',
        otherAmountThreshold: '9900250',
        slippageBps: 50,
      },
      slippageBps: 50,
    });
    Object.assign(f.expectation, {
      platformFee: { account: 'fee-destination', minAmountRaw: '49750' },
    });
    await f.service.prepare('Bearer token', {
      kind: 'swap',
      referenceId: 'quote',
      wallet: 'wallet',
    });
    expect(f.approvals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          quote: expect.objectContaining({
            platformFee: fee,
            minimumOutputAmount: 9.90025,
          }) as Record<string, unknown>,
          expectation: f.expectation,
        }) as Record<string, unknown>,
      }),
    );
    expect(f.rpc.inspect).toHaveBeenCalledWith(
      'unsigned',
      'wallet',
      f.expectation,
    );
  });
});
