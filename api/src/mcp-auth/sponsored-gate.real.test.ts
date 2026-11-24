import { generateKeyPairSync, randomUUID, verify } from 'node:crypto';
import {
  formatRequestForAuthorizationSignature,
  generateAuthorizationSignature,
} from '@privy-io/node';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import {
  mcpDelegatedExecutions,
  mcpTradeDelegations,
  mcpTradeIntents,
} from '../database/schema';
import { SignerGateService } from '../signer-gate/signer-gate.service';
import { settleTradeBudget } from './trade-budget';

jest.mock('@privy-io/node', () =>
  jest.requireActual<typeof import('../test/privy-authorization.mock')>(
    '../test/privy-authorization.mock',
  ),
);
jest.mock('./trade-budget', () => ({
  ...jest.requireActual<typeof import('./trade-budget')>('./trade-budget'),
  settleTradeBudget: jest.fn(),
}));
function fixture(sponsored = true) {
  const apiKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const gateKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateKey = (key: typeof apiKeys.privateKey) =>
    key.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const walletAuth = new PrivyWalletAuth('app');
  const auth = {
    signingRequest: (...args: Parameters<PrivyWalletAuth['signingRequest']>) =>
      walletAuth.signingRequest(...args),
    sendSponsoredTransaction: jest
      .fn<
        ReturnType<PrivyWalletAuth['sendSponsoredTransaction']>,
        Parameters<PrivyWalletAuth['sendSponsoredTransaction']>
      >()
      .mockResolvedValue({
        signature: 'chain-signature',
        signedTransaction: undefined,
      }),
    findSponsoredTransaction: jest.fn().mockResolvedValue(undefined),
  };
  const execution = {
    id: randomUUID(),
    intentId: randomUUID(),
    state: 'challenged',
    unsignedTransaction: 'unsigned',
    requestExpiresAt: new Date(Date.now() + 30_000),
    chainSignature: null as string | null,
    signedTransaction: null as string | null,
    lastValidBlockHeight: 20,
    errorCode: null as string | null,
    privyRequest: {} as Record<string, unknown>,
  };
  execution.privyRequest = auth.signingRequest(
    'wallet-id',
    'unsigned',
    execution.id,
    execution.requestExpiresAt,
    sponsored,
  );
  const intent = {
    id: execution.intentId,
    delegationId: 'delegation',
    wallet: 'wallet',
    status: 'executing',
  };
  const delegation = { walletId: 'wallet-id', wallet: 'wallet' };
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows =
            table === mcpDelegatedExecutions
              ? [execution]
              : table === mcpTradeIntents
                ? [intent]
                : table === mcpTradeDelegations
                  ? [delegation]
                  : [];
          return Object.assign(Promise.resolve(rows), {
            limit: () => Promise.resolve(rows),
          });
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: object) => ({
        where: () => {
          const row = table === mcpDelegatedExecutions ? execution : intent;
          Object.assign(row, values);
          return Object.assign(Promise.resolve(), {
            returning: () => Promise.resolve([{ ...row }]),
          });
        },
      }),
    }),
  };
  const rpc = {
    status: jest.fn().mockResolvedValue(null),
    verifySponsored: jest.fn().mockResolvedValue('verified'),
    broadcast: jest.fn().mockResolvedValue('chain-signature'),
    validateSigned: jest.fn().mockReturnValue('chain-signature'),
    blockhashValid: jest.fn().mockResolvedValue(false),
  };
  const signTransaction = jest
    .fn()
    .mockResolvedValue({ signed_transaction: 'signed' });
  const config = {
    enabled: true,
    appId: 'app',
    gasSponsorship: true,
    simulationPayer: 'simulation-payer',
    apiPublicKeyDerBase64: apiKeys.publicKey
      .export({ format: 'der', type: 'spki' })
      .toString('base64'),
    gatePrivateKeyDerBase64: privateKey(gateKeys.privateKey),
  };
  const gate = new SignerGateService(
    config as never,
    {
      db,
      auth,
      rpc,
      privy: { wallets: () => ({ solana: () => ({ signTransaction }) }) },
    } as never,
  );
  const owned = jest
    .spyOn(
      gate as unknown as { ownedState(id: string): Promise<unknown> },
      'ownedState',
    )
    .mockResolvedValue({
      delegation,
      intent,
      policy: { rules: [{ method: 'signAndSendTransaction' }] },
    });
  const canonical = () =>
    Buffer.from(
      formatRequestForAuthorizationSignature(execution.privyRequest as never),
    );
  const signature = () =>
    generateAuthorizationSignature({
      authorizationPrivateKey: privateKey(apiKeys.privateKey),
      input: canonical(),
    });
  return {
    gate,
    execution,
    intent,
    rpc,
    auth,
    signTransaction,
    config,
    owned,
    signature,
    canonical,
    apiKeys,
    gateKeys,
  };
}
describe('sponsored MCP execution compatibility', () => {
  beforeEach(() => jest.clearAllMocks());
  it('uses two signatures for exactly the same canonical sponsored request and broadcasts only once', async () => {
    const f = fixture();
    const result = await f.gate.complete(f.execution.id, f.signature());
    expect(result).toMatchObject({
      state: 'broadcast',
      chainSignature: 'chain-signature',
    });
    expect(f.owned).toHaveBeenCalledTimes(1);
    const signatures = f.auth.sendSponsoredTransaction.mock.calls[0][1];
    expect(signatures).toHaveLength(2);
    expect(
      verify(
        'sha256',
        f.canonical(),
        f.apiKeys.publicKey,
        Buffer.from(signatures[0], 'base64'),
      ),
    ).toBe(true);
    expect(
      verify(
        'sha256',
        f.canonical(),
        f.gateKeys.publicKey,
        Buffer.from(signatures[1], 'base64'),
      ),
    ).toBe(true);
    await f.gate.complete(f.execution.id, f.signature());
    expect(f.auth.sendSponsoredTransaction).toHaveBeenCalledTimes(1);
    expect(f.rpc.broadcast).not.toHaveBeenCalled();
    expect(f.signTransaction).not.toHaveBeenCalled();
  });
  it('rejects invalid API signatures and inactive grants before sending', async () => {
    const f = fixture();
    await expect(f.gate.complete(f.execution.id, 'invalid')).rejects.toThrow(
      'signature',
    );
    f.owned.mockRejectedValue(new Error('revoked grant'));
    await expect(
      f.gate.complete(f.execution.id, f.signature()),
    ).rejects.toThrow('revoked');
    expect(f.auth.sendSponsoredTransaction).not.toHaveBeenCalled();
  });
  it('never releases an ambiguous sponsored send on the original blockhash expiry', async () => {
    const f = fixture();
    f.auth.sendSponsoredTransaction.mockRejectedValue(new Error('timeout'));
    await f.gate.complete(f.execution.id, f.signature());
    f.execution.requestExpiresAt = new Date(0);
    const result = await f.gate.reconcile(f.execution.id);
    expect(result.state).toBe('pending');
    expect(f.rpc.blockhashValid).not.toHaveBeenCalled();
    expect(settleTradeBudget).not.toHaveBeenCalled();
    expect(f.auth.sendSponsoredTransaction).toHaveBeenCalledTimes(1);
  });
  it('recovers read-only and verifies the transaction before settling its existing reservation', async () => {
    const f = fixture();
    f.execution.state = 'pending';
    f.auth.findSponsoredTransaction.mockResolvedValue('recovered-signature');
    f.rpc.status.mockResolvedValue({
      confirmationStatus: 'confirmed',
      err: null,
    });
    expect(await f.gate.reconcile(f.execution.id)).toMatchObject({
      state: 'confirmed',
      chainSignature: 'recovered-signature',
    });
    expect(f.rpc.verifySponsored).toHaveBeenCalledWith(
      'recovered-signature',
      'unsigned',
      'wallet',
    );
    expect(settleTradeBudget).toHaveBeenCalledWith(
      expect.anything(),
      f.execution.intentId,
      'confirmed',
    );
    expect(f.auth.sendSponsoredTransaction).not.toHaveBeenCalled();
  });
  it('does not settle success for changed landed instructions', async () => {
    const f = fixture();
    f.execution.state = 'broadcast';
    f.execution.chainSignature = 'chain-signature';
    f.rpc.status.mockResolvedValue({
      confirmationStatus: 'confirmed',
      err: null,
    });
    f.rpc.verifySponsored.mockRejectedValue(new Error('changed trade'));
    await expect(f.gate.reconcile(f.execution.id)).rejects.toThrow(
      'changed trade',
    );
    expect(settleTradeBudget).not.toHaveBeenCalled();
  });
  it('keeps the existing sign-only path for legacy challenges', async () => {
    const f = fixture(false);
    expect(await f.gate.complete(f.execution.id, f.signature())).toMatchObject({
      state: 'broadcast',
      chainSignature: 'chain-signature',
    });
    expect(f.signTransaction).toHaveBeenCalledTimes(1);
    expect(f.rpc.broadcast).toHaveBeenCalledTimes(1);
    expect(f.auth.sendSponsoredTransaction).not.toHaveBeenCalled();
  });
});
