#!/usr/bin/env bash
set -euo pipefail
[[ $(id -un) == oren-ci-control ]]
exec /opt/oren-ci/toolchain/node-v22.23.4-linux-x64/bin/node /opt/oren-ci/bin/trusted-job.mjs control
