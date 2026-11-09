#!/usr/bin/env bash
# Focused two-heavy plus light install. Does not run provision.sh.
# oren-ci-build-2 gets its own user, slice, rootless dockerd, and runner unit.
# It does not join docker or sudo. This script does not change release groups.
# Listeners are paused so a queued job cannot start during rootless setup.
# Active Runner.Worker processes are not signalled.
set -euo pipefail

SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=infra/ci/light-lane.sh
source "$SOURCE/light-lane.sh"

account=oren-ci-build-2
LISTENER_PIDS=()

account_exists() {
  id "$1" >/dev/null 2>&1
}

account_groups() {
  id -nG "$1"
}

preflight_privileges() {
  local name groups
  for name in oren-ci-release oren-ci-build oren-ci-build-2 oren-ci-light; do
    account_exists "$name" || continue
    groups=$(account_groups "$name")
    if [[ " $groups " == *' docker '* || " $groups " == *' sudo '* ]]; then
      echo "refusing before any installed-path change: $name is in docker or sudo" >&2
      return 2
    fi
  done
  if account_exists oren-ci-light; then
    groups=$(account_groups oren-ci-light)
    if [[ " $groups " == *' oren-ci-workers '* ]]; then
      echo 'refusing before any installed-path change: oren-ci-light is in oren-ci-workers' >&2
      return 2
    fi
  fi
  [[ $(budget heavyConcurrentMax) == 2 ]]
  [[ $(budget hostMiB) == 13312 ]]
  [[ $(budget prodReserveMiB) == 3840 ]]
}

signal_listener() {
  kill "-$1" "$2"
}

pause_listeners() {
  LISTENER_PIDS=()
  local pid
  if [[ -n ${LISTENER_LIST_FILE:-} ]]; then
    while read -r pid; do
      [[ -n $pid ]] || continue
      LISTENER_PIDS+=("$pid")
    done < "$LISTENER_LIST_FILE"
  else
    while read -r pid; do
      [[ -n $pid ]] || continue
      LISTENER_PIDS+=("$pid")
    done < <(pgrep -x Runner.Listener || true)
  fi
  for pid in "${LISTENER_PIDS[@]}"; do
    signal_listener STOP "$pid" || true
  done
  trap resume_listeners EXIT
}

resume_listeners() {
  local pid
  for pid in "${LISTENER_PIDS[@]:-}"; do
    signal_listener CONT "$pid" || true
  done
}

wait_until_idle() {
  local attempt reason
  for attempt in $(seq 1 "${DRAIN_ATTEMPTS:-90}"); do
    reason=$(safety_reason) || true
    if [[ -z $reason ]]; then
      return 0
    fi
    echo "waiting for the active job to finish: $reason" >&2
    sleep "${DRAIN_SLEEP:-2}"
  done
  echo 'timed out waiting for active jobs; listeners will be resumed and no files were replaced' >&2
  return 2
}

prepare_migration() {
  preflight_privileges || return
  pause_listeners || return
  wait_until_idle || return
  preflight_privileges || return
}

write_runner_unit() {
  local account_name=$1 id=$2 lane=$3
  local directory=/home/$account_name/runner-$lane
  local unit_dir=${UNIT_ROOT:-/home/$account_name/.config/systemd/user}
  local unit=$unit_dir/oren-runner-$lane.service
  local root=/opt/oren-ci
  install -d -m 755 "$unit_dir"
  cat > "$unit" <<EOF
[Unit]
Description=Oren GitHub Actions $lane runner
After=network-online.target
[Service]
WorkingDirectory=$directory
ExecStart=$directory/runsvc.sh
Restart=always
RestartSec=10
TimeoutStopSec=60
KillMode=control-group
UMask=0022
Environment=PATH=$root/toolchain/node-v22.23.4-linux-x64/bin:$root/bin:/usr/local/bin:/usr/bin:/bin
Environment=RUNNER_TOOL_CACHE=/home/$account_name/toolcache
Environment=ACTIONS_RUNNER_HOOK_JOB_STARTED=$root/bin/job-started.sh
Environment=ACTIONS_RUNNER_HOOK_JOB_COMPLETED=$root/bin/job-completed.sh
Environment=DOCKER_HOST=unix:///run/user/$id/docker.sock
[Install]
WantedBy=default.target
EOF
  chmod 644 "$unit"
  if [[ ${EUID:-} == 0 ]]; then
    chown root:root "$unit"
  fi
}

