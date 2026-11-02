#!/usr/bin/env bash
set -euo pipefail

cd /opt/oren
umask 077
test -f .env.api
test -f .env.signer-gate
compose=(docker compose --env-file .env --env-file .release.env -f deploy.yml)

# Stop signing immediately, even if restarting the disabled gate later fails.
"${compose[@]}" --profile delegated-trades stop signer-gate >/dev/null 2>&1 ||
  docker stop oren-signer-gate-1 >/dev/null
api_file=$(mktemp /opt/oren/.env.api.kill.XXXXXX)
gate_file=$(mktemp /opt/oren/.env.signer-gate.kill.XXXXXX)
trap 'rm -f "$api_file" "$gate_file"' EXIT
sed -e 's/^MCP_DELEGATED_TRADES_ENABLED=true$/MCP_DELEGATED_TRADES_ENABLED=false/' \
    -e 's/^MCP_DELEGATED_BUYS_ENABLED=true$/MCP_DELEGATED_BUYS_ENABLED=false/' \
    -e 's/^MCP_DELEGATED_SELLS_ENABLED=true$/MCP_DELEGATED_SELLS_ENABLED=false/' \
    .env.api > "$api_file"
sed -e 's/^SIGNER_GATE_ENABLED=true$/SIGNER_GATE_ENABLED=false/' \
    -e 's/^SIGNER_GATE_BUYS_ENABLED=true$/SIGNER_GATE_BUYS_ENABLED=false/' \
    -e 's/^SIGNER_GATE_SELLS_ENABLED=true$/SIGNER_GATE_SELLS_ENABLED=false/' \
    .env.signer-gate > "$gate_file"
chmod 600 "$api_file" "$gate_file"
mv "$api_file" .env.api
mv "$gate_file" .env.signer-gate
"${compose[@]}" up -d --no-deps --wait --wait-timeout 120 api >/dev/null
"${compose[@]}" --profile delegated-trades up -d --no-deps --wait --wait-timeout 120 signer-gate >/dev/null
"${compose[@]}" exec -T api node -e '
  if (process.env.MCP_DELEGATED_TRADES_ENABLED !== "false") process.exit(1);
  fetch("http://signer-gate:3001/health").then(r => r.json()).then(body => {
    if (!body.ok || body.signingEnabled !== false) process.exitCode = 1;
  }).catch(() => { process.exitCode = 1; });
'
echo 'Owner-only delegated trading is disabled; signer grant still requires browser revocation.'
