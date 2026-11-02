import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

const adminUrl = process.env.MCP_TEST_POSTGRES_URL;
if (!adminUrl?.includes('/oren_mcp_test'))
  throw new Error('Role test requires the disposable oren_mcp_test database');
const admin = postgres(adminUrl);
const api = postgres(adminUrl.replace('oren_test:oren_test@', 'oren_api_runtime:api_test_password@'));
const gate = postgres(adminUrl.replace('oren_test:oren_test@', 'oren_signer_gate:gate_test_password@'));
const userId = `role-test-${randomUUID()}`;
const wallet = `wallet-${randomUUID()}`;
const walletId = `wallet-id-${randomUUID()}`;
const grantId = `grant-${randomUUID()}`;
const clientId = `client-${randomUUID()}`;
const approvalId = randomUUID();

try {
  const [delegation] = await admin`
    INSERT INTO mcp_trade_delegations
      (user_id, wallet_id, wallet, status, signer_id, policy_id,
       policy_hash, policy_tier, per_trade_limit_usd, daily_limit_usd,
       max_slippage_bps, expires_at)
    VALUES (${userId}, ${walletId}, ${wallet}, 'active', 'proof-signer',
      'proof-policy', 'proof-hash', 1, 25, 50, 50, now() + interval '1 day')
    RETURNING id
  `;
  const [browserIntent] = await admin`
    INSERT INTO mcp_trade_intents
      (grant_id, client_id, user_id, wallet, asset_id, ticker,
       slippage_bps, expires_at)
    VALUES (${grantId}, ${clientId}, ${userId}, ${wallet}, 'proof-stock',
      'PROOF', 50, now() + interval '10 minutes')
    RETURNING id
  `;
  await api`
    UPDATE mcp_trade_intents SET approval_id = ${approvalId},
      status = 'executing' WHERE id = ${browserIntent.id}
  `;
  const [delegatedIntent] = await admin`
    INSERT INTO mcp_trade_intents
      (grant_id, client_id, user_id, wallet, asset_id, ticker,
       slippage_bps, expires_at, mode, delegation_id)
    VALUES (${grantId}, ${clientId}, ${userId}, ${wallet}, 'proof-stock',
      'PROOF', 50, now() + interval '10 minutes', 'delegated',
      ${delegation.id})
    RETURNING id
  `;
  await api`
    UPDATE mcp_trade_intents SET mode = 'browser', delegation_id = NULL
    WHERE id = ${delegatedIntent.id}
  `;
  const [claimedIntent] = await admin`
    INSERT INTO mcp_trade_intents
      (grant_id, client_id, user_id, wallet, asset_id, ticker,
       slippage_bps, expires_at, mode, delegation_id)
    VALUES (${grantId}, ${clientId}, ${userId}, ${wallet}, 'proof-stock',
      'PROOF', 50, now() + interval '10 minutes', 'delegated',
      ${delegation.id})
    RETURNING id
  `;
  await gate`
    INSERT INTO mcp_budget_reservations
      (delegation_id, intent_id, amount_usd)
    VALUES (${delegation.id}, ${claimedIntent.id}, 1)
  `;
  await assert.rejects(
    api`UPDATE mcp_trade_intents SET mode = 'browser',
      delegation_id = NULL WHERE id = ${claimedIntent.id}`,
    /claimed delegated intent/,
  );
  await assert.rejects(
    api`UPDATE mcp_trade_delegations SET per_trade_limit_usd = 100
      WHERE id = ${delegation.id}`,
    /permission denied/,
  );
  await assert.rejects(
    api`INSERT INTO mcp_budget_reservations
      (delegation_id, intent_id, amount_usd)
      VALUES (${delegation.id}, ${browserIntent.id}, 1)`,
    /permission denied/,
  );
  console.log('Signer-gate Postgres role boundaries passed');
} finally {
  await Promise.all([admin.end(), api.end(), gate.end()]);
}
