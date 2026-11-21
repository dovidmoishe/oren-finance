import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { Keypair, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import {
  MintLayout, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, getMintLen, getTypeLen, ExtensionType, AccountType,
} from '@solana/spl-token';
import { PrivyClient } from '@privy-io/node';

function loadSource(path, modules = {}, globals = {}) {
  const url = new URL(path, import.meta.url);
  const exports = {};
  const sourceRequire = createRequire(url);
  const common = {
    '@nestjs/common': { Injectable: () => () => {}, Inject: () => () => {}, Logger: class { debug() {} log() {} warn() {} } },
    '../config/constants': { APP_ENV: Symbol(), USDC_MINT: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
    '../config/deployment': { assertFinancialExecutionEnabled() {} },
    './swap-terms': { rawIn: quote => quote.routePayload.inAmount },
    './ata-rent-sponsor.repository': { AtaRentSponsorRepository: class {} },
    './ata-rent-sponsor.signer': { AtaRentSponsorSigner: class {} },
    './ata-rent-sponsor.rpc': { AtaRentSponsorRpc: class {} },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, esModuleInterop: true },
  }).outputText, { exports, Buffer, process, AbortController, setTimeout, clearTimeout, ...globals,
    require(id) { return id in modules ? modules[id] : id in common ? common[id] : sourceRequire(id); },
  });
  return exports;
}
const eligibility = loadSource('../src/execution/ata-rent-sponsor-eligibility.ts');
const { AtaRentSponsorService } = loadSource('../src/execution/ata-rent-sponsor.service.ts', { './ata-rent-sponsor-eligibility': eligibility });

for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
  test(`real ATA transaction uses only idempotent creation for ${program.toBase58()}`, async () => {
    const sponsor = Keypair.generate(), owner = Keypair.generate().publicKey, mint = Keypair.generate().publicKey;
    const is2022 = program.equals(TOKEN_2022_PROGRAM_ID);
    const data = Buffer.alloc(is2022 ? getMintLen([ExtensionType.TransferFeeConfig]) : MintLayout.span);
    MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: SystemProgram.programId, supply: 0n, decimals: 6,
      isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: SystemProgram.programId }, data);
    if (is2022) {
      data[165] = AccountType.Mint;
      data.writeUInt16LE(ExtensionType.TransferFeeConfig, 166);
      data.writeUInt16LE(getTypeLen(ExtensionType.TransferFeeConfig), 168);
    }
    const address = sponsor.publicKey.toBase58();
    const config = { signer: 'privy', walletId: 'server-wallet', address, minTradeRaw: 5000000n,
      perUserCap: 5, dailyBudgetLamports: 100000000n, minBalanceLamports: 20000000n, timeoutMs: 1000 };
    let submitted, savedSignature, requestedSize;
    const connection = {
      async getAccountInfo(key) { return key.equals(mint) ? { data, owner: program, executable: false, lamports: 1 } : null; },
      async getTokenAccountBalance() { return { value: { amount: '10000000' } }; },
      async getMinimumBalanceForRentExemption(size) { requestedSize = size; return 3000000; },
      async getLatestBlockhash() { return { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }; },
      async getFeeForMessage() { return { value: 5000 }; },
      async getBalance() { return 1000000000; },
      async sendRawTransaction(bytes) { assert.ok(savedSignature); submitted = Transaction.from(bytes); return savedSignature; },
      async getSignatureStatuses() { return { value: [{ err: null, confirmationStatus: 'confirmed' }] }; },
    };
    const service = new AtaRentSponsorService({ ATA_RENT_SPONSORSHIP: true, ATA_RENT_CONFIG: config },
      { async reserve() { return { row: { id: 'reservation' } }; }, async signature(_id, signature) { savedSignature = signature; }, async finish() {} },
      { async sign(unsigned) { const tx = Transaction.from(Buffer.from(unsigned, 'base64')); tx.partialSign(sponsor); return tx.serialize().toString('base64'); } },
      { connection() { return connection; } });
    const swap = new Transaction({ feePayer: owner, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(
      createAssociatedTokenAccountIdempotentInstruction(owner, getAssociatedTokenAddressSync(mint, owner, false, program), owner, mint, program),
    ).serialize({ requireAllSignatures: false }).toString('base64');
    assert.equal(await service.cover({ side: 'buy', assetId: 'stock', inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      outputMint: mint.toBase58(), variant: { mint: mint.toBase58(), tradable: true }, routePayload: { inAmount: '10000000' } },
      owner.toBase58(), { flow: 'user_reviewed', userId: 'user' }, swap), true);
    assert.equal(submitted.instructions.length, 1);
    assert.ok(submitted.feePayer.equals(sponsor.publicKey));
    const instruction = submitted.instructions[0];
    assert.ok(instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
    assert.deepEqual([...instruction.data], [1]);
    assert.ok(instruction.keys[0].pubkey.equals(sponsor.publicKey));
    assert.ok(instruction.keys[1].pubkey.equals(getAssociatedTokenAddressSync(mint, owner, false, program)));
    assert.ok(instruction.keys[2].pubkey.equals(owner));
    assert.ok(instruction.keys[5].pubkey.equals(program));
    assert.equal(submitted.signatures.length, 1);
    assert.ok(submitted.verifySignatures());
    // 165 classic; 182 includes Token-2022 ImmutableOwner + TransferFeeAmount.
    assert.equal(requestedSize, is2022 ? 182 : 165);
  });
}

test('real Privy SDK signs using the configured server wallet and never enables gas sponsorship or broadcast', async () => {
  const requests = [];
  const mockFetch = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    requests.push({ url: String(url), body, headers: new Headers(init.headers), signal: init.signal });
    return new Response(JSON.stringify(body ? { method: 'signTransaction', data: { encoding: 'base64', signed_transaction: 'offline-signed' } } :
      { id: 'server-wallet', chain_type: 'solana', address: 'sponsor-address' }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const { PrivyAtaRentSponsorSigner } = loadSource('../src/execution/ata-rent-sponsor.signer.ts', {
    '@privy-io/node': { PrivyClient },
  }, { fetch: mockFetch });
  const signer = new PrivyAtaRentSponsorSigner({ ATA_RENT_SPONSORSHIP: true,
    ATA_RENT_CONFIG: { signer: 'privy', walletId: 'server-wallet', address: 'sponsor-address', timeoutMs: 1000 },
    PRIVY_APP_ID: 'offline-app', PRIVY_APP_SECRET: 'offline-test-secret' });
  assert.equal(await signer.sign('unsigned-offline', 'reservation', new AbortController().signal), 'offline-signed');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.method, 'signTransaction');
  assert.equal(requests[1].body.params.transaction, 'unsigned-offline');
  assert.equal(requests[1].body.sponsor, undefined);
  assert.equal(requests[1].headers.get('privy-idempotency-key'), 'reservation');
});

test('swap compatibility preserves non-idempotent ATA routes on the user-paid path', () => {
  const payer = Keypair.generate().publicKey;
  const encode = data => new Transaction({ feePayer: payer, recentBlockhash: Keypair.generate().publicKey.toBase58() })
    .add(new TransactionInstruction({ programId: ASSOCIATED_TOKEN_PROGRAM_ID, keys: [], data: Buffer.from(data) }))
    .serialize({ requireAllSignatures: false }).toString('base64');
  assert.equal(eligibility.ataRentSwapCompatible(encode([1])), true);
  for (const data of [[], [0], [2], [1, 0]]) assert.equal(eligibility.ataRentSwapCompatible(encode(data)), false);
  assert.equal(eligibility.ataRentSwapCompatible('invalid-bytes'), false);
});
