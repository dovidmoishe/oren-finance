import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';

const require = createRequire(import.meta.url);
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../services/external-approval.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, require, Uint8Array, atob, btoa, Date });
const { signExternalApproval } = exports;

function review() {
  const owner = Keypair.generate();
  const transaction = new VersionedTransaction(new TransactionMessage({
    payerKey: owner.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })],
  }).compileToV0Message());
  const request = { signingMode: 'external', approvalId: 'review', wallet: owner.publicKey.toBase58(),
    transaction: Buffer.from(transaction.serialize()).toString('base64'), network: 'mainnet', expiresAt: new Date(Date.now() + 60000).toISOString() };
  return { owner, transaction, request };
}

test('external approval signs the exact reviewed bytes without broadcasting', async () => {
  const { owner, request } = review();
  let prompts = 0;
  const result = await signExternalApproval(request, 'review', request.wallet, () => true, async bytes => {
    prompts++;
    assert.equal(Buffer.from(bytes).toString('base64'), request.transaction);
    const signed = VersionedTransaction.deserialize(bytes);
    signed.sign([owner]);
    return signed.serialize();
  });
  const signed = VersionedTransaction.deserialize(Buffer.from(result.signedTransaction, 'base64'));
  assert.ok(signed.signatures[0].some(byte => byte !== 0));
  assert.equal(prompts, 1);
});

test('sign-only connector signatures are attached to the original transaction', async () => {
  const { owner, transaction, request } = review();
  transaction.sign([owner]);
  const result = await signExternalApproval(request, 'review', request.wallet, () => true, async () => transaction.signatures[0]);
  assert.equal(result.signedTransaction, Buffer.from(transaction.serialize()).toString('base64'));
});

test('wallet rejection is propagated once without retry or fallback', async () => {
  const { request } = review();
  let prompts = 0;
  await assert.rejects(signExternalApproval(request, 'review', request.wallet, () => true, async () => {
    prompts++; throw new Error('user rejected');
  }), /user rejected/);
  assert.equal(prompts, 1);
});

test('account change or disconnect during the wallet prompt discards the signature', async () => {
  const { request, transaction, owner } = review();
  let current = true;
  await assert.rejects(signExternalApproval(request, 'review', request.wallet, () => current, async () => {
    transaction.sign([owner]); current = false; return transaction.serialize();
  }), /Nothing was submitted/);
});

test('expired, wrong-wallet, wrong-approval and wrong-network requests never open the wallet', async () => {
  const { request } = review();
  const prompt = async () => { assert.fail('must not prompt'); };
  for (const patch of [{ expiresAt: new Date(0).toISOString() }, { wallet: Keypair.generate().publicKey.toBase58() },
    { approvalId: 'other' }, { network: 'devnet' }, { expiresAt: 'invalid' }]) {
    await assert.rejects(signExternalApproval({ ...request, ...patch }, 'review', request.wallet, () => true, prompt), /Review again/);
  }
});

test('a wallet cannot replace the reviewed recipient, amount or blockhash', async () => {
  const { request } = review();
  const different = review();
  await assert.rejects(signExternalApproval(request, 'review', request.wallet, () => true, async () => different.transaction.serialize()), /changed the reviewed transaction/);
});

test('a transaction with a different fee payer is rejected before prompting', async () => {
  const { request } = review();
  const other = review();
  await assert.rejects(signExternalApproval({ ...request, transaction: other.request.transaction }, 'review', request.wallet, () => true,
    async () => { assert.fail('must not prompt'); }), /selected wallet/);
});

test('approval requests send external signed bytes separately from Privy authorization and retries', async () => {
  const service = {};
  const requests = [];
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../services/approval-service.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: service, window: { localStorage: { getItem: () => '[]', setItem() {} }, dispatchEvent() {} }, Event,
    require(id) { if (id === './api-client') return { apiRequest: async (path, options) => { requests.push({ path, ...options }); } }; throw new Error(id); } });
  await service.approveServerTrade('review', 'token', 'wallet', { signedTransaction: 'signed-by-wallet' });
  assert.equal(requests[0].body.approved, true);
  assert.equal(requests[0].body.signedTransaction, 'signed-by-wallet');
  assert.equal(requests[0].body.authorizationSignature, undefined);
  await service.approveServerTrade('review', 'token', 'wallet', 'privy-authorization');
  assert.equal(requests[1].body.authorizationSignature, 'privy-authorization');
  assert.equal(requests[1].body.signedTransaction, undefined);
  await service.approveServerTrade('review', 'token', 'wallet');
  assert.deepEqual(Object.keys(requests[2].body), ['approved']);
});
