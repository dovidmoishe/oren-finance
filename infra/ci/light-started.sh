#!/usr/bin/env bash
# Light-lane start hook. No Docker and no heavy-job lease.
set -euo pipefail
[[ $(id -un) == oren-ci-light ]]
echo 'CI light preflight: static slice only; heavy admission was not requested.'
