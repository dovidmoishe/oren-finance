import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import {
  sponsorshipEligible,
  sponsorshipSimulation,
  validateSponsoredTransaction,
} from '../execution/gas-sponsorship';

const wallet = Keypair.generate();
const payer = Keypair.generate();
const recipient = Keypair.generate().publicKey;
const blockhash = () => Keypair.generate().publicKey.toBase58();
function fixture(
  instructions = [
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: recipient,
      lamports: 100,
    }),
  ],
) {
  const compile = (payerKey: PublicKey, hash: string, list = instructions) =>
    new VersionedTransaction(
      new TransactionMessage({
        payerKey,
        recentBlockhash: hash,
        instructions: list,
      }).compileToV0Message(),
    );
  const original = compile(wallet.publicKey, blockhash());
  const signed = compile(payer.publicKey, blockhash());
  signed.sign([payer, wallet]);
  const encode = (tx: VersionedTransaction) =>
    Buffer.from(tx.serialize()).toString('base64');
  return {
    original,
    signed,
    encode,
    compile,
    unsigned: encode(original),
    signature: bs58.encode(signed.signatures[0]),
  };
}
describe('native Solana sponsorship message binding', () => {
  it('accepts a separate fee payer and fresh blockhash with both valid signatures', () => {
    const f = fixture();
    expect(sponsorshipEligible(f.unsigned, wallet.publicKey.toBase58())).toBe(
      true,
    );
    expect(
      validateSponsoredTransaction(
        f.unsigned,
        f.encode(f.signed),
        wallet.publicKey.toBase58(),
        f.signature,
      ),
    ).toBe(f.encode(f.signed));
  });
  it('builds an unsigned simulation with unchanged instruction identities', () => {
    const f = fixture();
    const encoded = sponsorshipSimulation(
      f.unsigned,
      wallet.publicKey.toBase58(),
      payer.publicKey.toBase58(),
    );
    const simulation = VersionedTransaction.deserialize(
      Buffer.from(encoded, 'base64'),
    );
    expect(
      simulation.message.staticAccountKeys[0].equals(payer.publicKey),
    ).toBe(true);
    expect(
      simulation.message.staticAccountKeys[1].equals(wallet.publicKey),
    ).toBe(true);
    const decoded = TransactionMessage.decompile(simulation.message);
    expect(
      decoded.instructions[0].keys[0].pubkey.equals(wallet.publicKey),
    ).toBe(true);
    expect(
      simulation.signatures.every((sig) => sig.every((byte) => byte === 0)),
    ).toBe(true);
    expect(() =>
      sponsorshipSimulation(
        f.unsigned,
        wallet.publicKey.toBase58(),
        recipient.toBase58(),
      ),
    ).toThrow('overlaps');
  });
  it.each([
    'recipient',
    'amount',
    'extra instruction',
    'missing wallet signer',
    'bad signature',
    'wrong hash',
  ])('rejects %s changes', (change) => {
    const f = fixture();
    let signed = f.signed;
    let signature = f.signature;
    if (change === 'recipient' || change === 'amount')
      signed = f.compile(payer.publicKey, blockhash(), [
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: change === 'recipient' ? payer.publicKey : recipient,
          lamports: change === 'amount' ? 101 : 100,
        }),
      ]);
    if (change === 'extra instruction')
      signed = f.compile(payer.publicKey, blockhash(), [
        ...TransactionMessage.decompile(f.original.message).instructions,
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: payer.publicKey,
          lamports: 1,
        }),
      ]);
    if (change === 'missing wallet signer')
      signed = f.compile(payer.publicKey, blockhash(), [
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: recipient,
          lamports: 100,
        }),
      ]);
    if (change !== 'missing wallet signer') signed.sign([payer, wallet]);
    else signed.sign([payer]);
    signature = bs58.encode(signed.signatures[0]);
    if (change === 'bad signature') signed.signatures[1][0] ^= 1;
    if (change === 'wrong hash')
      signature = bs58.encode(new Uint8Array(64).fill(8));
    expect(() =>
      validateSponsoredTransaction(
        f.unsigned,
        f.encode(signed),
        wallet.publicKey.toBase58(),
        signature,
      ),
    ).toThrow();
  });
  it('refuses pre-signed, oversized, mismatched-wallet and close-account candidates', () => {
    const f = fixture();
    f.original.sign([wallet]);
    expect(
      sponsorshipEligible(f.encode(f.original), wallet.publicKey.toBase58()),
    ).toBe(false);
    expect(sponsorshipEligible(f.unsigned, recipient.toBase58())).toBe(false);
    const close = fixture([
      new TransactionInstruction({
        programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        keys: [{ pubkey: wallet.publicKey, isSigner: true, isWritable: true }],
        data: Buffer.from([9]),
      }),
    ]);
    expect(
      sponsorshipEligible(close.unsigned, wallet.publicKey.toBase58()),
    ).toBe(false);
    const large = fixture([
      new TransactionInstruction({
        programId: recipient,
        keys: [{ pubkey: wallet.publicKey, isSigner: true, isWritable: true }],
        data: Buffer.alloc(1000),
      }),
    ]);
    expect(
      sponsorshipEligible(large.unsigned, wallet.publicKey.toBase58()),
    ).toBe(false);
  });
});
