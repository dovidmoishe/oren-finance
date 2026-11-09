#!/usr/bin/env bash
# Register only oren-vps-light. Does not restart admission or the heavy runners.
# A short-lived registration token is read from stdin and is not stored.
set -euo pipefail
[[ $EUID == 0 ]]
account=oren-ci-light
[[ " $(id -nG "$account") " != *' docker '* && " $(id -nG "$account") " != *' sudo '* ]]
[[ " $(id -nG "$account") " != *' oren-ci-workers '* ]]
id=$(id -u "$account")
[[ -f /etc/systemd/system/user-$id.slice.d/oren-ci.conf ]]
unit=/home/$account/.config/systemd/user/oren-runner-light.service
[[ -f $unit ]]
grep -q '^UMask=0022$' "$unit"
grep -q '^Environment=ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/oren-ci/bin/light-started.sh$' "$unit"
grep -q '^Environment=ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/opt/oren-ci/bin/light-completed.sh$' "$unit"
read -r TOKEN
TOKEN=${TOKEN//$'\r'/}
[[ -n $TOKEN ]]
export ACTIONS_RUNNER_INPUT_TOKEN=$TOKEN
unset TOKEN
directory=/home/$account/runner-light
tarball=/opt/oren-ci/downloads/actions-runner-linux-x64-2.338.2.tar.gz
if [[ ! -x $directory/config.sh ]]; then
  [[ -f $tarball ]]
  printf 'baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40  %s\n' "$tarball" | sha256sum -c -
  install -d -m 750 -o "$account" -g "$account" "$directory"
  tar -xzf "$tarball" -C "$directory"
  chown -R "$account:$account" "$directory"
fi
if [[ ! -f $directory/.runner ]]; then
  (cd "$directory" && runuser -u "$account" -- ./config.sh --unattended --disableupdate \
    --url https://github.com/dovidmoishe/oren-finance --name oren-vps-light --labels oren-light --work _work)
fi
chown -R root:"$account" "$directory"
chmod -R g+rX,o-rwx "$directory"
chown -R "$account:$account" "$directory/_work" "$directory/_diag"
runuser -u "$account" -- env XDG_RUNTIME_DIR="/run/user/$id" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$id/bus" \
  systemctl --user daemon-reload
runuser -u "$account" -- env XDG_RUNTIME_DIR="/run/user/$id" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$id/bus" \
  systemctl --user enable --now oren-runner-light.service
unset ACTIONS_RUNNER_INPUT_TOKEN
echo 'oren-vps-light enabled; admission was not restarted'
