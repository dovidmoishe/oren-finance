import { config } from 'dotenv';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrivyClient } from '@privy-io/node';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

if (process.env.PROOF_CREATE_QUORUMS !== 'true')
  throw new Error('Set PROOF_CREATE_QUORUMS=true for this manual proof step');
const email = process.env.PROOF_WALLET_EMAIL;
const walletAddress = process.env.PROOF_WALLET_ADDRESS;
if (!email || !walletAddress || !process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET)
  throw new Error('Set exact proof email and wallet address with Privy app credentials');

const privy = new PrivyClient({
  appId: process.env.PRIVY_APP_ID,
  appSecret: process.env.PRIVY_APP_SECRET,
});
const user = await privy.users().getByWalletAddress({ address: walletAddress });
const emailMatches = user.linked_accounts.some(
  (item) => item.type === 'email' && item.address?.toLowerCase() === email.toLowerCase(),
);
const wallets = user.linked_accounts.filter(
  (item) =>
    item.type === 'wallet' &&
    item.chain_type === 'solana' &&
    item.wallet_client_type === 'privy' &&
    typeof item.id === 'string',
);
if (!emailMatches || wallets.length !== 1 || wallets[0].address !== walletAddress || wallets[0].delegated)
  throw new Error('Proof wallet identity or signer state changed');
const wallet = await privy.wallets().get(wallets[0].id);
if (
  wallet.address !== walletAddress ||
  wallet.chain_type !== 'solana' ||
  !Array.isArray(wallet.additional_signers) ||
  wallet.additional_signers.length !== 0
) throw new Error('Proof wallet is not a single unenrolled embedded Solana wallet');

const directory = fileURLToPath(new URL('../.proof/', import.meta.url));
const keyFile = fileURLToPath(new URL('../.proof/quorum-keys.json', import.meta.url));
mkdirSync(directory, { recursive: true });
function makeKey(label) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  return {
    label,
    publicKeyDerBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKeyDerBase64: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}
const state = existsSync(keyFile)
  ? JSON.parse(readFileSync(keyFile, 'utf8'))
  : {
      proofWalletAddress: walletAddress,
      admin: makeKey('oren disposable policy proof admin'),
      signer: makeKey('oren disposable trade proof signer'),
    };
if (
  state.proofWalletAddress !== walletAddress ||
  !state.admin?.publicKeyDerBase64 ||
  !state.admin?.privateKeyDerBase64 ||
  !state.signer?.publicKeyDerBase64 ||
  !state.signer?.privateKeyDerBase64
) throw new Error('Existing local proof key file does not match this wallet');
function save() {
  const temporary = `${keyFile}.tmp`;
  writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  renameSync(temporary, keyFile);
}
if (!existsSync(keyFile)) save();

const existing = [];
for await (const quorum of privy.keyQuorums().list()) existing.push(quorum);
for (const role of ['admin', 'signer']) {
  const key = state[role];
  const matching = existing.find((quorum) =>
    quorum.authorization_keys?.some(
      (authorizationKey) => authorizationKey.public_key === key.publicKeyDerBase64,
    ),
  );
  if (key.quorumId && matching?.id !== key.quorumId)
    throw new Error(`Local ${role} quorum ID does not match Privy`);
  if (matching) {
    key.quorumId = matching.id;
  } else {
    const created = await privy.keyQuorums().create({
      authorization_threshold: 1,
      display_name: key.label,
      public_keys: [key.publicKeyDerBase64],
    });
    key.quorumId = created.id;
  }
  save();
}
if (state.admin.quorumId === state.signer.quorumId)
  throw new Error('Proof policy owner and trade signer must be distinct');
console.log(JSON.stringify({
  proofWalletIdentityMatches: true,
  walletSignerCount: 0,
  adminQuorumId: state.admin.quorumId,
  signerQuorumId: state.signer.quorumId,
  localKeysStoredInIgnoredProofDirectory: true,
}));
