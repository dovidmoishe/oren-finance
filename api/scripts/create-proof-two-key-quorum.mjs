import { config } from 'dotenv';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrivyClient } from '@privy-io/node';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
if (process.env.PROOF_CREATE_TWO_KEY_QUORUM !== 'true')
  throw new Error('Set PROOF_CREATE_TWO_KEY_QUORUM=true for this manual proof step');
const address = process.env.PROOF_WALLET_ADDRESS;
const email = process.env.PROOF_WALLET_EMAIL;
const { PRIVY_APP_ID: appId, PRIVY_APP_SECRET: appSecret } = process.env;
if (!address || !email || !appId || !appSecret)
  throw new Error('Proof wallet identity and Privy app credentials are required');
const keyFile = fileURLToPath(new URL('../.proof/quorum-keys.json', import.meta.url));
const state = JSON.parse(readFileSync(keyFile, 'utf8'));
if (state.proofWalletAddress !== address || !state.admin?.quorumId)
  throw new Error('Proof wallet or separate policy owner does not match local state');

const privy = new PrivyClient({ appId, appSecret });
const user = await privy.users().getByWalletAddress({ address });
const linked = user.linked_accounts.filter((account) =>
  account.type === 'wallet' && account.chain_type === 'solana' &&
  account.wallet_client_type === 'privy' && account.address === address && account.id,
);
if (linked.length !== 1 || !user.linked_accounts.some((account) =>
  account.type === 'email' && account.address?.toLowerCase() === email.toLowerCase()))
  throw new Error('Disposable wallet identity changed');
const wallet = await privy.wallets().get(linked[0].id);
if (wallet.address !== address || wallet.chain_type !== 'solana' ||
    !Array.isArray(wallet.additional_signers) || wallet.additional_signers.length !== 0 ||
    linked[0].delegated)
  throw new Error('Disposable wallet must have zero signers and no delegation');

function makeKey(label) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    label,
    publicKeyDerBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKeyDerBase64: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}
function save() {
  const temporary = `${keyFile}.tmp`;
  writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  renameSync(temporary, keyFile);
}
state.twoKey ??= {
  api: makeKey('oren disposable proof api authorization'),
  gate: makeKey('oren disposable proof signer gate authorization'),
};
save();
const { api, gate } = state.twoKey;
if (!api?.publicKeyDerBase64 || !api?.privateKeyDerBase64 ||
    !gate?.publicKeyDerBase64 || !gate?.privateKeyDerBase64 ||
    api.publicKeyDerBase64 === gate.publicKeyDerBase64 ||
    [api.publicKeyDerBase64, gate.publicKeyDerBase64].includes(state.admin.publicKeyDerBase64))
  throw new Error('Proof authorization keys are missing or not independent');

const existing = [];
for await (const quorum of privy.keyQuorums().list()) existing.push(quorum);
const matching = existing.find((quorum) =>
  quorum.authorization_threshold === 2 && quorum.authorization_keys?.length === 2 &&
  [api.publicKeyDerBase64, gate.publicKeyDerBase64].every((key) =>
    quorum.authorization_keys.some((member) => member.public_key === key)));
if (state.twoKey.quorumId && matching?.id !== state.twoKey.quorumId)
  throw new Error('Stored two-key quorum ID differs from Privy');
if (!matching) {
  const created = await privy.keyQuorums().create({
    authorization_threshold: 2,
    display_name: 'oren disposable proof two-key trade signer',
    public_keys: [api.publicKeyDerBase64, gate.publicKeyDerBase64],
  });
  state.twoKey.quorumId = created.id;
  save();
} else {
  state.twoKey.quorumId = matching.id;
  save();
}
if (state.twoKey.quorumId === state.admin.quorumId)
  throw new Error('Trade quorum must differ from policy owner');
console.log(JSON.stringify({
  proofWalletIdentityMatches: true,
  walletSignerCount: 0,
  signerQuorumId: state.twoKey.quorumId,
  authorizationThreshold: 2,
  policyOwnerSeparate: true,
  keysStoredInIgnoredProofDirectory: true,
}));