ensure_account() {
  local name=$1
  if ! account_exists "$name"; then
    useradd --create-home --shell /bin/bash "$name"
  fi
}

disable_new_runner() {
  local name=$1 lane=$2
  account_exists "$name" || return 0
  local id
  id=$(id -u "$name")
  runuser -u "$name" -- env XDG_RUNTIME_DIR="/run/user/$id" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$id/bus" \
    systemctl --user disable --now "oren-runner-$lane.service" 2>/dev/null || true
}

mutate_installed_files() {
  [[ ${EUID:-} == 0 ]] || { echo 'apply must run as root' >&2; return 1; }
  ensure_account "$account"
  ensure_account oren-ci-light
  preflight_privileges
  getent group oren-ci-workers >/dev/null
  usermod -a -G oren-ci-workers "$account"
  preflight_privileges
  local stamp backup manifest live id light_id
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
  record_backup "$live/light-completed.sh" "$backup" "$manifest"
  record_backup "$live/light-client.py" "$backup" "$manifest"
  install -d -m 755 "$live"
  install_atomic "$SOURCE/admission.py" "$live/admission.py" 644
  install_atomic "$SOURCE/budgets.json" "$live/budgets.json" 644
  install_atomic "$SOURCE/job-started.sh" "$live/job-started.sh" 755
  install_atomic "$SOURCE/job-completed.sh" "$live/job-completed.sh" 755
  install_atomic "$SOURCE/light-started.sh" "$live/light-started.sh" 755
  install_atomic "$SOURCE/light-completed.sh" "$live/light-completed.sh" 755
  install_atomic "$SOURCE/light-client.py" "$live/light-client.py" 644
  chown root:root "$live/admission.py" "$live/budgets.json" "$live/job-started.sh" \
    "$live/job-completed.sh" "$live/light-started.sh" "$live/light-completed.sh" \
    "$live/light-client.py"
  id=$(id -u "$account")
  light_id=$(id -u oren-ci-light)
  [[ "$id" != "$(id -u oren-ci-build)" && "$id" != "$light_id" ]]
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
  write_light_slice "$light_id" "${HOST_ROOT:-}/etc/systemd/system/user-$light_id.slice.d/oren-ci.conf"
  write_runner_unit "$account" "$id" build-2
  write_light_unit "$light_id"
  loginctl enable-linger "$account"
  systemctl restart "user@$id.service"
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
  echo 'admission restarted after the light account and build-2 unit existed; runners were not registered'
}

cmd_apply() {
  prepare_migration || return
  mutate_installed_files
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

cmd_rollback() {
  local manifest=${1:?manifest}
  prepare_migration || return
  [[ -f $manifest ]]
  [[ ${EUID:-} == 0 ]] || { echo 'rollback must run as root' >&2; return 1; }
  disable_new_runner oren-ci-build-2 build-2
  disable_new_runner oren-ci-light light
  local backup sha mode owner path
  backup=$(dirname -- "$manifest")
  while read -r sha mode owner path; do
    [[ -n ${sha:-} ]] || continue
    install_atomic "$backup/$sha" "$path" "$mode"
    chown -- "$owner" "$path"
  done < "$manifest"
  systemctl daemon-reload
  systemctl restart oren-ci-admission.service
  echo 'restored the backed-up files; build-2 and light runners were disabled without touching release groups'
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
