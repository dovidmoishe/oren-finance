#!/usr/bin/env bash
# Pass a short-lived repo registration token on stdin, never in logs/arguments.
set -euo pipefail
[[ $EUID == 0 ]]
read -r TOKEN
TOKEN=${TOKEN//$'\r'/}
[[ -n "$TOKEN" ]]
export ACTIONS_RUNNER_INPUT_TOKEN="$TOKEN"
unset TOKEN
for spec in oren-ci-build:build oren-ci-control:control-1 oren-ci-control:control-2; do
  account=${spec%:*}; lane=${spec#*:}; directory="/home/$account/runner-$lane"; id=$(id -u "$account")
  label=oren-control
  [[ "$lane" != build ]] || label=oren-build
  if [[ ! -f "$directory/.runner" ]]; then
    (cd "$directory"; runuser -u "$account" -- ./config.sh --unattended --disableupdate \
      --url https://github.com/dovidmoishe/oren-finance --name "oren-vps-$lane" --labels "$label" --work _work)
  fi
  # Keep runner executable/configuration files outside job write authority.
  chown -R root:"$account" "$directory"
  chmod -R g+rX,o-rwx "$directory"
  chown -R "$account:$account" "$directory/_work" "$directory/_diag"
  runuser -u "$account" -- env XDG_RUNTIME_DIR="/run/user/$id" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$id/bus" systemctl --user daemon-reload
  runuser -u "$account" -- env XDG_RUNTIME_DIR="/run/user/$id" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$id/bus" systemctl --user enable --now "oren-runner-$lane.service"
done
unset ACTIONS_RUNNER_INPUT_TOKEN
