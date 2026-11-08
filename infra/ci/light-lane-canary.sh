#!/usr/bin/env bash
# Full-account canary for the light slice. Run on the host after
# oren-ci-light exists and before treating chunk peaks as proof.
# It samples user-<uid>.slice/memory.current, not a child process RSS.
# A 447 MiB child measurement is not an input and is not a success.
set -euo pipefail
[[ $(id -un) == oren-ci-light || $EUID == 0 ]]
SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
account=oren-ci-light
uid=$(id -u "$account")
slice=${CGROUP_ROOT:-/sys/fs/cgroup}/user.slice/user-$uid.slice/memory.current
[[ -r $slice ]]
max_bytes=$(( $(python3 - "$SOURCE/budgets.json" <<'PY'
import json, sys
print(json.load(open(sys.argv[1]))['lightMaxMiB'] * 1024 * 1024)
PY
) ))
app=${APP_DIR:-/home/oren-ci-light/runner-light/_work}
if [[ ! -f $app/app/scripts/lint-bounded.mjs && -n ${CANARY_APP:-} ]]; then
  app=$CANARY_APP
fi
[[ -f $app/app/scripts/lint-bounded.mjs || -f $app/scripts/lint-bounded.mjs ]]
if [[ -f $app/scripts/lint-bounded.mjs ]]; then
  work=$app
else
  work=$app/app
fi
peak=0
sample() {
  local current
  current=$(cat "$slice")
  if (( current > peak )); then peak=$current; fi
}
sample
(
  cd "$work"
  node scripts/lint-bounded.mjs
) &
lint=$!
while kill -0 "$lint" 2>/dev/null; do
  sample
  sleep 0.2
done
wait "$lint"
lint_status=$?
sample
echo "light-slice-peak-bytes=$peak"
echo "light-max-bytes=$max_bytes"
echo "lint-status=$lint_status"
if (( lint_status != 0 )); then
  echo 'canary lint failed; coverage or eslint errors are not a memory pass' >&2
  exit "$lint_status"
fi
if (( peak > max_bytes )); then
  echo 'canary failed: full user-slice peak exceeds the light cap' >&2
  exit 1
fi
echo 'canary passed: full user-slice peak fits the light cap'
