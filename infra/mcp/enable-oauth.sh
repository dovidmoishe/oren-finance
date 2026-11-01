#!/usr/bin/env bash
set -euo pipefail

cd /opt/oren
umask 077
expected_sha="${1:?expected deployed master commit SHA}"
[[ "$expected_sha" =~ ^[a-f0-9]{40}$ ]]
running_image=$(docker inspect --format '{{.Config.Image}}' oren-api-1)
[[ "$running_image" == *":$expected_sha" ]] || {
  echo 'The expected master release is not running yet.' >&2
  exit 1
}

if grep -qx 'MCP_OAUTH_ENABLED=true' .env; then
  echo 'MCP OAuth is already configured; verify it before making changes.' >&2
  exit 1
fi
if awk '/^MCP_OAUTH_/ && $0 != "MCP_OAUTH_ENABLED=false" { found=1 } /^MCP_APP_ORIGIN=/ { found=1 } END { exit !found }' .env; then
  echo 'Existing MCP OAuth configuration requires manual review.' >&2
  exit 1
fi
grep -qx 'DOMAIN=oren.finance' .env
grep -qx 'API_DOMAIN=api.oren.finance' .env
test -f .release.env

image=$(docker inspect --format '{{.Image}}' oren-api-1)
test -n "$image"
storage_key=$(openssl rand -base64 48 | tr -d '\n')
cookie_key_one=$(openssl rand -hex 32)
cookie_key_two=$(openssl rand -hex 32)
jwks=$(docker run --rm --network none --entrypoint node "$image" -e '
  const { generateKeyPairSync, randomUUID } = require("node:crypto");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
  const key = privateKey.export({ format: "jwk" });
  key.kid = randomUUID(); key.use = "sig"; key.alg = "RS256";
  process.stdout.write(JSON.stringify({ keys: [key] }));
')
test -n "$jwks"

temporary_env=$(mktemp /opt/oren/.env.mcp.XXXXXX)
trap 'rm -f "$temporary_env"' EXIT
cp .env "$temporary_env"
sed -i '/^MCP_OAUTH_ENABLED=false$/d' "$temporary_env"
printf '\n' >> "$temporary_env"
cat >> "$temporary_env" <<EOF
MCP_OAUTH_ENABLED=true
MCP_OAUTH_ISSUER=https://api.oren.finance/oauth
MCP_APP_ORIGIN=https://oren.finance
MCP_OAUTH_STORAGE_KEY=$storage_key
MCP_OAUTH_COOKIE_KEYS=$cookie_key_one,$cookie_key_two
MCP_OAUTH_JWKS=$jwks
EOF
chmod 600 "$temporary_env"
unset storage_key cookie_key_one cookie_key_two jwks

docker run --rm --network none --env-file "$temporary_env" --entrypoint node "$image" -e '
  const { createMcpOAuthRuntime } = require("/app/dist/src/mcp-auth/oauth-runtime.js");
  createMcpOAuthRuntime({}, process.env)
    .then(runtime => { if (!runtime) process.exitCode = 1; })
    .catch(error => { console.error(error.name); process.exitCode = 1; });
'

backup="/opt/oren/backups/oren-pre-mcp-oauth-$(date -u +%Y%m%dT%H%M%SZ).env"
install -m 600 .env "$backup"
mv "$temporary_env" .env
trap - EXIT

restore() {
  install -m 600 "$backup" .env
  docker compose --env-file .env --env-file .release.env -f deploy.yml up -d --no-deps --wait --wait-timeout 120 api || true
}

if ! docker compose --env-file .env --env-file .release.env -f deploy.yml up -d --no-deps --wait --wait-timeout 120 api; then
  restore
  exit 1
fi

if ! curl --fail --silent --show-error --max-time 15 https://api.oren.finance/.well-known/oauth-protected-resource/mcp | jq -e '.resource == "https://api.oren.finance/mcp"' >/dev/null; then
  restore
  exit 1
fi

if ! curl --fail --silent --show-error --max-time 15 https://api.oren.finance/oauth/.well-known/openid-configuration | jq -e '.registration_endpoint == "https://api.oren.finance/oauth/reg"' >/dev/null; then
  restore
  exit 1
fi

registration=$(mktemp /opt/oren/.mcp-registration.XXXXXX)
trap 'rm -f "$registration"' EXIT
if ! curl --fail --silent --show-error --max-time 15 -o "$registration" \
  -H 'Content-Type: application/json' \
  --data '{"redirect_uris":["https://claude.ai/api/mcp/auth_callback"],"token_endpoint_auth_method":"none","response_types":["code"],"grant_types":["authorization_code","refresh_token"],"client_name":"Oren Claude acceptance smoke"}' \
  https://api.oren.finance/oauth/reg || ! jq -e '.client_id and .token_endpoint_auth_method == "none"' "$registration" >/dev/null; then
  restore
  exit 1
fi

echo 'MCP OAuth is enabled; discovery and Claude client registration passed.'
