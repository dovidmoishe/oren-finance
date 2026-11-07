#!/usr/bin/env bash
set -euo pipefail
account=$(id -un)
[[ "$account" == oren-ci-build || "$account" == oren-ci-release ]]
if [[ "$account" == oren-ci-release ]]; then
  /opt/oren-ci/toolchain/node-v22.23.4-linux-x64/bin/node /opt/oren-ci/bin/trusted-job.mjs release
fi
export DOCKER_HOST="unix:///run/user/$(id -u)/docker.sock"
[[ $(docker info --format '{{.DockerRootDir}}') == /home/"$account"/* ]]
[[ $(docker info --format '{{.CgroupDriver}}') == systemd ]]
# Root admission binds the budget to the verified worker's lifetime.
worker=$PPID
while (( worker > 1 )) && [[ $(cat "/proc/$worker/comm") != Runner.Worker ]]; do
  worker=$(awk '/^PPid:/ {print $2}' "/proc/$worker/status")
done
(( worker > 1 ))
/usr/bin/python3 /opt/oren-ci/bin/lease-client.py "$worker"
for attempt in {1..180}; do
  available=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
  disk=$(df -Pk /home/oren-ci-build | awk 'NR==2 {print $4}')
  if (( available >= 4718592 && disk >= 15728640 )); then exit 0; fi
  if (( attempt % 12 == 1 )); then echo 'CI is waiting for serving-memory/disk headroom; previews remain running.'; fi
  sleep 5
done
echo 'Insufficient CI headroom; retry after active serving load falls.' >&2
exit 1
