import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { formatRequestForAuthorizationSignature, generateAuthorizationSignature } from '@privy-io/node';
import authModule from '../dist/src/auth/privy-wallet-auth.js';
import gateModule from '../dist/src/signer-gate/signer-gate.service.js';

const { PrivyWalletAuth } = authModule;
const { SignerGateService } = gateModule;

function fixture() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const apiPrivate = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  const apiPublic = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const gatePrivate = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    .privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  const id = randomUUID();
  const walletId = 'wallet-proof';
  const unsigned = 'unsigned-transaction';
  const expiresAt = new Date(Date.now() + 30_000);
  const request = new PrivyWalletAuth('app-test', 'secret-test')
    .signingRequest(walletId, unsigned, id, expiresAt);
  const execution = {
    id, intentId: randomUUID(), idempotencyKey: 'proof-idempotency-key',
    state: 'challenged', unsignedTransaction: unsigned,
    privyRequest: request, requestExpiresAt: expiresAt,
    signedTransaction: null, chainSignature: null,
  };
  const events = [];
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [execution] }) }) }),
    update: () => ({ set: (values) => ({ where: () => {
      Object.assign(execution, values);
      events.push(`persist:${String(values.state ?? 'intent')}`);
      return { returning: async () => [execution], then: (resolve) => resolve(execution) };
    } }) }),
  };
  let signCalls = 0;
  let broadcastCalls = 0;
  let sign = async () => { throw new Error('unconfigured'); };
  let broadcast = async () => { throw new Error('unconfigured'); };
  const config = {
    enabled: true, appId: 'app-test', appSecret: 'secret-test',
    apiPublicKeyDerBase64: apiPublic, gatePrivateKeyDerBase64: gatePrivate,
    signerQuorumId: 'quorum-test', policyId: 'policy-test',
    policyOwnerId: 'owner-test', policyHash: 'hash-test',
    allowedUsers: new Set(['user-test']), buysEnabled: true, sellsEnabled: false,
  };
  const service = new SignerGateService(config, {
    db, privy: { wallets: () => ({ solana: () => ({ signTransaction: async (...args) => {
      signCalls++;
      return sign(...args);
    } }) }) },
    rpc: { validateSigned: () => 'chain-signature', broadcast: async (...args) => {
      broadcastCalls++;
      return broadcast(...args);
    } },
  });
  service.ownedState = async () => ({ delegation: { walletId, wallet: 'wallet-proof-address' } });
  const apiSignature = generateAuthorizationSignature({ authorizationPrivateKey: apiPrivate,
    input: formatRequestForAuthorizationSignature(request) });
  return { service, execution, events, apiSignature, apiPrivate,
    get signCalls() { return signCalls; }, get broadcastCalls() { return broadcastCalls; },
    setSign: (value) => { sign = value; }, setBroadcast: (value) => { broadcast = value; } };
}

test('Privy timeout stays pending and duplicate calls never sign replacement bytes', async () => {
  const f = fixture();
  f.setSign(async () => { throw new Error('timeout'); });
  assert.equal((await f.service.complete(f.execution.id, f.apiSignature)).state, 'pending');
  assert.equal(f.execution.state, 'pending');
  assert.equal(f.execution.errorCode, 'privy_uncertain');
  assert.equal((await f.service.complete(f.execution.id, f.apiSignature)).submissionState, 'not_broadcast');
  assert.equal(f.broadcastCalls, 0);
  assert.equal((await f.service.complete(f.execution.id, f.apiSignature)).state, 'pending');
  assert.equal(f.signCalls, 1);
});

test('Privy HTTP rejection remains reserved, explains signing stage and never broadcasts or retries', async () => {
  const f = fixture();
  f.setSign(async () => { throw Object.assign(new Error('secret provider body'), {status:403}); });
  const first = await f.service.complete(f.execution.id, f.apiSignature);
  assert.equal(first.reason, 'signing_rejected');
  assert.equal(first.submissionState, 'not_broadcast');
  assert.equal(f.execution.errorCode, 'privy_rejected_403');
  const duplicate = await f.service.complete(f.execution.id, f.apiSignature);
  assert.equal(duplicate.reason, 'signing_rejected');
  assert.equal(f.signCalls, 1);
  assert.equal(f.broadcastCalls, 0);
});

test('signed bytes are persisted before broadcast uncertainty', async () => {
  const f = fixture();
  f.setSign(async () => ({ signed_transaction: 'same-signed-bytes' }));
  f.setBroadcast(async () => {
    assert.equal(f.execution.signedTransaction, 'same-signed-bytes');
    f.events.push('broadcast');
    throw new Error('RPC timeout');
  });
  const result = await f.service.complete(f.execution.id, f.apiSignature);
  assert.equal(result.state, 'pending');
  assert.equal(result.chainSignature, 'chain-signature');
  assert.ok(f.events.indexOf('persist:signed') < f.events.indexOf('broadcast'));
  assert.equal(f.execution.signedTransaction, 'same-signed-bytes');
  assert.equal(f.signCalls, 1);
});

test('signature over a different canonical request is rejected', async () => {
  const f = fixture();
  const changed = { ...f.execution.privyRequest,
    body: { ...f.execution.privyRequest.body,
      params: { transaction: 'other-transaction', encoding: 'base64' } } };
  const wrong = generateAuthorizationSignature({ authorizationPrivateKey: f.apiPrivate,
    input: formatRequestForAuthorizationSignature(changed) });
  await assert.rejects(f.service.complete(f.execution.id, wrong),
    /API authorization signature is invalid/);
  assert.equal(f.signCalls, 0);
});
