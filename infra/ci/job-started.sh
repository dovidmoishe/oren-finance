#!/usr/bin/env bash
set -euo pipefail
account=$(id -un)
[[ "$account" == oren-ci-build || "$account" == oren-ci-build-2 || "$account" == oren-ci-release ]]
if [[ "$account" == oren-ci-release ]]; then
  /opt/oren-ci/toolchain/node-v22.23.4-linux-x64/bin/node /opt/oren-ci/bin/trusted-job.mjs release
fi
export DOCKER_HOST="unix:///run/user/$(id -u)/docker.sock"
# Root admission binds the budget to the verified worker's lifetime.
worker=$PPID
while (( worker > 1 )) && [[ $(cat "/proc/$worker/comm") != Runner.Worker ]]; do
  worker=$(awk '/^PPid:/ {print $2}' "/proc/$worker/status")
done
(( worker > 1 ))
phase=admission
lease_acquired=0
trap 'rc=$?; if (( rc != 0 )); then echo "CI preflight failed: phase=$phase status=$rc; workflow work is blocked." >&2; if (( lease_acquired )); then echo "CI budget remains bound to worker $worker and is released by admission when that worker exits." >&2; fi; fi' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
echo "CI preflight: requesting serialized worker-lifetime resource lease."
/usr/bin/python3 /opt/oren-ci/bin/lease-client.py "$worker"
lease_acquired=1
phase=docker-validation
echo "CI preflight: admission granted; validating dedicated rootless Docker (30s deadline, 5s kill grace)."
docker_info=$(/usr/bin/timeout --signal=TERM --kill-after=5s 30s docker info --format '{{.DockerRootDir}}|{{.CgroupDriver}}')
IFS='|' read -r docker_root docker_driver <<< "$docker_info"
[[ "$docker_root" == /home/"$account"/* ]]
[[ "$docker_driver" == systemd ]]
echo "CI preflight: dedicated rootless Docker identity and systemd cgroup driver verified."
phase=serving-headroom
for attempt in {1..180}; do
  available=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
  disk=$(df -Pk /home/oren-ci-build | awk 'NR==2 {print $4}')
  if (( available >= 4718592 && disk >= 15728640 )); then echo "CI preflight: serving headroom verified; workflow steps may start."; exit 0; fi
  if (( attempt % 12 == 1 )); then echo 'CI is waiting for serving-memory/disk headroom; previews remain running.'; fi
  sleep 5
done
echo 'Insufficient CI headroom; retry after active serving load falls.' >&2
exit 1
