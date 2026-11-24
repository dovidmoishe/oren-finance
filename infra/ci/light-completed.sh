#!/usr/bin/env bash
# Remove only this account's workspace. There is no daemon to clean.
set -euo pipefail
[[ $(id -un) == oren-ci-light ]]
if [[ -n ${RUNNER_WORKSPACE:-} ]]; then
  resolved=$(realpath -m "$RUNNER_WORKSPACE")
  [[ "$resolved" == /home/oren-ci-light/*/_work/* ]]
  rm -rf --one-file-system -- "$resolved"
fi
