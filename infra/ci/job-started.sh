#!/usr/bin/env bash
set -euo pipefail
[[ $(id -un) == oren-ci-build ]]
export DOCKER_HOST="unix:///run/user/$(id -u)/docker.sock"
[[ $(docker info --format '{{.DockerRootDir}}') == /home/oren-ci-build/* ]]
[[ $(docker info --format '{{.CgroupDriver}}') == systemd ]]
for attempt in {1..180}; do
  available=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
  disk=$(df -Pk /home/oren-ci-build | awk 'NR==2 {print $4}')
  if (( available >= 4718592 && disk >= 15728640 )); then exit 0; fi
  if (( attempt % 12 == 1 )); then echo 'CI is waiting for serving-memory/disk headroom; previews remain running.'; fi
  sleep 5
done
echo 'Insufficient CI headroom; retry after active serving load falls.' >&2
exit 1
