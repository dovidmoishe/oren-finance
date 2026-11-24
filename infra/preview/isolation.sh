#!/usr/bin/env bash
# Disposable Linux CI-only DB isolation test; never run against the VPS projects.
psql_try() {
  local which=$1
  shift
  local deadline=$(( SECONDS + ${ISOLATION_READY_SECONDS:-30} ))
  local output status
  while true; do
    output=$("$which" exec -T db psql -U oren_preview -d oren_preview -v ON_ERROR_STOP=1 "$@" 2>&1) && status=0 || status=$?
    if (( status == 0 )); then
      printf '%s' "$output"
      return 0
    fi
    case $output in
      *'the database system is shutting down'*|*'the database system is starting up'*|*'Connection refused'*|*'could not connect to server'*|*'not yet accepting connections'*)
        if (( SECONDS >= deadline )); then
          printf '%s\n' "$output" >&2
          echo 'preview database did not accept the query before the deadline' >&2
          return 1
        fi
        sleep 0.5
        ;;
      *)
        printf '%s\n' "$output" >&2
        return "$status"
    esac
  done
}

main() {
  set -euo pipefail
  [[ "${CI:-}" == true ]] || { echo 'This test requires CI=true' >&2; exit 1; }
  export PR_NUMBER=42 COMMIT_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  export GHCR_OWNER=example IMAGE_TAG=ci PREVIEW_HOST=pr-42.preview.example.com
  export DB_PASSWORD=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  COMPOSE=infra/preview/compose.yml
  ID="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-${GITHUB_JOB:-isolation}"
  [[ "$ID" =~ ^[a-zA-Z0-9_-]+$ ]]
  a() { docker compose -p "oren-ci-preview-${ID,,}-a" -f "$COMPOSE" "$@"; }
  b() { docker compose -p "oren-ci-preview-${ID,,}-b" -f "$COMPOSE" "$@"; }
  cleanup() { a down -v --remove-orphans; b down -v --remove-orphans; }
  trap cleanup EXIT
  a up -d --wait --wait-timeout 120 db
  b up -d --wait --wait-timeout 120 db
  psql_try a -c "CREATE TABLE preview_isolation (value text); INSERT INTO preview_isolation VALUES ('only-a');"
  [[ "$(psql_try b -Atc "SELECT to_regclass('public.preview_isolation') IS NULL")" == t ]]
  a restart db
  a up -d --wait --wait-timeout 120 db
  [[ "$(psql_try a -Atc 'SELECT value FROM preview_isolation')" == only-a ]]
  echo 'Separate databases and persistence across updates verified.'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
