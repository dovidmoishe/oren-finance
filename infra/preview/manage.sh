#!/usr/bin/env bash
# Trusted host controller. Install from master; never replace with files from a PR.
set -euo pipefail
umask 077
ROOT=/opt/oren/preview
CONTROL="$ROOT/control"
ACTION="${1:-}"
PR="${2:-}"
[[ "$PR" =~ ^[1-9][0-9]{0,8}$ ]] || { echo 'Invalid PR number' >&2; exit 1; }
[[ "$ACTION" =~ ^(deploy|stop|reset|reconcile)$ ]] || exit 1
command -v jq >/dev/null
command -v flock >/dev/null
mkdir -p "$ROOT/stacks" "$ROOT/sites"
exec 9>"$ROOT/controller.lock"
flock -w 900 9
STACK="$ROOT/stacks/pr-$PR"
PROJECT="oren-pr-$PR"
SITE="$ROOT/sites/pr-$PR.caddy"
dc() { docker compose --project-name "$PROJECT" --env-file "$STACK/release.env" -f "$CONTROL/compose.yml" "$@"; }
reload() {
  docker exec oren-caddy-1 caddy validate --config /etc/caddy/Caddyfile
  docker exec oren-caddy-1 caddy reload --config /etc/caddy/Caddyfile
}
remove_route() { if [[ -f "$SITE" ]]; then rm -- "$SITE"; reload; fi; }
if [[ "$ACTION" == reconcile ]]; then
  [[ -f "$STACK/release.env" ]] || exit 0
  OWNER="${3:-}"; REPO="${4:-}"
  [[ "$OWNER" =~ ^[A-Za-z0-9_.-]+$ && "$REPO" =~ ^[A-Za-z0-9_.-]+$ ]] || exit 1
  read -r TOKEN
  DATA=$(curl --fail --silent --show-error --config <(printf 'header = "Authorization: Bearer %s"\n' "$TOKEN") "https://api.github.com/repos/$OWNER/$REPO/pulls/$PR")
  UPDATED=$(stat -c %Y "$STACK/release.env")
  [[ ! -f "$STACK/state.json" ]] || UPDATED=$(jq -r .deployed "$STACK/state.json")
  if [[ "$(jq -r .state <<< "$DATA")" != closed ]] && (( $(date +%s) - UPDATED < 604800 )); then exit 0; fi
  ACTION=stop
fi
if [[ "$ACTION" != deploy ]]; then
  [[ -f "$STACK/release.env" ]] || exit 0
  if [[ "$ACTION" == reset ]]; then [[ "${3:-}" == "RESET-pr-$PR" ]] || { echo 'Explicit reset token required' >&2; exit 1; }; fi
  OLD_SHA=$(sed -n 's/^COMMIT_SHA=//p' "$STACK/release.env")
  remove_route
  # Exact project and labelled volume only; never use a host-wide prune.
  docker network disconnect "${PROJECT}_edge" oren-caddy-1 2>/dev/null || true
  dc down --volumes --remove-orphans
  rm -f -- "$STACK/release.env" "$STACK/state.json" "$STACK/route.candidate"
  rmdir -- "$STACK" 2>/dev/null || true
  echo "PREVIEW_REMOVED $PR $OLD_SHA"
  exit 0
fi
SHA="${3:-}"; OWNER="${4:-}"; REPO="${5:-}"; PRIVY_ID="${6:-}"
[[ "$SHA" =~ ^[a-f0-9]{40}$ && "$OWNER" =~ ^[a-z0-9-]+$ && "$REPO" =~ ^[A-Za-z0-9_.-]+$ ]] || exit 1
DOMAIN=$(cat "$ROOT/domain")
[[ "$DOMAIN" =~ ^[a-z0-9.-]+$ ]] || exit 1
HOST="pr-$PR.$DOMAIN"
[[ "$PRIVY_ID" =~ ^[A-Za-z0-9_-]+$ ]] || { echo 'Invalid preview Privy ID' >&2; exit 1; }
if ! grep -Fxq "PRIVY_APP_ID=$PRIVY_ID" "$ROOT/provider.env" &&
   ! grep -Fxq "PRIVY_APP_ID=\"$PRIVY_ID\"" "$ROOT/provider.env" &&
   ! grep -Fxq "PRIVY_APP_ID='$PRIVY_ID'" "$ROOT/provider.env"; then
  echo 'Preview Privy ID must match the frontend build' >&2; exit 1
fi
# Explicit origins must be registered in the separate preview Privy application.
if ! grep -Fxq -- "$HOST" "$ROOT/privy-origins" && ! grep -Fxq -- "*.$DOMAIN" "$ROOT/privy-origins"; then
  echo "Register $HOST in preview Privy, then add it to privy-origins" >&2; exit 1
