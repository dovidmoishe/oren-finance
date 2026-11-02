import { config } from 'dotenv';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { PrivyClient } from '@privy-io/node';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

if (process.env.PROOF_CREATE_POLICY !== 'true')
  throw new Error('Set PROOF_CREATE_POLICY=true for this manual proof step');
const email = process.env.PROOF_WALLET_EMAIL;
const address = process.env.PROOF_WALLET_ADDRESS;
const side = process.env.PROOF_SIDE;
const adminId = process.env.PROOF_POLICY_ADMIN_QUORUM_ID;
if (
  !email || !address || !['buy', 'sell'].includes(side) || !adminId ||
  !process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET
) throw new Error('Set proof email, wallet address, side, admin quorum ID and Privy credentials');

const keyFile = fileURLToPath(new URL('../.proof/quorum-keys.json', import.meta.url));
const policyFile = fileURLToPath(new URL(`../.proof/jupiter-${side}.policy.json`, import.meta.url));
const resultFile = fileURLToPath(new URL(`../.proof/jupiter-${side}.created.json`, import.meta.url));
if (!existsSync(keyFile) || !existsSync(policyFile))
  throw new Error('Proof keys and owner-protected policy candidate must exist locally');
const keys = JSON.parse(readFileSync(keyFile, 'utf8'));
const policy = JSON.parse(readFileSync(policyFile, 'utf8'));
if (
  keys.proofWalletAddress !== address ||
  keys.admin?.quorumId !== adminId ||
  !keys.signer?.quorumId ||
  keys.signer.quorumId === adminId ||
  policy.owner_id !== adminId ||
  policy.chain_type !== 'solana' ||
  policy.rules?.length !== 3 ||
  policy.rules.some((rule) => rule.method !== 'signTransaction') ||
  policy.rules[0].action !== 'DENY' ||
  policy.rules[1].action !== 'ALLOW' ||
  policy.rules[2].action !== 'ALLOW'
) throw new Error('Proof policy or key ownership is inconsistent');
const routeRule = policy.rules[2];
const idlConditions = routeRule.conditions.filter(
  (condition) => condition.field_source === 'solana_instruction_data',
);
if (
  idlConditions.length !== 6 ||
  !routeRule.conditions.some(
    (condition) =>
      condition.field_source === 'solana_program_instruction' &&
      condition.field === 'programId' &&
      condition.value === 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  ) ||
  policy.rules.some((rule) =>
    rule.conditions.some((condition) =>
      condition.value === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    ),
  )
) throw new Error('Proof route conditions are incomplete or allow ATA creation');
const expiry = Number(policy.rules[0].conditions[0]?.value);
const now = Math.floor(Date.now() / 1000);
if (!Number.isInteger(expiry) || expiry <= now || expiry > now + 7 * 86400)
  throw new Error('Proof policy expiry must be in the next seven days');

const privy = new PrivyClient({
  appId: process.env.PRIVY_APP_ID,
  appSecret: process.env.PRIVY_APP_SECRET,
});
const user = await privy.users().getByWalletAddress({ address });
const emailMatches = user.linked_accounts.some(
  (item) => item.type === 'email' && item.address?.toLowerCase() === email.toLowerCase(),
);
const wallets = user.linked_accounts.filter(
  (item) =>
    item.type === 'wallet' && item.chain_type === 'solana' &&
    item.wallet_client_type === 'privy' && typeof item.id === 'string',
);
if (!emailMatches || wallets.length !== 1 || wallets[0].address !== address || wallets[0].delegated)
  throw new Error('Proof wallet identity or signer state changed');
const wallet = await privy.wallets().get(wallets[0].id);
if (!Array.isArray(wallet.additional_signers) || wallet.additional_signers.length !== 0)
  throw new Error('Proof wallet already has a signer');

const policyJson = JSON.stringify(policy);
const policyHash = createHash('sha256').update(policyJson).digest('hex');
function assertStoredPolicy(stored) {
  if (
    stored.owner_id !== adminId ||
    stored.chain_type !== policy.chain_type ||
    stored.version !== policy.version ||
    stored.rules?.length !== policy.rules.length
  ) throw new Error('Privy stored different policy metadata');
  for (const [index, expectedRule] of policy.rules.entries()) {
    const actualRule = stored.rules[index];
    if (
      actualRule.name !== expectedRule.name ||
      actualRule.method !== expectedRule.method ||
      actualRule.action !== expectedRule.action ||
      actualRule.conditions?.length !== expectedRule.conditions.length
    ) throw new Error(`Privy stored different policy rule ${index}`);
    for (const [conditionIndex, expected] of expectedRule.conditions.entries()) {
      const actual = actualRule.conditions[conditionIndex];
      if (
        actual.field_source !== expected.field_source ||
        actual.field !== expected.field ||
        actual.operator !== expected.operator ||
        JSON.stringify(actual.value) !== JSON.stringify(expected.value) ||
        !isDeepStrictEqual(actual.idl ?? null, expected.idl ?? null)
      ) throw new Error(`Privy stored different condition ${index}:${conditionIndex}`);
    }
  }
}
if (existsSync(resultFile)) {
  const result = JSON.parse(readFileSync(resultFile, 'utf8'));
  if (result.policyHash !== policyHash) throw new Error('Created policy differs from local candidate');
  const existing = await privy.policies().get(result.policyId);
  assertStoredPolicy(existing);
  console.log(JSON.stringify({ policyId: result.policyId, ownerId: adminId, storedConditionsVerified: true, existing: true }));
  process.exit(0);
}
const created = await privy.policies().create({
  ...policy,
  idempotency_key: `oren-proof-${policyHash.slice(0, 40)}`,
});
assertStoredPolicy(created);
writeFileSync(resultFile, JSON.stringify({ policyId: created.id, policyHash }), {
  flag: 'wx',
  mode: 0o600,
});
console.log(JSON.stringify({
  policyId: created.id,
  ownerId: created.owner_id,
  side,
  ruleCount: created.rules?.length,
  existing: false,
  walletSignerCount: 0,
}));
