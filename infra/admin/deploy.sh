#!/usr/bin/env bash
set -Eeuo pipefail

# Activates one published admin dashboard image on the production VPS.
# Usage: deploy.sh <registry owner> <release SHA> <registry user> [expected digest]
# The registry token arrives on stdin.

OWNER=${1:?registry owner required}
SHA=${2:?release SHA required}
ACTOR=${3:?registry username required}
EXPECTED_DIGEST=${4:-}
[[ "$OWNER" =~ ^[a-z0-9-]+$ && "$SHA" =~ ^[a-f0-9]{40}$ ]]
[[ "$ACTOR" =~ ^[A-Za-z0-9_-]+(\[bot\])?$ ]]
[[ -z "$EXPECTED_DIGEST" || "$EXPECTED_DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]

ROOT=${OREN_ADMIN_ROOT:-/opt/oren/admin-release}
SITES=${OREN_ADMIN_SITES:-/opt/oren/preview/sites}
HOST=${OREN_ADMIN_HOST:-admin.oren.finance}
ROUTE="$SITES/production-admin.caddy"
PROJECT=oren-admin-release
CONTAINER=oren-admin-web
INCOMING=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO="ghcr.io/$OWNER/oren-admin"
mkdir -p "$ROOT"
exec 9>"$ROOT/.deploy.lock"
flock -n 9 || { echo 'Another admin release is active' >&2; exit 1; }
docker network inspect oren_oren >/dev/null
docker inspect oren-caddy-1 >/dev/null
test -d "$SITES"
test -f "$INCOMING/compose.yml"
test -f "$INCOMING/admin.caddy"
# Never take over a container this release did not create.
if owner=$(docker container inspect --format '{{index .Config.Labels "com.docker.compose.project"}}/{{index .Config.Labels "com.docker.compose.service"}}' "$CONTAINER" 2>/dev/null) &&
  [[ "$owner" != "$PROJECT/admin" ]]; then
  echo "Refusing to replace $CONTAINER, which this release does not manage ($owner)" >&2
  exit 1
fi

# The container behind today's route. A hand-run dashboard is stopped only after
# this release is serving through Caddy, and it is never removed.
RETIRE=''
if [[ -f "$ROUTE" ]]; then
  upstream=$(grep -Eo 'reverse_proxy[[:space:]]+[^[:space:]{]+' "$ROUTE" | head -n 1 | awk '{print $2}' || true)
  upstream=${upstream#*://}
  upstream=${upstream%%:*}
  if [[ "$upstream" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ && "$upstream" != "$CONTAINER" ]] &&
    docker container inspect "$upstream" >/dev/null 2>&1; then
    RETIRE=$upstream
  fi
fi

STATE=$(mktemp -d "$ROOT/.deploy.XXXXXX")
AUTH="$STATE/auth"
(umask 077; mkdir "$AUTH")
if [[ -f "$ROUTE" ]]; then cp "$ROUTE" "$STATE/route.caddy"; fi
if [[ -f "$ROOT/release.env" ]]; then
  cp "$ROOT/release.env" "$STATE/release.env"
  cp "$ROOT/compose.yml" "$STATE/compose.yml"
fi
ACTIVATED=0
ROUTE_CHANGED=0
dc() { docker compose --env-file "$ROOT/release.env" -f "$ROOT/compose.yml" "$@"; }
reload_caddy() {
  docker exec oren-caddy-1 caddy validate --config /etc/caddy/Caddyfile &&
    docker exec oren-caddy-1 caddy reload --config /etc/caddy/Caddyfile
}
cleanup() {
  local status=$? rollback_failed=0
  trap - EXIT INT TERM HUP
  if (( status != 0 )); then
    # Route first, so traffic returns to whatever served before this release.
    if (( ROUTE_CHANGED )); then
      echo 'Admin release failed; restoring the previous route' >&2
      if [[ -f "$STATE/route.caddy" ]]; then
        cp "$STATE/route.caddy" "$ROUTE" || rollback_failed=1
      else
        rm -f "$ROUTE" || rollback_failed=1
      fi
      reload_caddy || rollback_failed=1
    fi
    if (( ACTIVATED )); then
      echo 'Admin release failed; restoring the previous release' >&2
      if [[ -f "$STATE/release.env" ]]; then
        cp "$STATE/compose.yml" "$ROOT/compose.yml" || rollback_failed=1
        cp "$STATE/release.env" "$ROOT/release.env" || rollback_failed=1
        dc up -d --wait --wait-timeout 180 admin || rollback_failed=1
      else
        dc stop admin || rollback_failed=1
        dc rm -f admin || rollback_failed=1
        rm -f "$ROOT/release.env"
      fi
    fi
  fi
  # Never retain registry credentials, including when rollback needs intervention.
  rm -rf -- "$AUTH"
  if (( rollback_failed )); then
    echo "Rollback needs attention; recovery files retained in $STATE" >&2
  else
    rm -rf -- "$STATE"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

# The short-lived GitHub token arrives only on stdin, never in arguments or files.
docker --config "$AUTH" login ghcr.io --username "$ACTOR" --password-stdin
docker --config "$AUTH" pull "$REPO:$SHA"
revision=$(docker image inspect "$REPO:$SHA" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
[[ "$revision" == "$SHA" ]] || { echo 'Image revision does not match the requested release' >&2; exit 1; }
digest=''
while IFS= read -r ref; do
  if [[ "$ref" == "$REPO@"* && "${ref#"$REPO@"}" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    digest=${ref#"$REPO@"}
    break
  fi
done < <(docker image inspect "$REPO:$SHA" --format '{{range .RepoDigests}}{{println .}}{{end}}')
[[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]
[[ -z "$EXPECTED_DIGEST" || "$digest" == "$EXPECTED_DIGEST" ]] || { echo 'Published image digest mismatch' >&2; exit 1; }

ACTIVATED=1
cp "$INCOMING/compose.yml" "$ROOT/compose.yml"
printf 'ADMIN_IMAGE=%s@%s\nADMIN_RELEASE_SHA=%s\n' "$REPO" "$digest" "$SHA" > "$ROOT/release.env"
dc config --quiet
dc up -d --wait --wait-timeout 180 admin
# Serve the page and reach the API through the dashboard's proxy before any traffic moves.
docker exec "$CONTAINER" wget -q -O /dev/null http://127.0.0.1:8080/
docker exec "$CONTAINER" sh -c 'wget -S -q -O /dev/null --header "X-Oren-Admin: 1" http://127.0.0.1:8080/api/admin/auth/session 2>&1 | grep -q " 401 "' ||
  { echo 'The dashboard cannot reach the API' >&2; exit 1; }
index=$(docker exec "$CONTAINER" sha256sum /srv/index.html | awk '{print $1}')
[[ "$index" =~ ^[a-f0-9]{64}$ ]]

if ! cmp -s "$INCOMING/admin.caddy" "$ROUTE"; then
  ROUTE_CHANGED=1
  cp "$INCOMING/admin.caddy" "$ROUTE.next"
  mv -f "$ROUTE.next" "$ROUTE"
  reload_caddy
fi
# The public edge, through this host's Caddy and certificate, must serve this release.
edge=$(curl --fail --silent --show-error --retry 5 --retry-delay 2 --retry-all-errors \
  --resolve "$HOST:443:127.0.0.1" "https://$HOST/" | sha256sum | awk '{print $1}')
[[ "$edge" == "$index" ]] || { echo "https://$HOST/ is not serving this release" >&2; exit 1; }

# Keep what this release replaced, so the hand-run setup can always be restored by hand.
if (( ROUTE_CHANGED )) && [[ -f "$STATE/route.caddy" ]]; then cp "$STATE/route.caddy" "$ROOT/replaced-route.caddy"; fi
if [[ -n "$RETIRE" ]]; then
  # Stopped, not removed: `docker start` restores it if this release is reverted by hand.
  if docker update --restart=no "$RETIRE" >/dev/null && docker stop "$RETIRE" >/dev/null; then
    printf '%s\n' "$RETIRE" > "$ROOT/retired-container"
    printf 'Stopped the previous dashboard container %s\n' "$RETIRE"
  else
    echo "Could not stop $RETIRE. It no longer receives traffic." >&2
  fi
fi
if [[ -f "$STATE/release.env" ]]; then cp "$STATE/release.env" "$ROOT/previous-release.env"; fi
printf 'ADMIN_INDEX_SHA256=%s\n' "$index"
printf 'Deployed admin %s (%s)\n' "$SHA" "$digest"
