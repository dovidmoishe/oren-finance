import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PrivyClient } from '@privy-io/node';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

if (process.env.PROOF_TEST_SIGNER_DENIALS !== 'true')
  throw new Error('Set PROOF_TEST_SIGNER_DENIALS=true for this manual proof step');
const email = process.env.PROOF_WALLET_EMAIL;
const address = process.env.PROOF_WALLET_ADDRESS;
if (!email || !address || !process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET || !process.env.ALCHEMY_API_KEY)
  throw new Error('Proof wallet identity, Privy credentials and Solana RPC are required');

const keys = JSON.parse(readFileSync(fileURLToPath(new URL('../.proof/quorum-keys.json', import.meta.url)), 'utf8'));
const created = JSON.parse(readFileSync(fileURLToPath(new URL('../.proof/jupiter-buy.created.json', import.meta.url)), 'utf8'));
const signer = process.env.PROOF_TWO_KEY === 'true' ? keys.twoKey : keys.signer;
const signerKeys = process.env.PROOF_TWO_KEY === 'true'
  ? [signer?.api?.privateKeyDerBase64, signer?.gate?.privateKeyDerBase64]
  : [signer?.privateKeyDerBase64];
if (keys.proofWalletAddress !== address || signerKeys.some((key) => !key) || !created.policyId)
  throw new Error('Local proof signer, wallet and policy do not match');

const privy = new PrivyClient({ appId: process.env.PRIVY_APP_ID, appSecret: process.env.PRIVY_APP_SECRET });
const user = await privy.users().getByWalletAddress({ address });
if (!user.linked_accounts.some((item) => item.type === 'email' && item.address?.toLowerCase() === email.toLowerCase()))
  throw new Error('Proof wallet email does not match');
const linked = user.linked_accounts.filter((item) =>
  item.type === 'wallet' && item.chain_type === 'solana' && item.wallet_client_type === 'privy' && item.address === address,
);
if (linked.length !== 1 || typeof linked[0].id !== 'string')
  throw new Error('Expected exactly one matching embedded Solana wallet');
const wallet = await privy.wallets().get(linked[0].id);
const signers = wallet.additional_signers;
if (wallet.address !== address || !Array.isArray(signers) || signers.length !== 1 ||
    signers[0].signer_id !== signer.quorumId ||
    !signers[0].override_policy_ids?.includes(created.policyId))
  throw new Error('Owner must first attach only the expected signer and policy in the browser');
const policy = await privy.policies().get(created.policyId);
if (policy.owner_id !== keys.admin.quorumId || policy.rules?.length !== 3)
  throw new Error('Owner-protected proof policy changed');

const owner = new PublicKey(address);
const rpc = new Connection(`https://solana-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`, 'confirmed');
const balance = await rpc.getBalance(owner);
if (balance !== 0)
  throw new Error('Run these denial probes only while the disposable wallet is unfunded');
const { blockhash } = await rpc.getLatestBlockhash('confirmed');
const usdc = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const sourceAta = getAssociatedTokenAddressSync(usdc, owner);
const otherOwner = Keypair.generate().publicKey;
const destinationAta = getAssociatedTokenAddressSync(usdc, otherOwner);
const attacks = [
  {
    name: 'system_transfer_sign_transaction',
    instructions: [SystemProgram.transfer({ fromPubkey: owner, toPubkey: otherOwner, lamports: 1 })],
  },
  {
    name: 'spl_transfer_checked_sign_transaction',
    instructions: [createTransferCheckedInstruction(sourceAta, usdc, destinationAta, owner, 1n, 6, [], TOKEN_PROGRAM_ID)],
  },
];
const authorization_context = { authorization_private_keys: signerKeys };
const attempts = [];
async function expectDenial(name, run) {
  try {
    await run();
    attempts.push({ name, denied: false });
  } catch (error) {
    const message = String(error?.message ?? '');
    attempts.push({
      name, denied: true, status: error?.status ?? null,
      policyDenial: /policy|authoriz|not allowed|not permitted|permission|forbidden/i.test(message),
      detail: message.slice(0, 240),
    });
  }
}
await expectDenial('solana_sign_message', () => privy.wallets().solana().signMessage(linked[0].id, {
  message: Buffer.from('oren disposable signer policy denial proof'),
  authorization_context,
  idempotency_key: randomUUID(),
}));
for (const attack of attacks) {
  const message = new TransactionMessage({
    payerKey: owner, recentBlockhash: blockhash, instructions: attack.instructions,
  }).compileToV0Message();
  const transaction = Buffer.from(new VersionedTransaction(message).serialize()).toString('base64');
  await expectDenial(attack.name, () => privy.wallets().solana().signTransaction(linked[0].id, {
    transaction, authorization_context, idempotency_key: randomUUID(),
  }));
}
console.log(JSON.stringify({ wallet: address, policyId: created.policyId, unfunded: true, attempts }));
if (attempts.some((attempt) => !attempt.denied || !attempt.policyDenial))
  throw new Error('Signer denial matrix is inconclusive; do not attach funds or enable headless signing');
