import { createPrivateKey, createPublicKey } from 'node:crypto';
import { PrivyClient } from '@privy-io/node';
import postgres from 'postgres';
import gateModule from '/app/dist/src/signer-gate/signer-gate.service.js';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Owner trial requires ${name}`);
  return value;
};
if (process.env.SIGNER_GATE_ENABLED !== 'false' ||
    process.env.SIGNER_GATE_BUYS_ENABLED !== 'false' ||
    process.env.SIGNER_GATE_SELLS_ENABLED !== 'false')
  throw new Error('Gate signing must still be disabled for owner-trial preflight');
const policyId = required('SIGNER_GATE_POLICY_ID');
const ownerId = required('SIGNER_GATE_POLICY_OWNER_ID');
const quorumId = required('SIGNER_GATE_QUORUM_ID');
const expectedWalletId = required('PROOF_WALLET_ID');
const expectedWallet = required('PROOF_WALLET_ADDRESS');
const expectedUserId = required('PROOF_USER_ID');
if (required('SIGNER_GATE_ALLOWED_USERS') !== expectedUserId)
  throw new Error('Gate owner allowlist differs from the reviewed wallet');

const privy = new PrivyClient({
  appId: required('PRIVY_APP_ID'),
  appSecret: required('PRIVY_APP_SECRET'),
});
const [wallet, policy] = await Promise.all([
  privy.wallets().get(expectedWalletId),
  privy.policies().get(policyId),
]);
if (wallet.address !== expectedWallet || wallet.chain_type !== 'solana' ||
    !Array.isArray(wallet.additional_signers) || wallet.additional_signers.length !== 0)
  throw new Error('Owner wallet has changed or already has a signer');
if (policy.owner_id !== ownerId || ownerId === quorumId ||
    policy.rules?.length !== 3 ||
    policy.rules.some((rule) => rule.method !== 'signTransaction') ||
    gateModule.gatePolicyFingerprint(policy) !== required('SIGNER_GATE_POLICY_HASH') ||
    Number(policy.rules[0].conditions?.[0]?.value) <= Math.floor(Date.now() / 1000) + 3600)
  throw new Error('Owner-reviewed Privy buy policy changed or is near expiry');

const gatePublic = createPublicKey(createPrivateKey({
  key: Buffer.from(required('SIGNER_GATE_PRIVATE_KEY'), 'base64'),
  format: 'der',
  type: 'pkcs8',
})).export({ type: 'spki', format: 'der' }).toString('base64');
const keys = new Set([gatePublic, required('SIGNER_GATE_API_PUBLIC_KEY')]);
if (keys.size !== 2) throw new Error('API and gate keys are not distinct');
const quorums = [];
for await (const quorum of privy.keyQuorums().list()) quorums.push(quorum);
const signer = quorums.find((item) => item.id === quorumId);
const owner = quorums.find((item) => item.id === ownerId);
if (!signer || signer.authorization_threshold !== 2 ||
    signer.authorization_keys?.length !== 2 ||
    ![...keys].every((key) =>
      signer.authorization_keys.some((member) => member.public_key === key)) ||
    !owner || !owner.authorization_keys?.length ||
    owner.authorization_keys.some((member) => keys.has(member.public_key)))
  throw new Error('Privy two-key quorum or separate policy owner changed');

const databaseUrl = required('POSTGRES_URL');
if (new URL(databaseUrl).username !== 'oren_signer_gate')
  throw new Error('Gate no longer uses its restricted database role');
const sql = postgres(databaseUrl, { max: 1 });
try {
  const [row] = await sql`
    SELECT count(*)::int AS count FROM mcp_budget_reservations
    WHERE status = 'reserved'
  `;
  if (row.count !== 0)
    throw new Error('Unresolved budget reservations prevent owner trial');
} finally {
  await sql.end();
}
console.log(JSON.stringify({
  zeroWalletSigners: true,
  twoKeyQuorumVerified: true,
  policyFingerprintVerified: true,
  zeroUnresolvedReservations: true,
  signingEnabled: false,
}));
