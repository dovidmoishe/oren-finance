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
# Both distinct UIDs share one bounded slice and one execution slot. A detached
# lease holds the flock until Runner.Worker exits, including cancellation.
worker=$PPID
while (( worker > 1 )) && [[ $(cat "/proc/$worker/comm") != Runner.Worker ]]; do
  worker=$(awk '/^PPid:/ {print $2}' "/proc/$worker/status")
done
(( worker > 1 ))
ready="$RUNNER_TEMP/ci-slot-$worker-ready"
rm -f -- "$ready"
nohup /opt/oren-ci/bin/hold-build-slot.sh "$worker" "$ready" /run/oren-ci-build/slot.lock > "$RUNNER_TEMP/ci-slot-$worker.log" 2>&1 < /dev/null &
lease=$!
for attempt in {1..1200}; do
  [[ ! -f "$ready" ]] || break
  kill -0 "$lease" 2>/dev/null || { echo 'Build-slot lease failed' >&2; exit 1; }
  sleep 1
done
[[ -f "$ready" ]]
for attempt in {1..180}; do
  available=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
  disk=$(df -Pk /home/oren-ci-build | awk 'NR==2 {print $4}')
  if (( available >= 4718592 && disk >= 15728640 )); then exit 0; fi
  if (( attempt % 12 == 1 )); then echo 'CI is waiting for serving-memory/disk headroom; previews remain running.'; fi
  sleep 5
done
echo 'Insufficient CI headroom; retry after active serving load falls.' >&2
exit 1
