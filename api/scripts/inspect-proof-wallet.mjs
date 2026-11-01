import { config } from 'dotenv';
import { PrivyClient } from '@privy-io/node';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

const address = process.env.PROOF_WALLET_EMAIL;
const expectedWallet = process.env.PROOF_WALLET_ADDRESS;
if (!address || !process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET)
  throw new Error('Set PROOF_WALLET_EMAIL and Privy app credentials');
if (expectedWallet && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(expectedWallet))
  throw new Error('PROOF_WALLET_ADDRESS must be a Solana public address');

const client = new PrivyClient({
  appId: process.env.PRIVY_APP_ID,
  appSecret: process.env.PRIVY_APP_SECRET,
});
let user;
try {
  user = await client.users().getByEmailAddress({ address });
} catch (error) {
  if (error?.status === 404) {
    console.log(JSON.stringify({ found: false }));
    process.exitCode = 0;
  } else {
    throw new Error(`Privy user lookup failed with status ${error?.status ?? 'unknown'}`);
  }
}
if (user) {
  const wallets = user.linked_accounts.filter(
    (item) =>
      item.type === 'wallet' &&
      item.chain_type === 'solana' &&
      item.wallet_client_type === 'privy' &&
      typeof item.id === 'string',
  );
  const results = [];
  for (const wallet of wallets) {
    const current = await client.wallets().get(wallet.id);
    results.push({
      walletId: wallet.id,
      address: wallet.address,
      delegated: wallet.delegated === true,
      signerCount: Array.isArray(current.additional_signers)
        ? current.additional_signers.length
        : null,
      exactWalletMatch: current.address === wallet.address,
      solanaWallet: current.chain_type === 'solana',
    });
  }
  const proofReady =
    results.length === 1 &&
    Boolean(expectedWallet) &&
    results[0].address === expectedWallet &&
    results[0].exactWalletMatch &&
    results[0].solanaWallet &&
    !results[0].delegated &&
    results[0].signerCount === 0;
  console.log(JSON.stringify({ userId: user.id, wallets: results, proofReady }));
}
