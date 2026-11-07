#!/usr/bin/env bash
set -euo pipefail
[[ $(id -un) == oren-ci-build ]]
export DOCKER_HOST="unix:///run/user/$(id -u)/docker.sock"
[[ $(docker info --format '{{.DockerRootDir}}') == /home/oren-ci-build/* ]]
# This daemon is dedicated to one job at a time. Leave its image/layer cache;
# remove job containers, their attached anonymous volumes and registry logins.
mapfile -t containers < <(docker ps -aq)
if (( ${#containers[@]} )); then docker rm -fv "${containers[@]}" >/dev/null; fi
docker logout ghcr.io >/dev/null 2>&1 || true
if [[ -n ${RUNNER_WORKSPACE:-} ]]; then
  resolved=$(realpath -m "$RUNNER_WORKSPACE")
  [[ "$resolved" == /home/oren-ci-build/*/_work/* ]]
  rm -rf --one-file-system -- "$resolved"
fi
