#!/usr/bin/env bash
set -euo pipefail
# GitHub token arrives on stdin. Workflow handles deployment status updates.
read -r TOKEN
ROOT=/opt/oren/preview
REPO="${1:?owner/repo}"
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || exit 1
for file in "$ROOT"/stacks/pr-*/release.env; do
  [[ -f "$file" ]] || continue
  PR=$(basename "$(dirname "$file")"); PR=${PR#pr-}
  # Recheck state and expiry under the same host lock used by deployments.
  printf '%s\n' "$TOKEN" | bash "$ROOT/control/manage.sh" reconcile "$PR" "${REPO%/*}" "${REPO#*/}"
done
