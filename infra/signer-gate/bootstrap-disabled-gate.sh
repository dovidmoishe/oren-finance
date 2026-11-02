#!/usr/bin/env bash
set -euo pipefail

cd /opt/oren
umask 077
expected_sha="${1:?expected deployed master SHA}"
[[ "$expected_sha" =~ ^[a-f0-9]{40}$ ]]
running_image=$(docker inspect --format '{{.Config.Image}}' oren-api-1)
[[ "$running_image" == *":$expected_sha" ]] || {
  echo 'Expected disabled release is not running.' >&2
  exit 1
}
test -f .env.api
test -f .env.signer-gate.pending
test ! -e .env.signer-gate
test -f infra/signer-gate/bootstrap-keys.mjs
if grep -Eq '^(PRIVY_MCP_SIGNER_PRIVATE_KEY|SIGNER_GATE_API_TOKEN)=' .env.api; then
  echo 'API signer configuration already exists; inspect before retrying.' >&2
  exit 1
fi

compose=(docker compose --env-file .env --env-file .release.env -f deploy.yml)
"${compose[@]}" exec -T api node -e '
  if (process.env.MCP_DELEGATED_TRADES_ENABLED === "true" ||
      new URL(process.env.POSTGRES_URL).username !== "oren_api_runtime") process.exit(1);
'
state_dir=/opt/oren/.signer-gate-bootstrap
install -d -m 700 "$state_dir"
"${compose[@]}" run --rm --no-deps \
  --user "$(id -u):$(id -g)" \
  -v "$PWD/infra/signer-gate/bootstrap-keys.mjs:/app/bootstrap-keys.mjs:ro" \
  -v "$state_dir:/state" --entrypoint node api /app/bootstrap-keys.mjs
test -f "$state_dir/keys.json"
test "$(stat -c %a "$state_dir/keys.json")" = 600

read_state() { jq -r --arg key "$1" '.[$key] // empty' "$state_dir/keys.json"; }
api_private=$(jq -r '.api.privateKeyDerBase64 // empty' "$state_dir/keys.json")
api_public=$(jq -r '.api.publicKeyDerBase64 // empty' "$state_dir/keys.json")
gate_private=$(jq -r '.gate.privateKeyDerBase64 // empty' "$state_dir/keys.json")
quorum_id=$(read_state quorumId)
policy_id=$(read_state policyId)
policy_owner_id=$(read_state policyOwnerId)
policy_hash=$(read_state policyHash)
owner_user_id=$(read_state userId)
for value in "$api_private" "$api_public" "$gate_private" "$quorum_id" \
             "$policy_id" "$policy_owner_id" "$policy_hash" "$owner_user_id"; do
  test -n "$value"
  [[ "$value" != *$'\n'* ]]
done
api_token=$(openssl rand -hex 32)
api_backup="/opt/oren/backups/oren-pre-signer-gate-$(date -u +%Y%m%dT%H%M%SZ).env.api"
install -m 600 .env.api "$api_backup"
api_file=$(mktemp /opt/oren/.env.api.gate.XXXXXX)
gate_file=$(mktemp /opt/oren/.env.signer-gate.XXXXXX)
trap 'rm -f "$api_file" "$gate_file"' EXIT
cp .env.api "$api_file"
cat >> "$api_file" <<EOF
PRIVY_MCP_SIGNER_QUORUM_ID=$quorum_id
PRIVY_MCP_SIGNER_PRIVATE_KEY=$api_private
PRIVY_POLICY_ADMIN_QUORUM_ID=$policy_owner_id
SIGNER_GATE_URL=http://signer-gate:3001
SIGNER_GATE_API_TOKEN=$api_token
MCP_DELEGATED_TRADES_ALLOWED_USERS=$owner_user_id
MCP_DELEGATED_BUYS_ENABLED=false
MCP_DELEGATED_SELLS_ENABLED=false
EOF
cat .env.signer-gate.pending > "$gate_file"
cat >> "$gate_file" <<EOF
SIGNER_GATE_ENABLED=false
SIGNER_GATE_PORT=3001
SIGNER_GATE_API_TOKEN=$api_token
SIGNER_GATE_API_PUBLIC_KEY=$api_public
SIGNER_GATE_PRIVATE_KEY=$gate_private
SIGNER_GATE_QUORUM_ID=$quorum_id
SIGNER_GATE_POLICY_ID=$policy_id
SIGNER_GATE_POLICY_OWNER_ID=$policy_owner_id
SIGNER_GATE_POLICY_HASH=$policy_hash
SIGNER_GATE_ALLOWED_USERS=$owner_user_id
SIGNER_GATE_BUYS_ENABLED=false
SIGNER_GATE_SELLS_ENABLED=false
EOF
for key in PRIVY_APP_ID PRIVY_APP_SECRET ALCHEMY_API_KEY TOKENS_API_KEY; do
  line=$(grep -m 1 "^${key}=" .env || true)
  if [ -z "$line" ]; then
    echo 'A required gate provider setting is missing.' >&2
    exit 1
  fi
  printf '%s\n' "$line" >> "$gate_file"
done
for key in TOKENS_API_BASE_URL JUPITER_API_KEY; do
  line=$(grep -m 1 "^${key}=" .env || true)
  if [ -n "$line" ]; then printf '%s\n' "$line" >> "$gate_file"; fi
done
chmod 600 "$api_file" "$gate_file"
mv "$api_file" .env.api
mv "$gate_file" .env.signer-gate
unset api_private api_public gate_private api_token

restore() {
  "${compose[@]}" --profile delegated-trades stop signer-gate >/dev/null 2>&1 || true
  rm -f .env.signer-gate
  install -m 600 "$api_backup" .env.api
  "${compose[@]}" up -d --no-deps --wait --wait-timeout 120 api >/dev/null || true
}
trap restore ERR
"${compose[@]}" up -d --no-deps --wait --wait-timeout 120 api >/dev/null
"${compose[@]}" --profile delegated-trades up -d --no-deps --wait --wait-timeout 120 signer-gate >/dev/null
"${compose[@]}" exec -T api node -e '
  if (new URL(process.env.POSTGRES_URL).username !== "oren_api_runtime" ||
      !process.env.PRIVY_MCP_SIGNER_PRIVATE_KEY ||
      process.env.SIGNER_GATE_PRIVATE_KEY ||
      process.env.MCP_DELEGATED_TRADES_ENABLED === "true") process.exit(1);
  fetch("http://signer-gate:3001/health").then(r => r.json()).then(body => {
    if (!body.ok || body.signingEnabled !== false) process.exitCode = 1;
  }).catch(() => { process.exitCode = 1; });
'
"${compose[@]}" --profile delegated-trades exec -T signer-gate node -e '
  if (new URL(process.env.POSTGRES_URL).username !== "oren_signer_gate" ||
      !process.env.SIGNER_GATE_PRIVATE_KEY ||
      process.env.PRIVY_MCP_SIGNER_PRIVATE_KEY ||
      process.env.SIGNER_GATE_ENABLED === "true") process.exit(1);
  const sql = require("postgres")(process.env.POSTGRES_URL, { max: 1 });
  sql`select current_user as role`.then(([row]) => {
    if (row.role !== "oren_signer_gate") process.exitCode = 1;
  }).catch(() => { process.exitCode = 1; }).finally(() => sql.end());
'
test -z "$(docker port oren-signer-gate-1)"
rm -f .env.signer-gate.pending
trap - ERR
echo 'Separate two-key quorum and private gate are ready; all signing flags remain off.'
