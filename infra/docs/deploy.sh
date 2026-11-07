#!/usr/bin/env bash
set -Eeuo pipefail

OWNER=${1:?registry owner required}
SHA=${2:?release SHA required}
ACTOR=${3:?registry username required}
EXPECTED_DIGEST=${4:-}
[[ "$OWNER" =~ ^[a-z0-9-]+$ && "$SHA" =~ ^[a-f0-9]{40}$ ]]
[[ "$ACTOR" =~ ^[A-Za-z0-9_-]+(\[bot\])?$ ]]
[[ -z "$EXPECTED_DIGEST" || "$EXPECTED_DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]

ROOT=${OREN_DOCS_ROOT:-/opt/oren/docs}
CADDY_FILE=${OREN_DOCS_CADDY_FILE:-/opt/oren/Caddyfile}
INCOMING=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO="ghcr.io/$OWNER/oren-docs"
mkdir -p "$ROOT"
exec 9>"$ROOT/.deploy.lock"
flock -n 9 || { echo 'Another docs release is active' >&2; exit 1; }
docker network inspect oren_oren >/dev/null
docker inspect oren-caddy-1 >/dev/null
test -f "$CADDY_FILE"
test -f "$INCOMING/compose.yml"
test -f "$INCOMING/docs.caddy"
test -f "$INCOMING/smoke.mjs"
if [[ ! -f "$ROOT/release.env" ]] && docker inspect oren-docs >/dev/null 2>&1; then
  echo 'Refusing to replace an unmanaged docs container without a release record' >&2
  exit 1
fi

STATE=$(mktemp -d "$ROOT/.deploy.XXXXXX")
AUTH="$STATE/auth"
(umask 077; mkdir "$AUTH")
cp "$CADDY_FILE" "$STATE/Caddyfile"
if [[ -f "$ROOT/release.env" ]]; then
  cp "$ROOT/release.env" "$STATE/release.env"
  cp "$ROOT/compose.yml" "$STATE/compose.yml"
fi
ACTIVATED=0
CADDY_CHANGED=0
dc() { docker compose --env-file "$ROOT/release.env" -f "$ROOT/compose.yml" "$@"; }
cleanup() {
  local status=$? rollback_failed=0
  trap - EXIT INT TERM HUP
  if (( status != 0 )); then
    if (( ACTIVATED )); then
      echo 'Docs release failed; restoring the previous release' >&2
      if [[ -f "$STATE/release.env" ]]; then
        cp "$STATE/compose.yml" "$ROOT/compose.yml" || rollback_failed=1
        cp "$STATE/release.env" "$ROOT/release.env" || rollback_failed=1
        dc up -d --wait --wait-timeout 180 docs || rollback_failed=1
      else
        dc stop docs || rollback_failed=1
        dc rm -f docs || rollback_failed=1
        rm -f "$ROOT/release.env"
      fi
    fi
    if (( CADDY_CHANGED )); then
      # Preserve the inode: production Caddy bind-mounts this individual file.
      cat "$STATE/Caddyfile" > "$CADDY_FILE" || rollback_failed=1
      docker exec oren-caddy-1 caddy validate --config /etc/caddy/Caddyfile &&
        docker exec oren-caddy-1 caddy reload --config /etc/caddy/Caddyfile || rollback_failed=1
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
printf 'DOCS_IMAGE=%s@%s\nDOCS_RELEASE_SHA=%s\n' "$REPO" "$digest" "$SHA" > "$ROOT/release.env"
dc config --quiet
dc up -d --wait --wait-timeout 180 docs
# Add only the missing docs host. Never overwrite newer API/web routing with a
# Caddyfile captured when an older docs workflow began building.
if ! grep -Eq '^[[:space:]]*docs\.oren\.finance[[:space:]]*\{' "$CADDY_FILE"; then
  CADDY_CHANGED=1
  printf '\n' >> "$CADDY_FILE"
  cat "$INCOMING/docs.caddy" >> "$CADDY_FILE"
fi
docker exec oren-caddy-1 caddy validate --config /etc/caddy/Caddyfile
docker exec oren-caddy-1 caddy reload --config /etc/caddy/Caddyfile
docker exec -i oren-docs node --input-type=module - 'https://docs.oren.finance' "$SHA" < "$INCOMING/smoke.mjs"

if [[ -f "$STATE/release.env" ]]; then cp "$STATE/release.env" "$ROOT/previous-release.env"; fi
printf 'Deployed docs %s (%s)\n' "$SHA" "$digest"
