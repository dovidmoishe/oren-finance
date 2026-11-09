#!/usr/bin/env bash
# Focused second-build-account install. Does not run provision.sh.
# oren-ci-build-2 gets its own user slice and rootless dockerd.
# It does not join docker or sudo, and this script does not change
# oren-ci-release group membership.
set -euo pipefail

SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=infra/ci/light-lane.sh
source "$SOURCE/light-lane.sh"

account=oren-ci-build-2

refuse() {
  local reason
  reason=$(safety_reason) || true
  if [[ -n $reason ]]; then
    echo "refusing before any installed-path change: $reason" >&2
    return 2
  fi
}

assert_unprivileged() {
  local name=$1
  [[ " $(id -nG "$name") " != *' docker '* && " $(id -nG "$name") " != *' sudo '* ]]
}

cmd_apply() {
  refuse
  [[ ${EUID:-} == 0 ]] || { echo 'apply must run as root' >&2; return 1; }
  local stamp backup manifest live id
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  backup=${HOST_ROOT:-}/root/oren-ci-heavy-pair-backup-$stamp
  manifest=$backup/manifest.txt
  install -d -m 700 "$backup"
  : > "$manifest"
  live=${HOST_ROOT:-}/opt/oren-ci/bin
  record_backup "$live/admission.py" "$backup" "$manifest"
  record_backup "$live/budgets.json" "$backup" "$manifest"
  record_backup "$live/job-started.sh" "$backup" "$manifest"
  record_backup "$live/job-completed.sh" "$backup" "$manifest"
  record_backup "$live/light-started.sh" "$backup" "$manifest"
  record_backup "$live/light-client.py" "$backup" "$manifest"
  install -d -m 755 "$live"
  install_atomic "$SOURCE/admission.py" "$live/admission.py" 644
  install_atomic "$SOURCE/budgets.json" "$live/budgets.json" 644
  install_atomic "$SOURCE/job-started.sh" "$live/job-started.sh" 755
  install_atomic "$SOURCE/job-completed.sh" "$live/job-completed.sh" 755
  install_atomic "$SOURCE/light-started.sh" "$live/light-started.sh" 755
  install_atomic "$SOURCE/light-client.py" "$live/light-client.py" 644
  chown root:root "$live/admission.py" "$live/budgets.json" "$live/job-started.sh" \
    "$live/job-completed.sh" "$live/light-started.sh" "$live/light-client.py"
  if ! id "$account" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash "$account"
  fi
  assert_unprivileged "$account"
  assert_unprivileged oren-ci-release
  getent group oren-ci-workers >/dev/null
  usermod -a -G oren-ci-workers "$account"
  # Release groups are left untouched. build-2 is not added to docker or sudo.
  assert_unprivileged "$account"
  id=$(id -u "$account")
  [[ "$id" != "$(id -u oren-ci-build)" ]]
  install -d -m 755 "${HOST_ROOT:-}/etc/systemd/system/user-$id.slice.d"
  cat > "${HOST_ROOT:-}/etc/systemd/system/user-$id.slice.d/oren-ci.conf" <<EOF
[Slice]
MemoryAccounting=yes
MemoryHigh=448M
MemoryMax=512M
MemorySwapMax=0
CPUAccounting=yes
CPUQuota=25%
CPUWeight=25
TasksMax=2048
EOF
  loginctl enable-linger "$account"
  systemctl restart "user@$id.service"
  # Own rootless daemon inside this UID's slice. Not the host docker group.
  systemctl set-property --runtime "user-$id.slice" MemoryMax=3840M MemoryHigh=3584M CPUQuota=100%
  runuser -u "$account" -- env XDG_RUNTIME_DIR="/run/user/$id" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$id/bus" \
    dockerd-rootless-setuptool.sh install --force
  runuser -u "$account" -- env XDG_RUNTIME_DIR="/run/user/$id" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$id/bus" \
    systemctl --user enable --now docker
  runuser -u "$account" -- env DOCKER_HOST="unix:///run/user/$id/docker.sock" \
    docker info --format '{{.DockerRootDir}} {{.CgroupDriver}}'
  systemctl set-property --runtime "user-$id.slice" MemoryMax=512M MemoryHigh=448M CPUQuota=25%
  install -d -m 750 -o "$account" -g "$account" "/home/$account/runner-build-2"
  echo "backup manifest $manifest"
  systemctl daemon-reload
  systemctl restart oren-ci-admission.service
  echo 'admission restarted; oren-ci-build-2 slice is idle and its runner was not registered'
}

cmd_stage() {
  local dest=${1:?stage directory}
  case $dest in
    /opt/oren-ci|/opt/oren-ci/*|/etc/systemd|/etc/systemd/*|/home|/home/*)
      echo 'stage directory is inside an installed path' >&2
      return 1
      ;;
  esac
  install -d -m 700 "$dest"
  install_atomic "$SOURCE/admission.py" "$dest/admission.py" 644
  install_atomic "$SOURCE/job-started.sh" "$dest/job-started.sh" 755
  install_atomic "$SOURCE/light-client.py" "$dest/light-client.py" 644
  echo "staged $dest"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case ${1:-check} in
    check) cmd_check ;;
    apply) cmd_apply ;;
    stage) cmd_stage "${2:-}" ;;
    rollback) cmd_rollback "${2:-}" ;;
    *) echo 'use check, apply, stage <dir>, or rollback <manifest>' >&2; exit 1 ;;
  esac
fi
