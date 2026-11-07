#!/usr/bin/env bash
set -euo pipefail
node --test infra/ci/*.test.mjs infra/preview/*.test.mjs infra/docs/*.test.mjs
for script in infra/ci/*.sh infra/preview/*.sh; do bash -n "$script"; done
