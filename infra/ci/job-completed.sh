#!/usr/bin/env bash
set -euo pipefail
account=$(id -un)
[[ "$account" == oren-ci-build || "$account" == oren-ci-release ]]
export DOCKER_HOST="unix:///run/user/$(id -u)/docker.sock"
[[ $(docker info --format '{{.DockerRootDir}}') == /home/"$account"/* ]]
# This daemon is dedicated to one job at a time. Leave its image/layer cache;
# remove job containers, their attached anonymous volumes and registry logins.
mapfile -t containers < <(docker ps -aq)
if (( ${#containers[@]} )); then docker rm -fv "${containers[@]}" >/dev/null; fi
docker logout ghcr.io >/dev/null 2>&1 || true
if [[ -n ${RUNNER_WORKSPACE:-} ]]; then
  resolved=$(realpath -m "$RUNNER_WORKSPACE")
  [[ "$resolved" == /home/"$account"/*/_work/* ]]
  rm -rf --one-file-system -- "$resolved"
fi
