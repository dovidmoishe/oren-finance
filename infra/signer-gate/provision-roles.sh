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
test -f .release.env
test -f infra/signer-gate/roles.sql
for file in .env.api .env.signer-gate .env.signer-gate.pending; do
  if [ -e "$file" ]; then
    echo 'Signer-gate runtime files already exist; inspect them before retrying.' >&2
    exit 1
  fi
done

compose=(docker compose --env-file .env --env-file .release.env -f deploy.yml)
admin_role=$("${compose[@]}" exec -T db sh -c 'printf %s "$POSTGRES_USER"')
database=$("${compose[@]}" exec -T db sh -c 'printf %s "$POSTGRES_DB"')
[[ "$admin_role" =~ ^[a-zA-Z_][a-zA-Z_0-9]*$ ]]
[[ "$database" =~ ^[a-zA-Z_][a-zA-Z_0-9]*$ ]]
current_role=$("${compose[@]}" exec -T api node -e 'process.stdout.write(new URL(process.env.POSTGRES_URL).username)')
if [ "$current_role" = oren_api_runtime ]; then
  echo 'API already uses the restricted role; inspect before retrying.' >&2
  exit 1
fi
"${compose[@]}" exec -T api node -e '
  if (process.env.MCP_DELEGATED_TRADES_ENABLED === "true") process.exit(1);
'

api_password=$(openssl rand -hex 32)
gate_password=$(openssl rand -hex 32)
{
  printf '\\set api_password %s\n' "$api_password"
  printf '\\set gate_password %s\n' "$gate_password"
  cat infra/signer-gate/roles.sql
} | "${compose[@]}" exec -T db sh -c \
  'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  >/dev/null

api_file=$(mktemp /opt/oren/.env.api.XXXXXX)
gate_file=$(mktemp /opt/oren/.env.signer-gate.pending.XXXXXX)
trap 'rm -f "$api_file" "$gate_file"' EXIT
printf 'POSTGRES_URL=postgresql://oren_api_runtime:%s@db:5432/%s\nMCP_DELEGATED_TRADES_ENABLED=false\n' \
  "$api_password" "$database" > "$api_file"
printf 'POSTGRES_URL=postgresql://oren_signer_gate:%s@db:5432/%s\n' \
  "$gate_password" "$database" > "$gate_file"
chmod 600 "$api_file" "$gate_file"
mv "$api_file" .env.api
mv "$gate_file" .env.signer-gate.pending
unset api_password gate_password

restore() {
  rm -f .env.api .env.signer-gate.pending
  "${compose[@]}" up -d --no-deps --wait --wait-timeout 120 api >/dev/null || true
}
trap restore ERR
"${compose[@]}" up -d --no-deps --wait --wait-timeout 120 api >/dev/null
"${compose[@]}" exec -T api node -e '
  if (new URL(process.env.POSTGRES_URL).username !== "oren_api_runtime" ||
      process.env.POSTGRES_USER || process.env.POSTGRES_PASSWORD ||
      process.env.SIGNER_GATE_PRIVATE_KEY ||
      process.env.MCP_DELEGATED_TRADES_ENABLED === "true") process.exit(1);
'
"${compose[@]}" exec -T api node -e '
  const sql = require("postgres")(process.env.POSTGRES_URL, { max: 1 });
  sql`select current_user as role`.then(([row]) => {
    if (row.role !== "oren_api_runtime") process.exitCode = 1;
  }).catch(() => { process.exitCode = 1; }).finally(() => sql.end());
'
trap - ERR
echo 'Restricted API role is active; signer gate remains disabled.'
