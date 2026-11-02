#!/usr/bin/env bash
set -euo pipefail

cd /opt/oren
expected_sha="${1:?expected deployed master SHA}"
[[ "$expected_sha" =~ ^[a-f0-9]{40}$ ]]
running_image=$(docker inspect --format '{{.Config.Image}}' oren-api-1)
[[ "$running_image" == *":$expected_sha" ]] || {
  echo 'Expected production release is not running.' >&2
  exit 1
}
test -f .signer-gate-bootstrap/keys.json
compose=(docker compose --env-file .env --env-file .release.env -f deploy.yml)

api_token_hash=$("${compose[@]}" exec -T api node -e '
  const { createHash } = require("node:crypto");
  process.stdout.write(createHash("sha256").update(process.env.SIGNER_GATE_API_TOKEN || "").digest("hex"));
')
gate_token_hash=$("${compose[@]}" --profile delegated-trades exec -T signer-gate node -e '
  const { createHash } = require("node:crypto");
  process.stdout.write(createHash("sha256").update(process.env.SIGNER_GATE_API_TOKEN || "").digest("hex"));
')
test "$api_token_hash" = "$gate_token_hash"
echo 'API and gate authorization tokens match.'
"${compose[@]}" exec -T api node -e '
  fetch("http://signer-gate:3001/health", { signal: AbortSignal.timeout(5000) })
    .then(async response => {
      const body = await response.json();
      console.log(JSON.stringify({
        apiCanReachGate: response.ok && body.ok === true,
        gateSigningEnabled: body.signingEnabled === true,
      }));
    })
    .catch(error => {
      console.log(JSON.stringify({ apiCanReachGate: false, errorClass: error?.name || "Unknown" }));
      process.exitCode = 1;
    });
'

proof_wallet_id=$(jq -r '.walletId // empty' .signer-gate-bootstrap/keys.json)
proof_user_id=$(jq -r '.userId // empty' .signer-gate-bootstrap/keys.json)
test -n "$proof_wallet_id"
test -n "$proof_user_id"
"${compose[@]}" --profile delegated-trades exec -T \
  -e "PROOF_WALLET_ID=$proof_wallet_id" \
  -e "PROOF_USER_ID=$proof_user_id" signer-gate node -e '
  const { PrivyClient } = require("@privy-io/node");
  const postgres = require("postgres");
  (async () => {
    const privy = new PrivyClient({ appId: process.env.PRIVY_APP_ID, appSecret: process.env.PRIVY_APP_SECRET });
    const [wallet, user] = await Promise.all([
      privy.wallets().get(process.env.PROOF_WALLET_ID),
      privy.users()._get(process.env.PROOF_USER_ID),
    ]);
    const sql = postgres(process.env.POSTGRES_URL, { max: 1 });
    try {
      const [row] = await sql`
        SELECT count(*)::int AS grant_count,
          has_table_privilege(current_user, ${"mcp_trade_delegations"}, ${"INSERT"}) AS can_insert_grant,
          has_table_privilege(current_user, ${"mcp_audit_events"}, ${"INSERT"}) AS can_insert_audit
        FROM mcp_trade_delegations WHERE user_id = ${process.env.PROOF_USER_ID}
      `;
      console.log(JSON.stringify({
        walletReachable: wallet.chain_type === "solana",
        userReachable: user.id === process.env.PROOF_USER_ID,
        walletSignerCount: wallet.additional_signers?.length ?? null,
        grantCount: row.grant_count,
        canInsertGrant: row.can_insert_grant,
        canInsertAudit: row.can_insert_audit,
        gateEnabled: process.env.SIGNER_GATE_ENABLED === "true",
        buysEnabled: process.env.SIGNER_GATE_BUYS_ENABLED === "true",
      }));
    } finally { await sql.end(); }
  })().catch(error => {
    console.error("Gate diagnostic failed", error?.name || "Unknown");
    process.exitCode = 1;
  });
'

echo 'Recent grant rejection classes:'
docker logs --since 90m --tail 500 oren-signer-gate-1 2>&1 |
  grep -F 'Signer gate request rejected' | tail -n 20 || true
echo 'Recent API grant rejection codes:'
docker logs --since 90m --tail 500 oren-api-1 2>&1 |
  grep -F 'MCP grant preparation rejected' | tail -n 20 || true
