#!/usr/bin/env bash
set -euo pipefail
worker=$1 ready=$2 lock=$3
[[ "$worker" =~ ^[1-9][0-9]*$ && -r /proc/$worker/stat ]]
started=$(awk '{print $22}' "/proc/$worker/stat")
exec 9>"$lock"
flock --wait 1200 9
[[ -r /proc/$worker/stat && $(awk '{print $22}' "/proc/$worker/stat") == "$started" ]]
touch "$ready"
while [[ -r /proc/$worker/stat && $(awk '{print $22}' "/proc/$worker/stat") == "$started" ]]; do sleep 1; done
