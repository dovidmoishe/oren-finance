#!/usr/bin/env bash
# Run as the existing deployment user from a reviewed checkout of master.
set -euo pipefail
umask 077
ROOT=/opt/oren/preview
SOURCE=$(cd "$(dirname "$0")" && pwd)
for command in docker jq flock curl openssl; do command -v "$command" >/dev/null || { echo "Missing prerequisite: $command" >&2; exit 1; }; done
install -d -m 750 "$ROOT/control" "$ROOT/sites" "$ROOT/stacks"
for file in manage.sh reconcile.sh connect-caddy.sh access.mjs compose.yml access.compose.yml; do
  install -m 640 "$SOURCE/$file" "$ROOT/control/$file"
done
[[ -f "$ROOT/domain" ]] || printf 'preview.oren.finance\n' > "$ROOT/domain"
[[ -f "$ROOT/privy-origins" ]] || touch "$ROOT/privy-origins"
docker network inspect preview-edge >/dev/null 2>&1 || docker network create preview-edge >/dev/null
if [[ ! -f "$ROOT/access.env" ]]; then
  PASSWORD=$(openssl rand -hex 20)
  printf '%s\n' "$PASSWORD" > "$ROOT/tester-password"
  HASH=$(printf '%s' "$PASSWORD" | docker run --rm -i -v "$ROOT/control/access.mjs:/service/access.mjs:ro" node:22-bookworm-slim node /service/access.mjs hash)
  printf 'PREVIEW_DOMAIN=%s\nPREVIEW_SESSION_KEY=%s\nPREVIEW_PASSWORD_HASH=%s\n' "$(cat "$ROOT/domain")" "$(openssl rand -hex 32)" "$HASH" > "$ROOT/access.env"
  unset PASSWORD HASH
fi
if [[ ! -f "$ROOT/provider.env" ]]; then
  install -m 600 "$SOURCE/provider.env.example" "$ROOT/provider.env"
  echo 'Configure /opt/oren/preview/provider.env with separate preview credentials before deploying a PR.'
fi
chmod 644 "$ROOT/control/access.mjs"
docker compose -f "$ROOT/control/access.compose.yml" up -d
echo 'Preview controller installed. Tester password is stored only in /opt/oren/preview/tester-password (mode 600).'