fi
read -r TOKEN
export DOCKER_CONFIG
DOCKER_CONFIG=$(mktemp -d)
ACTIVATING=0
cleanup() {
  local result=$?
  if (( result != 0 && ACTIVATING == 1 )); then remove_route || true; fi
  # mktemp returns a dedicated directory; refuse unexpected paths before deletion.
  [[ "$DOCKER_CONFIG" == /tmp/tmp.* && -d "$DOCKER_CONFIG" ]] && rm -rf -- "$DOCKER_CONFIG"
  unset TOKEN
  return "$result"
}
trap cleanup EXIT
printf '%s' "$TOKEN" | docker login ghcr.io -u "$OWNER" --password-stdin >/dev/null
current() {
  local data
  data=$(curl --fail --silent --show-error --config <(printf 'header = "Authorization: Bearer %s"\n' "$TOKEN") "https://api.github.com/repos/$OWNER/$REPO/pulls/$PR")
  jq -e --arg sha "$SHA" --arg repo "$OWNER/$REPO" '.state == "open" and .base.ref == "master" and .head.sha == $sha and (.head.repo.full_name | ascii_downcase) == $repo and (.user.type == "User")' <<< "$data" >/dev/null
}
current || { echo 'PR closed or superseded' >&2; exit 1; }
if [[ ! -f "$STACK/release.env" ]]; then
  COUNT=$(find "$ROOT/stacks" -mindepth 2 -maxdepth 2 -name release.env | wc -l)
  (( COUNT < 3 )) || { echo 'Three preview slots are occupied' >&2; exit 1; }
  AVAILABLE=$(awk '/MemAvailable/ {print $2}' /proc/meminfo)
  DISK=$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')
  (( AVAILABLE >= 3145728 && DISK >= 15728640 )) || { echo 'Preview requires 3 GiB available RAM and 15 GiB free disk' >&2; exit 1; }
  mkdir -p "$STACK"
  PASSWORD=$(openssl rand -hex 24)
else
  PASSWORD=$(sed -n 's/^DB_PASSWORD=//p' "$STACK/release.env")
fi
[[ "$PASSWORD" =~ ^[a-f0-9]{48}$ ]] || exit 1
printf 'PR_NUMBER=%s\nCOMMIT_SHA=%s\nGHCR_OWNER=%s\nIMAGE_TAG=pr-%s-%s\nPREVIEW_HOST=%s\nDB_PASSWORD=%s\n' "$PR" "$SHA" "$OWNER" "$PR" "$SHA" "$HOST" "$PASSWORD" > "$STACK/release.env"
dc pull
current || exit 1
# Migrations may change schema: remove public routing before changing a live DB.
remove_route
ACTIVATING=1
dc stop app api || true
dc up -d --wait --wait-timeout 120 db
dc run --rm migrate
if [[ ! -f "$STACK/state.json" ]]; then dc run --rm seed; fi
dc up -d --wait --wait-timeout 180 api app
NETWORK="${PROJECT}_edge"
docker network connect "$NETWORK" oren-caddy-1 2>/dev/null || docker network inspect "$NETWORK" | jq -e '.[0].Containers | to_entries | any(.value.Name == "oren-caddy-1")' >/dev/null
current || { echo 'PR superseded before activation' >&2; exit 1; }
cat > "$STACK/route.candidate" <<EOF
$HOST {
  header X-Robots-Tag "noindex, nofollow"
  header Cache-Control "no-store"
  route {
    @gate path /_preview/*
    reverse_proxy @gate preview-access:8080 {
      header_up X-Preview-Host {host}
      header_up X-Preview-Client {remote_host}
    }
    forward_auth preview-access:8080 {
      uri /verify
      header_up X-Preview-Host {host}
      header_up X-Preview-Client {remote_host}
    }
    @api path /api /api/*
    reverse_proxy @api pr-$PR-api:3000 {
      flush_interval -1
    }
    reverse_proxy pr-$PR-app:3000
  }
}
EOF
cp "$STACK/route.candidate" "$SITE"
if ! reload; then rm -f -- "$SITE"; reload; exit 1; fi
# Public gate must be active, then use a cookie for the public metadata smoke.
STATUS=$(curl --silent --show-error --retry 8 --retry-delay 5 --retry-all-errors --output /dev/null --write-out '%{http_code}' "https://$HOST/api/environment")
[[ "$STATUS" == 302 ]] || { remove_route; echo 'Access gate smoke failed' >&2; exit 1; }
COOKIE=$(docker exec -e PREVIEW_HOST="$HOST" oren-preview-access-preview-access-1 node --input-type=module -e 'import {signSession} from "/service/access.mjs"; console.log(signSession(process.env.PREVIEW_HOST,process.env.PREVIEW_SESSION_KEY))')
METADATA=$(curl --fail --silent --show-error --cookie "__Host-oren-preview=$COOKIE" "https://$HOST/api/environment")
if ! jq -e --arg sha "$SHA" --argjson pr "$PR" '.environment == "preview" and .commitSha == $sha and .prNumber == $pr and .financialExecution == false and .backgroundWorkers == false' <<< "$METADATA" >/dev/null; then remove_route; echo 'Metadata smoke failed' >&2; exit 1; fi
curl --fail --silent --show-error --cookie "__Host-oren-preview=$COOKIE" "https://$HOST/" >/dev/null || { remove_route; exit 1; }
unset COOKIE
current || { remove_route; exit 1; }
jq -n --argjson pr "$PR" --arg sha "$SHA" --arg host "$HOST" --argjson deployed "$(date +%s)" '{pr:$pr,sha:$sha,host:$host,deployed:$deployed}' > "$STACK/state.json"
ACTIVATING=0
echo "Preview deployed: https://$HOST ($SHA)"
