import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { Keypair, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
const require = createRequire(import.meta.url);
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/execution/approval-rpc.service.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, esModuleInterop: true },
}).outputText, { exports, Buffer, require(id) { return id === '../alchemy/alchemy.client' ? { AlchemyClient: class {} } : require(id); } });
const rpc = new exports.ApprovalRpc({ call() { throw new Error('No network calls allowed'); } });
test('does not treat a recent blockhash absent from the finalized bank as expired', async () => {
  const owner = Keypair.generate();
  const tx = new Transaction({ feePayer: owner.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
  const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  let finalizedHeight = 100;
  const calls = [];
  const service = new exports.ApprovalRpc({ async call(method) { calls.push(method); return method === 'getBlockHeight' ? finalizedHeight : { value: false }; } });
  assert.equal(await service.blockhashValid(bytes, owner.publicKey.toBase58()), true);
  assert.equal(await service.blockhashValid(bytes, owner.publicKey.toBase58(), 150), true);
  assert.deepEqual(calls, ['getBlockHeight']);
  finalizedHeight = 151;
  assert.equal(await service.blockhashValid(bytes, owner.publicKey.toBase58(), 150), false);
  assert.deepEqual(calls, ['getBlockHeight', 'getBlockHeight', 'isBlockhashValid']);
});
for (const version of ['legacy', 'v0']) {
  test(`validates real offline ${version} transaction bytes, fee payer and signatures`, () => {
    const owner = Keypair.generate(), other = Keypair.generate();
    const blockhash = Keypair.generate().publicKey.toBase58();
    const instructions = [SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: other.publicKey, lamports: 1 })];
    const tx = version === 'legacy'
      ? new Transaction({ feePayer: owner.publicKey, recentBlockhash: blockhash }).add(...instructions)
      : new VersionedTransaction(new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message());
    const unsigned = Buffer.from(version === 'legacy' ? tx.serialize({ requireAllSignatures: false, verifySignatures: false }) : tx.serialize()).toString('base64');
    if (version === 'legacy') tx.partialSign(owner); else tx.sign([owner]);
    const signed = Buffer.from(tx.serialize()).toString('base64');
    assert.equal(typeof rpc.validateSigned(unsigned, signed, owner.publicKey.toBase58()), 'string');
    assert.throws(() => rpc.validateSigned(unsigned, signed, other.publicKey.toBase58()), /does not belong/);
    assert.throws(() => rpc.validateSigned(unsigned, unsigned, owner.publicKey.toBase58()), /signature could not/);
    const changed = VersionedTransaction.deserialize(Buffer.from(signed, 'base64'));
    changed.message.recentBlockhash = other.publicKey.toBase58();
    changed.sign([owner]);
    assert.throws(() => rpc.validateSigned(unsigned, Buffer.from(changed.serialize()).toString('base64'), owner.publicKey.toBase58()), /does not match/);
  });
}
