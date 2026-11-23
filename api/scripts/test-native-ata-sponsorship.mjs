import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import bs58 from 'bs58';
import { AddressLookupTableAccount, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

function loadSource(url) {
  const exports = {};
  const sourceRequire = createRequire(url);
  vm.runInNewContext(ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, esModuleInterop: true },
  }).outputText, { exports, Buffer, process, require(id) {
    return id.startsWith('.') ? loadSource(new URL(`${id}.ts`, url)) : sourceRequire(id);
  } });
  return exports;
}
const { sponsorshipEligible, sponsorshipSimulation, validateSponsoredTransaction } = loadSource(new URL('../src/execution/gas-sponsorship.ts', import.meta.url));
const encode = tx => Buffer.from(tx.serialize()).toString('base64');
const captured = JSON.parse(readFileSync(new URL('../test/fixtures/privy-ata-rent.json', import.meta.url), 'utf8'));

for (const proof of captured.cases) {
  test(`accepts the confirmed native Privy ${proof.name} rent rewrite and both real signatures`, () => {
    assert.equal(proof.walletPreLamports, 0);
    assert.equal(proof.walletPostLamports, 0);
    assert.equal(validateSponsoredTransaction(proof.unsigned, proof.signed, proof.wallet, proof.signature), proof.signed);
    const original = TransactionMessage.decompile(VersionedTransaction.deserialize(Buffer.from(proof.unsigned, 'base64')).message);
    const landed = TransactionMessage.decompile(VersionedTransaction.deserialize(Buffer.from(proof.signed, 'base64')).message);
    assert.equal(original.instructions[0].keys[0].pubkey.toBase58(), proof.wallet);
    assert.equal(landed.instructions[0].keys[0].pubkey.toBase58(), landed.payerKey.toBase58());
    assert.notEqual(landed.payerKey.toBase58(), proof.wallet);
  });
}

function fixture(program, lookup = false) {
  const wallet = Keypair.generate();
  const payer = Keypair.generate();
  const mint = Keypair.generate().publicKey;
  const recipient = Keypair.generate().publicKey;
  const ata = getAssociatedTokenAddressSync(mint, wallet.publicKey, false, program);
  const setup = createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, ata, wallet.publicKey, mint, program);
  const swap = SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: recipient, lamports: 1 });
  const tables = lookup ? [new AddressLookupTableAccount({ key: Keypair.generate().publicKey, state: {
    deactivationSlot: 18446744073709551615n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0,
    addresses: [mint, ata, program, recipient],
  } })] : [];
  const compile = (feePayer, instructions) => new VersionedTransaction(new TransactionMessage({
    payerKey: feePayer, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions,
  }).compileToV0Message(tables));
  const unsigned = encode(compile(wallet.publicKey, [setup, swap]));
  const sponsoredSetup = () => {
    const ix = createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, wallet.publicKey, mint, program);
    return ix;
  };
  const sign = instructions => {
    const tx = compile(payer.publicKey, instructions);
    tx.sign([payer, wallet]);
    return { signed: encode(tx), signature: bs58.encode(tx.signatures[0]) };
  };
  return { wallet, payer, mint, ata, recipient, setup, swap, tables, unsigned, sponsoredSetup, sign };
}

for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
  for (const lookup of [false, true]) {
    test(`simulates and validates only the ATA rent payer rewrite (${program}, lookup=${lookup})`, () => {
      const f = fixture(program, lookup);
      const wallet = f.wallet.publicKey.toBase58();
      assert.equal(sponsorshipEligible(f.unsigned, wallet), true);
      const simulated = VersionedTransaction.deserialize(Buffer.from(sponsorshipSimulation(f.unsigned, wallet, f.payer.publicKey.toBase58()), 'base64'));
      const instructions = TransactionMessage.decompile(simulated.message, { addressLookupTableAccounts: f.tables }).instructions;
      assert.equal(instructions[0].keys[0].pubkey.toBase58(), f.payer.publicKey.toBase58());
      assert.equal(instructions[0].keys[2].pubkey.toBase58(), wallet);
      assert.equal(instructions[0].keys[1].pubkey.toBase58(), f.ata.toBase58());
      assert.equal(instructions[1].keys[0].pubkey.toBase58(), wallet);
      assert.deepEqual(Buffer.from(instructions[1].data), Buffer.from(f.swap.data));
      assert.ok(simulated.signatures.every(sig => sig.every(byte => byte === 0)));
      const { signed, signature } = f.sign([f.sponsoredSetup(), f.swap]);
      assert.equal(validateSponsoredTransaction(f.unsigned, signed, wallet, signature), signed);
    });
  }
}

for (const field of ['owner', 'mint', 'ata', 'token program', 'system program', 'data', 'program', 'rent payer', 'swap amount', 'extra instruction', 'privilege', 'lookup identity', 'bad signature']) {
  test(`rejects a sponsored transaction with changed ${field}`, () => {
    const f = fixture(TOKEN_2022_PROGRAM_ID, true);
    const setup = f.sponsoredSetup();
    const instructions = [setup, f.swap];
    const positions = { owner: 2, mint: 3, ata: 1, 'token program': 5, 'system program': 4 };
    if (field in positions) setup.keys[positions[field]].pubkey = f.recipient;
    if (field === 'data') setup.data = Buffer.from([0]);
    if (field === 'program') setup.programId = SystemProgram.programId;
    if (field === 'rent payer') setup.keys[0] = { pubkey: f.recipient, isSigner: false, isWritable: true };
    if (field === 'swap amount') instructions[1] = SystemProgram.transfer({ fromPubkey: f.wallet.publicKey, toPubkey: f.recipient, lamports: 2 });
    if (field === 'extra instruction') instructions.push(f.swap);
    if (field === 'privilege') setup.keys[3].isWritable = true;
    let { signed, signature } = f.sign(instructions);
    if (field === 'bad signature' || field === 'lookup identity') {
      const tx = VersionedTransaction.deserialize(Buffer.from(signed, 'base64'));
      if (field === 'bad signature') tx.signatures[1][0] ^= 1;
      else { tx.message.addressTableLookups[0].accountKey = Keypair.generate().publicKey; tx.sign([f.payer, f.wallet]); signature = bs58.encode(tx.signatures[0]); }
      signed = encode(tx);
    }
    assert.throws(() => validateSponsoredTransaction(f.unsigned, signed, f.wallet.publicKey.toBase58(), signature));
  });
}

for (const variant of ['non-idempotent create', 'foreign owner', 'extra account', 'close account']) {
  test(`leaves ${variant} on the user-paid path`, () => {
    const f = fixture(TOKEN_PROGRAM_ID);
    if (variant === 'non-idempotent create') f.setup.data = Buffer.alloc(0);
    if (variant === 'foreign owner') f.setup.keys[2].pubkey = f.recipient;
    if (variant === 'extra account') f.setup.keys.push({ pubkey: f.recipient, isSigner: false, isWritable: false });
    const instructions = [f.setup, f.swap];
    if (variant === 'close account') instructions.push(new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys: [{ pubkey: f.wallet.publicKey, isSigner: true, isWritable: true }], data: Buffer.from([9]) }));
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: f.wallet.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions }).compileToV0Message());
    assert.equal(sponsorshipEligible(encode(tx), f.wallet.publicKey.toBase58()), false);
  });
}
