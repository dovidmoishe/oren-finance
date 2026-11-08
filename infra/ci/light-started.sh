#!/usr/bin/env bash
# Light-lane start hook. No Docker and no heavy-job lease.
# Lint starts only when free memory still covers this cap, the heavy slice's
# remaining room up to 3840 MiB, and the 1,792 MiB production reserve.
set -euo pipefail
[[ $(id -un) == oren-ci-light ]]
budget=$(python3 - "${BASH_SOURCE[0]%/*}/budgets.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
print(data['lightStartMinAvailableMiB'] * 1024)
PY
)
echo "CI light preflight: waiting for at least ${budget} KiB MemAvailable."
for attempt in {1..180}; do
  available=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
  if (( available >= budget )); then
    echo "CI light preflight: host headroom ${available} KiB; heavy admission was not requested."
    exit 0
  fi
  if (( attempt % 12 == 1 )); then
    echo "CI light preflight: MemAvailable ${available} KiB is below ${budget} KiB; not starting work."
  fi
  sleep 5
done
echo 'CI light preflight failed closed: host headroom stayed below the production reserve.' >&2
exit 1
