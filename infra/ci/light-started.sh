#!/usr/bin/env bash
# Light-lane start hook. No Docker and no heavy-job lease.
# The permit is taken inside admission, under the same lock as a heavy raise.
set -euo pipefail
[[ $(id -un) == oren-ci-light ]]
worker=$PPID
while (( worker > 1 )) && [[ $(cat "/proc/$worker/comm") != Runner.Worker ]]; do
  worker=$(awk '/^PPid:/ {print $2}' "/proc/$worker/status")
done
(( worker > 1 ))
echo "CI light preflight: requesting the admission light permit for worker $worker."
/usr/bin/python3 "${BASH_SOURCE[0]%/*}/light-client.py" "$worker"
echo 'CI light preflight: admission granted the light permit; heavy admission was not requested.'
