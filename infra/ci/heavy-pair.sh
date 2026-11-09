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
  [[ $(budget prodReserveMiB) == 3840 ]]
}

require_root() {
  [[ ${EUID:-} == 0 ]] || { echo 'migration must run as root' >&2; return 1; }
}

read_meminfo_kib() {
  local key=$1 file=${MEMINFO_FILE:-/proc/meminfo}
  awk -v key="$key:" '$1 == key { print $2; found=1 } END { if (!found) exit 1 }' "$file"
}

preflight_host() {
  # budgets.json hostMiB is the planning figure for a marketed 13 GiB host.
  # The gate uses the live MemTotal. SwapTotal is not required to be zero:
  # an earlier "no swap" reading was unused swap, and every CI slice sets
  # MemorySwapMax=0 so that swap cannot be charged to a CI cgroup.
  local total_kib swap_kib total_mib cap remainder cpus
  total_kib=$(read_meminfo_kib MemTotal) || {
    echo 'refusing before any installed-path change: MemTotal is unreadable' >&2
    return 2
  }
  total_mib=$((total_kib / 1024))
  cap=$(( ($(budget heavyConcurrentMax) * $(budget heavyActiveMaxMiB)) + $(budget heavyIdleMaxMiB) + $(budget controlMaxMiB) + $(budget lightMaxMiB) ))
  remainder=$((total_mib - cap))
  if (( remainder < 3072 )); then
    echo "refusing before any installed-path change: MemTotal ${total_mib} MiB leaves ${remainder} MiB after ${cap} MiB of caps; the floor is 3072 MiB" >&2
    return 2
  fi
  cpus=${NPROC_VALUE:-$(nproc)}
  if (( cpus < 4 )); then
    echo "refusing before any installed-path change: ${cpus} logical CPUs is below the 4 required for two heavy jobs" >&2
    return 2
  fi
  swap_kib=$(read_meminfo_kib SwapTotal) || swap_kib=unreadable
  echo "host check: MemTotal=${total_mib} MiB capSum=${cap} MiB remainder=${remainder} MiB SwapTotal=${swap_kib} KiB cpus=${cpus}" >&2
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

read_safety() {
  local status=0
  SAFETY_REASON=$(safety_reason) || status=$?
  if (( status != 0 )); then
    echo 'safety check failed with no usable result; refusing before any installed-path change' >&2
    return 2
  fi
  if [[ -n $SAFETY_REASON ]]; then
    echo "not idle: $SAFETY_REASON" >&2
    return 2
  fi
}

prepare_migration() {
  require_root || return
  preflight_privileges || return
  preflight_host || return
  # Refuse while a live job exists. Do not pause the listener first:
  # a stopped listener does not reap an exiting Runner.Worker, and a
  # zombie would keep the wait from ever finishing.
  read_safety || return
  pause_listeners || return
  if ! read_safety; then
    resume_listeners || true
    return 2
  fi
  # resume_listeners succeeds. A bare return would report that success and
  # let apply copy files while the queue is live again.
  preflight_privileges || { resume_listeners || true; return 2; }
  preflight_host || { resume_listeners || true; return 2; }
}

hold_still_valid() {
  read_safety || { resume_listeners || true; return 2; }
  local pid state root=${PROC_ROOT:-/proc}
  for pid in "${LISTENER_PIDS[@]}"; do
    [[ -r $root/$pid/stat ]] || continue
    state=$(awk '{print $3}' "$root/$pid/stat")
    if [[ $state != T && $state != t ]]; then
      echo "watchdog: listener $pid is not held; resuming and stopping" >&2
      resume_listeners || true
      return 2
    fi
  done
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

note_created() {
  printf 'created %s\n' "$1" >> "$manifest"
}

mutate_installed_files() {
  hold_still_valid || return
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
  local slice=${HOST_ROOT:-}/etc/systemd/system/user-$id.slice.d/oren-ci.conf
  local light_slice=${HOST_ROOT:-}/etc/systemd/system/user-$light_id.slice.d/oren-ci.conf
  [[ -e $slice ]] || note_created "$slice"
  [[ -e $light_slice ]] || note_created "$light_slice"
  install -d -m 755 "${HOST_ROOT:-}/etc/systemd/system/user-$id.slice.d"
  cat > "$slice" <<EOF
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
  write_light_slice "$light_id" "$light_slice"
  local build_unit=${UNIT_ROOT:-/home/$account/.config/systemd/user}/oren-runner-build-2.service
  local light_unit=/home/oren-ci-light/.config/systemd/user/oren-runner-light.service
  [[ -e $build_unit ]] || note_created "$build_unit"
  [[ -e $light_unit ]] || note_created "$light_unit"
  write_runner_unit "$account" "$id" build-2
  write_light_unit "$light_id"
  note_created "linger:$account"
  loginctl enable-linger "$account"
  hold_still_valid || return
  systemctl restart "user@$id.service"
  systemctl set-property --runtime "user-$id.slice" MemoryMax=3840M MemoryHigh=3584M CPUQuota=100%
  runuser -u "$account" -- env XDG_RUNTIME_DIR="/run/user/$id" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$id/bus" \
    dockerd-rootless-setuptool.sh install --force
  note_created "docker:$account"
  runuser -u "$account" -- env XDG_RUNTIME_DIR="/run/user/$id" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$id/bus" \
    systemctl --user enable --now docker
  runuser -u "$account" -- env DOCKER_HOST="unix:///run/user/$id/docker.sock" \
    docker info --format '{{.DockerRootDir}} {{.CgroupDriver}}'
  systemctl set-property --runtime "user-$id.slice" MemoryMax=512M MemoryHigh=448M CPUQuota=25%
  install -d -m 750 -o "$account" -g "$account" "/home/$account/runner-build-2"
  echo "backup manifest $manifest"
  hold_still_valid || return
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

stop_created_service() {
  local kind=$1
  case $kind in
    linger:*)
      loginctl disable-linger "${kind#linger:}" || true
      echo "rollback: linger disabled for ${kind#linger:}"
      ;;
    docker:*)
      local name=${kind#docker:} id
      account_exists "$name" || return 0
      id=$(id -u "$name")
      runuser -u "$name" -- env XDG_RUNTIME_DIR="/run/user/$id" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$id/bus" \
        systemctl --user disable --now docker || true
      echo "rollback: rootless docker stopped for $name"
      ;;
    *)
      if [[ -e $kind ]]; then
        rm -f -- "$kind"
        echo "rollback: removed $kind"
      fi
      ;;
  esac
}

cmd_rollback() {
  local manifest=${1:?manifest}
  prepare_migration || return
  [[ -f $manifest ]]
  disable_new_runner oren-ci-build-2 build-2
  disable_new_runner oren-ci-light light
  local backup sha mode owner path kind
  backup=$(dirname -- "$manifest")
  while read -r sha mode owner path; do
    [[ -n ${sha:-} ]] || continue
    if [[ $sha == created ]]; then
      [[ -n ${mode:-} ]] && stop_created_service "$mode"
      continue
    fi
    install_atomic "$backup/$sha" "$path" "$mode"
    chown -- "$owner" "$path"
  done < "$manifest"
  systemctl daemon-reload
  systemctl restart oren-ci-admission.service
  if account_exists oren-ci-build-2; then
    echo 'leftover: Unix account oren-ci-build-2 and its home remain; linger, rootless docker, slice and runner unit from this migration are removed'
  fi
  if account_exists oren-ci-light; then
    echo 'leftover: Unix account oren-ci-light and its home remain if this migration created them; its runner unit and slice drop-in from this migration are removed'
  fi
  echo 'restored the backed-up admission files; release groups were not changed'
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
