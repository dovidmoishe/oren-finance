#!/usr/bin/env bash
set -euo pipefail
account=$(id -un)
[[ "$account" == oren-ci-build || "$account" == oren-ci-release ]]
export DOCKER_HOST="unix:///run/user/$(id -u)/docker.sock"
# Bound completion too: a failed preflight must not strand a worker lease.
trap 'rc=$?; if (( rc != 0 )); then echo "CI completion failed closed (status=$rc); worker exit releases its admission lease; cleanup may be incomplete." >&2; fi' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker_info=$(/usr/bin/timeout --signal=TERM --kill-after=5s 30s docker info --format '{{.DockerRootDir}}|{{.CgroupDriver}}')
IFS='|' read -r docker_root docker_driver <<< "$docker_info"
[[ "$docker_root" == /home/"$account"/* ]]
[[ "$docker_driver" == systemd ]]
# This daemon is dedicated to one job at a time. Leave its image/layer cache;
# remove job containers, their attached anonymous volumes and registry logins.
container_ids=$(/usr/bin/timeout --signal=TERM --kill-after=5s 30s docker ps -aq)
containers=()
if [[ -n "$container_ids" ]]; then mapfile -t containers <<< "$container_ids"; fi
if (( ${#containers[@]} )); then /usr/bin/timeout --signal=TERM --kill-after=5s 60s docker rm -fv "${containers[@]}" >/dev/null; fi
/usr/bin/timeout --signal=TERM --kill-after=5s 15s docker logout ghcr.io >/dev/null 2>&1 || true
if [[ -n ${RUNNER_WORKSPACE:-} ]]; then
  resolved=$(realpath -m "$RUNNER_WORKSPACE")
  [[ "$resolved" == /home/"$account"/*/_work/* ]]
  rm -rf --one-file-system -- "$resolved"
fi
