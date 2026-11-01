import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrivyClient } from '@privy-io/node';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

if (process.env.PROOF_TEST_POLICY_OWNER !== 'true')
  throw new Error('Set PROOF_TEST_POLICY_OWNER=true for this manual proof step');
if (!process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET)
  throw new Error('Privy app credentials are required');
const keys = JSON.parse(readFileSync(
  fileURLToPath(new URL('../.proof/quorum-keys.json', import.meta.url)), 'utf8',
));
const result = JSON.parse(readFileSync(
  fileURLToPath(new URL('../.proof/jupiter-buy.created.json', import.meta.url)), 'utf8',
));
const candidate = JSON.parse(readFileSync(
  fileURLToPath(new URL('../.proof/jupiter-buy.policy.json', import.meta.url)), 'utf8',
));
if (
  !keys.admin?.quorumId ||
  !keys.signer?.quorumId ||
  keys.admin.quorumId === keys.signer.quorumId ||
  candidate.owner_id !== keys.admin.quorumId ||
  !result.policyId
) throw new Error('Proof owner/signer policy identity is inconsistent');

const privy = new PrivyClient({
  appId: process.env.PRIVY_APP_ID,
  appSecret: process.env.PRIVY_APP_SECRET,
});
const before = await privy.policies().get(result.policyId);
if (before.owner_id !== keys.admin.quorumId || before.name !== candidate.name)
  throw new Error('Proof policy changed before owner test');
const attempts = [];
for (const [name, authorizationContext] of [
  ['app_secret_only', undefined],
  ['trade_signer', {
    authorization_private_keys: [keys.signer.privateKeyDerBase64],
  }],
]) {
  try {
    await privy.policies().update(result.policyId, {
      name: before.name,
      ...(authorizationContext ? { authorization_context: authorizationContext } : {}),
    });
    attempts.push({ name, denied: false });
  } catch (error) {
    attempts.push({ name, denied: true, status: error?.status ?? null });
  }
}
if (attempts.some((attempt) => !attempt.denied))
  throw new Error(`Unauthorized no-op policy update was allowed: ${JSON.stringify(attempts)}`);

const adminResult = await privy.policies().update(result.policyId, {
  name: before.name,
  authorization_context: {
    authorization_private_keys: [keys.admin.privateKeyDerBase64],
  },
});
if (adminResult.owner_id !== keys.admin.quorumId || adminResult.name !== before.name)
  throw new Error('Policy admin no-op update did not retain owner and name');
const after = await privy.policies().get(result.policyId);
if (after.owner_id !== before.owner_id || after.rules?.length !== before.rules?.length)
  throw new Error('Policy changed during owner test');
console.log(JSON.stringify({
  policyId: result.policyId,
  unauthorizedAttempts: attempts,
  adminNoOpUpdateAllowed: true,
  ownerAndRuleCountUnchanged: true,
}));
