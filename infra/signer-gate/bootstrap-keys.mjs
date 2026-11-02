import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { PrivyClient } from '@privy-io/node';
import postgres from 'postgres';
import gateModule from '/app/dist/src/signer-gate/signer-gate.service.js';

// This owner-trial policy has already passed the unfunded Privy denial matrix.
const POLICY_ID = 'wwfcrjbf9ur4ehh7knd9x8rq';
const POLICY_HASH = 'cfb5f2a7da404283c6ee8be6dc626ab9d2708af82a5fb7ac0727b0cda9a9e351';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const statePath = '/state/keys.json';
const { gatePolicyFingerprint } = gateModule;

for (const key of ['POSTGRES_URL', 'PRIVY_APP_ID', 'PRIVY_APP_SECRET', 'ALCHEMY_API_KEY']) {
  if (!process.env[key]) throw new Error(`Bootstrap requires ${key}`);
}
if (new URL(process.env.POSTGRES_URL).username !== 'oren_api_runtime')
  throw new Error('Bootstrap requires the restricted API database role');
const privy = new PrivyClient({
  appId: process.env.PRIVY_APP_ID,
  appSecret: process.env.PRIVY_APP_SECRET,
});
const policy = await privy.policies().get(POLICY_ID);
const rule = policy.rules?.find((item) => item.name === 'allow bounded jupiter buy');
const condition = (field) => rule?.conditions?.find(
  (item) => item.field === `shared_accounts_route.${field}`,
)?.value;
const expiry = Number(policy.rules?.[0]?.conditions?.[0]?.value);
if (
  gatePolicyFingerprint(policy) !== POLICY_HASH ||
  policy.chain_type !== 'solana' ||
  !policy.owner_id ||
  policy.rules?.length !== 3 ||
  policy.rules.some((item) => item.method !== 'signTransaction') ||
  condition('accounts.source_mint') !== USDC ||
  condition('args.in_amount') !== '1000000' ||
  Number(condition('args.slippage_bps')) > 50 ||
  !Number.isInteger(expiry) ||
  expiry <= Math.floor(Date.now() / 1000) + 3600
) throw new Error('Owner-reviewed buy policy is missing, changed or near expiry');
const stockMint = condition('accounts.destination_mint');
const sourceAta = condition('accounts.source_token_account');
const destinationAta = condition('accounts.destination_token_account');
const connection = new Connection(
  `https://solana-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  'confirmed',
);
const [usdcMint, stockMintAccount] = await Promise.all([
  connection.getAccountInfo(new PublicKey(USDC)),
  connection.getAccountInfo(new PublicKey(stockMint)),
]);
if (!usdcMint?.owner.equals(TOKEN_PROGRAM_ID) ||
    !stockMintAccount?.owner.equals(TOKEN_2022_PROGRAM_ID))
  throw new Error('Proof mint programs changed');

const sql = postgres(process.env.POSTGRES_URL, { max: 1 });
let approvals;
try {
  approvals = await sql`
    SELECT DISTINCT wallet, wallet_id, user_id
    FROM trade_approvals
    WHERE created_at > now() - interval '7 days'
      AND status IN ('signed', 'submitted', 'confirmed')
    ORDER BY wallet, wallet_id, user_id
  `;
} finally {
  await sql.end();
}
const matching = approvals.filter(({ wallet }) => {
  try {
    const owner = new PublicKey(wallet);
    return getAssociatedTokenAddressSync(new PublicKey(USDC), owner).toBase58() === sourceAta &&
      getAssociatedTokenAddressSync(new PublicKey(stockMint), owner, false,
        TOKEN_2022_PROGRAM_ID).toBase58() === destinationAta;
  } catch {
    return false;
  }
});
if (matching.length !== 1)
  throw new Error('Proof policy token accounts did not identify one recent browser-trade wallet');
const account = matching[0];
const user = await privy.users().getByWalletAddress({ address: account.wallet });
const linked = user.linked_accounts.filter((item) =>
  item.type === 'wallet' && item.chain_type === 'solana' &&
  item.wallet_client_type === 'privy' && item.id === account.wallet_id &&
  item.address === account.wallet,
);
const wallet = await privy.wallets().get(account.wallet_id);
if (user.id !== account.user_id || linked.length !== 1 || linked[0].delegated ||
    wallet.address !== account.wallet || wallet.chain_type !== 'solana' ||
    !Array.isArray(wallet.additional_signers) || wallet.additional_signers.length !== 0)
  throw new Error('Proof wallet owner or signer state changed');

const makeKey = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  return {
    publicKeyDerBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKeyDerBase64: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
};
const save = (state) => {
  const temporary = `${statePath}.tmp`;
  writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  renameSync(temporary, statePath);
};
let state;
if (existsSync(statePath)) {
  state = JSON.parse(readFileSync(statePath, 'utf8'));
  if (state.policyId !== POLICY_ID || state.policyHash !== POLICY_HASH ||
      state.wallet !== account.wallet || state.walletId !== account.wallet_id ||
      state.userId !== account.user_id || state.policyOwnerId !== policy.owner_id)
    throw new Error('Existing bootstrap state differs from reviewed wallet or policy');
} else {
  state = {
    policyId: POLICY_ID,
    policyHash: POLICY_HASH,
    policyOwnerId: policy.owner_id,
    wallet: account.wallet,
    walletId: account.wallet_id,
    userId: account.user_id,
    api: makeKey(),
    gate: makeKey(),
  };
  save(state);
}
for (const key of [state.api, state.gate]) {
  const derived = createPublicKey(createPrivateKey({
    key: Buffer.from(key.privateKeyDerBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  })).export({ type: 'spki', format: 'der' }).toString('base64');
  if (derived !== key.publicKeyDerBase64)
    throw new Error('Stored authorization key pair is inconsistent');
}
if (state.api.publicKeyDerBase64 === state.gate.publicKeyDerBase64)
  throw new Error('API and gate keys are not distinct');
const existing = [];
for await (const quorum of privy.keyQuorums().list()) existing.push(quorum);
const ownerQuorum = existing.find((quorum) => quorum.id === state.policyOwnerId);
if (!ownerQuorum || !ownerQuorum.authorization_keys?.length ||
    ownerQuorum.authorization_keys?.some((member) =>
      [state.api.publicKeyDerBase64, state.gate.publicKeyDerBase64].includes(member.public_key)))
  throw new Error('Trade keys must differ from policy-owner keys');
const same = existing.find((quorum) =>
  quorum.authorization_threshold === 2 &&
  quorum.authorization_keys?.length === 2 &&
  [state.api.publicKeyDerBase64, state.gate.publicKeyDerBase64].every((key) =>
    quorum.authorization_keys.some((member) => member.public_key === key)));
if (state.quorumId && same?.id !== state.quorumId)
  throw new Error('Stored two-key quorum differs from Privy');
if (!same) {
  const created = await privy.keyQuorums().create({
    authorization_threshold: 2,
    display_name: 'oren owner trial two-key trade signer',
    public_keys: [state.api.publicKeyDerBase64, state.gate.publicKeyDerBase64],
  });
  state.quorumId = created.id;
  save(state);
} else {
  state.quorumId = same.id;
  save(state);
}
if (state.quorumId === state.policyOwnerId)
  throw new Error('Trade signer quorum must differ from policy owner');
console.log(JSON.stringify({
  walletMatchedByPolicyAccounts: true,
  walletSignerCount: 0,
  twoKeyQuorumReady: true,
  keysStoredOnlyOnVps: true,
}));
