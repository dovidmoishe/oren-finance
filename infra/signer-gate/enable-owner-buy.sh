#!/usr/bin/env bash
set -euo pipefail

cd /opt/oren
umask 077
expected_sha="${1:?expected deployed master SHA}"
[[ "$expected_sha" =~ ^[a-f0-9]{40}$ ]]
running_image=$(docker inspect --format '{{.Config.Image}}' oren-api-1)
[[ "$running_image" == *":$expected_sha" ]] || {
  echo 'Expected owner-trial release is not running.' >&2
  exit 1
}
test -f .env.api
test -f .env.signer-gate
test ! -e .env.signer-gate.pending
test -f .signer-gate-bootstrap/keys.json
test -f infra/signer-gate/verify-owner-buy.mjs
for pair in '.env.api:MCP_DELEGATED_TRADES_ENABLED=false' \
            '.env.api:MCP_DELEGATED_BUYS_ENABLED=false' \
            '.env.api:MCP_DELEGATED_SELLS_ENABLED=false' \
            '.env.signer-gate:SIGNER_GATE_ENABLED=false' \
            '.env.signer-gate:SIGNER_GATE_BUYS_ENABLED=false' \
            '.env.signer-gate:SIGNER_GATE_SELLS_ENABLED=false'; do
  file=${pair%%:*}
  setting=${pair#*:}
  test "$(grep -Fxc "$setting" "$file")" = 1
done

compose=(docker compose --env-file .env --env-file .release.env -f deploy.yml)
proof_wallet_id=$(jq -r '.walletId // empty' .signer-gate-bootstrap/keys.json)
proof_wallet=$(jq -r '.wallet // empty' .signer-gate-bootstrap/keys.json)
proof_user_id=$(jq -r '.userId // empty' .signer-gate-bootstrap/keys.json)
test -n "$proof_wallet_id"
test -n "$proof_wallet"
test -n "$proof_user_id"
"${compose[@]}" --profile delegated-trades run --rm --no-deps \
  -e "PROOF_WALLET_ID=$proof_wallet_id" \
  -e "PROOF_WALLET_ADDRESS=$proof_wallet" \
  -e "PROOF_USER_ID=$proof_user_id" \
  -v "$PWD/infra/signer-gate/verify-owner-buy.mjs:/app/verify-owner-buy.mjs:ro" \
  --entrypoint node signer-gate /app/verify-owner-buy.mjs
"${compose[@]}" run --rm --no-deps --entrypoint node api -e '
  const { validateEnv } = require("/app/dist/src/config/env.schema.js");
  const env = validateEnv({ ...process.env,
    MCP_DELEGATED_TRADES_ENABLED: "true",
    MCP_DELEGATED_BUYS_ENABLED: "true",
    MCP_DELEGATED_SELLS_ENABLED: "false",
  });
  if (!env.MCP_DELEGATED_BUYS_ENABLED || env.MCP_DELEGATED_SELLS_ENABLED)
    process.exit(1);
'

api_backup="/opt/oren/backups/oren-pre-owner-buy-$(date -u +%Y%m%dT%H%M%SZ).env.api"
gate_backup="/opt/oren/backups/oren-pre-owner-buy-$(date -u +%Y%m%dT%H%M%SZ).env.signer-gate"
install -m 600 .env.api "$api_backup"
install -m 600 .env.signer-gate "$gate_backup"
api_file=$(mktemp /opt/oren/.env.api.owner-buy.XXXXXX)
gate_file=$(mktemp /opt/oren/.env.signer-gate.owner-buy.XXXXXX)
trap 'rm -f "$api_file" "$gate_file"' EXIT
sed -e 's/^MCP_DELEGATED_TRADES_ENABLED=false$/MCP_DELEGATED_TRADES_ENABLED=true/' \
    -e 's/^MCP_DELEGATED_BUYS_ENABLED=false$/MCP_DELEGATED_BUYS_ENABLED=true/' \
    .env.api > "$api_file"
sed -e 's/^SIGNER_GATE_ENABLED=false$/SIGNER_GATE_ENABLED=true/' \
    -e 's/^SIGNER_GATE_BUYS_ENABLED=false$/SIGNER_GATE_BUYS_ENABLED=true/' \
    .env.signer-gate > "$gate_file"
chmod 600 "$api_file" "$gate_file"
mv "$api_file" .env.api
mv "$gate_file" .env.signer-gate

restore() {
  "${compose[@]}" --profile delegated-trades stop signer-gate >/dev/null 2>&1 || true
  install -m 600 "$api_backup" .env.api
  install -m 600 "$gate_backup" .env.signer-gate
  "${compose[@]}" --profile delegated-trades up -d --no-deps --wait --wait-timeout 120 signer-gate >/dev/null || true
  "${compose[@]}" up -d --no-deps --wait --wait-timeout 120 api >/dev/null || true
}
trap restore ERR
"${compose[@]}" --profile delegated-trades up -d --no-deps --wait --wait-timeout 120 signer-gate >/dev/null
"${compose[@]}" up -d --no-deps --wait --wait-timeout 120 api >/dev/null
"${compose[@]}" exec -T api node -e '
  if (process.env.MCP_DELEGATED_TRADES_ENABLED !== "true" ||
      process.env.MCP_DELEGATED_BUYS_ENABLED !== "true" ||
      process.env.MCP_DELEGATED_SELLS_ENABLED !== "false" ||
      new URL(process.env.POSTGRES_URL).username !== "oren_api_runtime" ||
      process.env.SIGNER_GATE_PRIVATE_KEY) process.exit(1);
  fetch("http://signer-gate:3001/health").then(r => r.json()).then(body => {
    if (!body.ok || body.signingEnabled !== true) process.exitCode = 1;
  }).catch(() => { process.exitCode = 1; });
'
"${compose[@]}" --profile delegated-trades exec -T signer-gate node -e '
  if (process.env.SIGNER_GATE_ENABLED !== "true" ||
      process.env.SIGNER_GATE_BUYS_ENABLED !== "true" ||
      process.env.SIGNER_GATE_SELLS_ENABLED !== "false" ||
      new URL(process.env.POSTGRES_URL).username !== "oren_signer_gate" ||
      process.env.PRIVY_MCP_SIGNER_PRIVATE_KEY) process.exit(1);
'
trap - ERR
echo 'Owner-only Jupiter buy trial is enabled; sells remain disabled.'
