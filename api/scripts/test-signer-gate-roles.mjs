import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

const adminUrl = process.env.MCP_TEST_POSTGRES_URL;
if (!adminUrl || !/^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:localhost|127\.0\.0\.1):\d+\/oren_mcp_test(?:\?|$)/.test(adminUrl))
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
  for (const connection of [api, gate]) {
    const [role] = await connection`SELECT rolsuper, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    assert.deepEqual(role, { rolsuper: false, rolcreaterole: false, rolbypassrls: false });
    const [ownership] = await connection`SELECT count(*)::integer AS owned FROM pg_tables
      WHERE schemaname='public' AND tableowner=current_user`;
    assert.equal(ownership.owned, 0);
  }
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
       slippage_bps, expires_at, mode, delegation_id, amount_usd, max_in_raw)
    VALUES (${grantId}, ${clientId}, ${userId}, ${wallet}, 'proof-stock',
      'PROOF', 50, now() + interval '10 minutes', 'delegated',
      ${delegation.id}, 1, '1000000')
    RETURNING id
  `;
  await api`
    UPDATE mcp_trade_intents SET mode = 'browser', delegation_id = NULL
    WHERE id = ${delegatedIntent.id}
  `;
  const [claimedIntent] = await admin`
    INSERT INTO mcp_trade_intents
      (grant_id, client_id, user_id, wallet, asset_id, ticker,
       slippage_bps, expires_at, mode, delegation_id, amount_usd, max_in_raw)
    VALUES (${grantId}, ${clientId}, ${userId}, ${wallet}, 'proof-stock',
      'PROOF', 50, now() + interval '10 minutes', 'delegated',
      ${delegation.id}, 1, '1000000')
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
  const apiGrantId = randomUUID();
  await api`INSERT INTO mcp_api_trade_grants
    (id,user_id,wallet_id,wallet,signer_id,policy_id,per_trade_limit_usd,daily_limit_usd,
      max_slippage_bps,allow_sell,expires_at)
    VALUES (${apiGrantId},${userId},${walletId},${wallet},'signer','policy',1,2,50,false,now()+interval '1 hour')`;
  await api`INSERT INTO mcp_api_trade_authorizations
    (intent_id,delegation_id,execution_id,idempotency_key,canonical_request_base64,amount_usd)
    VALUES (${claimedIntent.id},${apiGrantId},${randomUUID()},'role-test-key','canonical-fixture',1)`;
  for (const statement of [
    gate`SELECT * FROM mcp_api_trade_grants`,
    gate`UPDATE mcp_api_trade_grants SET daily_limit_usd=50 WHERE id=${apiGrantId}`,
    gate`DELETE FROM mcp_api_trade_authorizations WHERE intent_id=${claimedIntent.id}`,
    api`DELETE FROM mcp_api_trade_authorizations WHERE intent_id=${claimedIntent.id}`,
    api`UPDATE mcp_api_trade_authorizations SET amount_usd=0.01 WHERE intent_id=${claimedIntent.id}`,
  ]) await assert.rejects(statement, /permission denied/);
  await assert.rejects(api`INSERT INTO mcp_trade_intents
    (grant_id,client_id,user_id,wallet,asset_id,ticker,slippage_bps,expires_at,mode,amount_usd,max_in_raw)
    VALUES (${grantId},${clientId},${userId},${wallet},'stock','TEST',50,now()+interval '5 minutes','delegated',0.01,'1000000')`,
  /mcp_delegated_buy_raw_usd_consistent/);
  console.log('Signer-gate and independent API Postgres role boundaries passed');
} finally {
  await Promise.all([admin.end(), api.end(), gate.end()]);
}
