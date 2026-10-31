#!/usr/bin/env bash
# Disposable Linux CI-only DB isolation test; never run against the VPS projects.
set -euo pipefail
[[ "${CI:-}" == true ]] || { echo 'This test requires CI=true' >&2; exit 1; }
export PR_NUMBER=42 COMMIT_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export GHCR_OWNER=example IMAGE_TAG=ci PREVIEW_HOST=pr-42.preview.example.com
export DB_PASSWORD=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
COMPOSE=infra/preview/compose.yml
a() { docker compose -p oren-ci-preview-a -f "$COMPOSE" "$@"; }
b() { docker compose -p oren-ci-preview-b -f "$COMPOSE" "$@"; }
cleanup() { a down -v --remove-orphans; b down -v --remove-orphans; }
trap cleanup EXIT
a up -d --wait --wait-timeout 120 db
b up -d --wait --wait-timeout 120 db
a exec -T db psql -U oren_preview -d oren_preview -v ON_ERROR_STOP=1 -c "CREATE TABLE preview_isolation (value text); INSERT INTO preview_isolation VALUES ('only-a');"
[[ "$(b exec -T db psql -U oren_preview -d oren_preview -Atc "SELECT to_regclass('public.preview_isolation') IS NULL")" == t ]]
a restart db
a up -d --wait --wait-timeout 120 db
[[ "$(a exec -T db psql -U oren_preview -d oren_preview -Atc 'SELECT value FROM preview_isolation')" == only-a ]]
echo 'Separate databases and persistence across updates verified.'
