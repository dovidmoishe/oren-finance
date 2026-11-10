#!/usr/bin/env bash
# Focused light-lane install. Do not run provision.sh for this change:
# provision restarts admission and the heavy runners.
# Default subcommand is check (read-only). apply and rollback return before
# any installed-path change when any Runner.Worker exists (app lint, control,
# build, or release) or a heavy slice is above the idle floor
# (current + 64 MiB <= 512 MiB). 487 MiB does not qualify. Staging writes
# only outside /opt/oren-ci, /etc/systemd, and /home.
set -euo pipefail

SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BUDGET=$SOURCE/budgets.json

budget() {
  python3 - "$BUDGET" "$1" <<'PY'
import json, sys
print(json.load(open(sys.argv[1]))[sys.argv[2]])
PY
}

IDLE_BYTES=$(( $(budget heavyIdleMaxMiB) * 1024 * 1024 ))
MARGIN_BYTES=$(( $(budget downshiftMarginMiB) * 1024 * 1024 ))

restart_block_reason() {
  local workers=$1
  shift
  if (( workers > 0 )); then
    printf 'runner worker still exists\n'
    return 0
  fi
  local usage
  for usage in "$@"; do
    if (( usage + MARGIN_BYTES > IDLE_BYTES )); then
      printf 'cgroup above idle floor\n'
      return 0
    fi
  done
  printf ''
}

usage_of() {
  local uid=$1 root=${CGROUP_ROOT:-/sys/fs/cgroup}
  local path=$root/user.slice/user-$uid.slice/memory.current value
  [[ -r $path ]] || return 1
  value=$(cat "$path") || return 1
  [[ $value =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "$value"
}

worker_state() {
  local pid=$1 root=${PROC_ROOT:-/proc}
  awk '{print $3}' "$root/$pid/stat" 2>/dev/null || echo '?'
}

worker_count() {
  # Live Runner.Worker processes only. A zombie (state Z) is an exited child
  # whose stopped listener has not reaped it; it is not an active job.
  local n=0 line pid state root=${PROC_ROOT:-/proc} comm
  if [[ -n ${WORKER_LIST_FILE:-} ]]; then
    while read -r line; do
      [[ -n $line && $line != Z ]] || continue
      n=$((n + 1))
    done < "$WORKER_LIST_FILE"
    printf '%s\n' "$n"
    return 0
  fi
  shopt -s nullglob
  for pid in "$root"/[0-9]*; do
    [[ -r $pid/comm ]] || continue
    comm=$(cat "$pid/comm") || continue
    [[ $comm == Runner.Worker ]] || continue
    state=$(awk '{print $3}' "$pid/stat" 2>/dev/null || echo '?')
    [[ $state == Z ]] && continue
    n=$((n + 1))
  done
  shopt -u nullglob
  printf '%s\n' "$n"
}

account_exists() {
  id "$1" >/dev/null 2>&1
}

uid_of() {
  id -u "$1"
}

heavy_uids() {
  local account
  # A never-created account is absent and is not a cgroup to read.
  # An account that already exists is managed: missing usage fails closed.
  for account in oren-ci-build oren-ci-build-2 oren-ci-release oren-ci-light; do
    account_exists "$account" || continue
    uid_of "$account"
  done
}

light_permit_busy() {
  local file=${LIGHT_LEASE_FILE:-/run/oren-ci-status/light-lease} pid
  [[ -f $file ]] || return 1
  pid=$(awk 'NR==1 {print $2}' "$file")
  [[ -n ${pid:-} && -d /proc/$pid ]]
}

safety_reason() {
  local workers uid usage reason usages=()
  workers=$(worker_count) || {
    printf 'worker check failed\n'
    return 0
  }
  workers=${workers// /}
  if light_permit_busy; then
    printf 'light permit still held\n'
    return 0
  fi
  for uid in $(heavy_uids); do
    if ! usage=$(usage_of "$uid"); then
      printf 'cgroup usage unreadable for uid %s\n' "$uid"
      return 0
    fi
    usages+=("$usage")
  done
  if (( ${#usages[@]} == 0 )); then
    reason=$(restart_block_reason "$workers")
  else
    reason=$(restart_block_reason "$workers" "${usages[@]}")
  fi
  printf '%s' "$reason"
}

install_atomic() {
  local src=$1 dest=$2 mode=$3
  local dir tmp
  dir=$(dirname -- "$dest")
  tmp=$(mktemp "$dir/.oren-ci.XXXXXX")
  cp -- "$src" "$tmp"
  chmod "$mode" "$tmp"
  mv -f -- "$tmp" "$dest"
}

record_backup() {
  local path=$1 backup=$2 manifest=$3
  [[ -e $path ]] || return 0
  local mode owner sha
  mode=$(stat -c %a -- "$path")
  owner=$(stat -c %U:%G -- "$path")
  sha=$(sha256sum -- "$path" | awk 'NR==1 {print $1}')
  cp -a -- "$path" "$backup/$sha"
  printf '%s %s %s %s\n' "$sha" "$mode" "$owner" "$path" >> "$manifest"
}

write_light_unit() {
  local id=$1
  local account=oren-ci-light
  local directory=/home/$account/runner-light
  local unit=/home/$account/.config/systemd/user/oren-runner-light.service
  local root=/opt/oren-ci
  install -d -m 700 -o "$account" -g "$account" "/home/$account/.config/systemd/user" "$directory/_work" "$directory/_diag"
  if [[ -f $directory/bin/runsvc.sh ]]; then
    install -m 755 -o "$account" -g "$account" "$directory/bin/runsvc.sh" "$directory/runsvc.sh"
  fi
  cat > "$unit" <<EOF
[Unit]
Description=Oren GitHub Actions light runner
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
Environment=RUNNER_TOOL_CACHE=/home/$account/toolcache
Environment=ACTIONS_RUNNER_HOOK_JOB_STARTED=$root/bin/light-started.sh
Environment=ACTIONS_RUNNER_HOOK_JOB_COMPLETED=$root/bin/light-completed.sh
[Install]
WantedBy=default.target
EOF
  chown root:root "$unit"
  chmod 644 "$unit"
  printf '%s\n' "$root/toolchain/node-v22.23.4-linux-x64/bin:$root/bin:/usr/local/bin:/usr/bin:/bin" > "$directory/.path"
  chown "$account:$account" "$directory/.path"
}

write_light_slice() {
  local uid=$1 dest=$2
  install -d -m 755 "$(dirname -- "$dest")"
  cat > "$dest" <<EOF
[Slice]
MemoryAccounting=yes
MemoryHigh=$(budget lightHighMiB)M
MemoryMax=$(budget lightMaxMiB)M
MemorySwapMax=0
CPUAccounting=yes
CPUQuota=$(budget lightCpuPercent)%
CPUWeight=50
TasksMax=$(budget lightTasksMax)
EOF
}

cmd_check() {
  local reason
  reason=$(safety_reason)
  if [[ -n $reason ]]; then
    echo "admission restart blocked: $reason" >&2
    return 2
  fi
  echo 'admission restart is inside the idle boundary'
}

cmd_apply() {
  local reason backup manifest
  reason=$(safety_reason) || { echo 'safety check failed; refusing before any installed-path change' >&2; return 2; }
  if [[ -n $reason ]]; then
    echo "refusing before any installed-path change: $reason" >&2
    return 2
  fi
  [[ ${EUID:-} == 0 ]] || { echo 'apply must run as root' >&2; return 1; }
  if ! id oren-ci-light >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash oren-ci-light
  fi
  [[ " $(id -nG oren-ci-light) " != *' docker '* && " $(id -nG oren-ci-light) " != *' sudo '* ]]
  [[ " $(id -nG oren-ci-light) " != *' oren-ci-workers '* ]]
  local stamp
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  backup=${HOST_ROOT:-}/root/oren-ci-light-backup-$stamp
  manifest=$backup/manifest.txt
  install -d -m 700 "$backup"
  : > "$manifest"
  local live=${HOST_ROOT:-}/opt/oren-ci/bin
  record_backup "$live/admission.py" "$backup" "$manifest"
  record_backup "$live/budgets.json" "$backup" "$manifest"
  install -d -m 755 "$live"
  install_atomic "$SOURCE/admission.py" "$live/admission.py" 644
  install_atomic "$SOURCE/budgets.json" "$live/budgets.json" 644
  install_atomic "$SOURCE/light-started.sh" "$live/light-started.sh" 755
  install_atomic "$SOURCE/light-completed.sh" "$live/light-completed.sh" 755
  chown root:root "$live/admission.py" "$live/budgets.json" "$live/light-started.sh" "$live/light-completed.sh"
  local light_id
  light_id=$(id -u oren-ci-light)
  write_light_slice "$light_id" "${HOST_ROOT:-}/etc/systemd/system/user-$light_id.slice.d/oren-ci.conf"
  write_light_unit "$light_id"
  echo "backup manifest $manifest"
  systemctl daemon-reload
  systemctl restart oren-ci-admission.service
  echo 'admission restarted on an idle boundary; light runner was not started'
}

cmd_stage() {
  local dest=${1:?stage directory}
  case $dest in
    /opt/oren-ci|/opt/oren-ci/*|/etc/systemd|/etc/systemd/*|/home|/home/*)
      echo 'stage directory is inside an installed path' >&2
      return 1
      ;;
  esac
  local real
  real=$(readlink -f -- "$dest") || {
    echo 'stage directory cannot be resolved' >&2
    return 1
  }
  case $real in
    /opt/oren-ci|/opt/oren-ci/*|/etc/systemd|/etc/systemd/*|/home|/home/*)
      echo 'stage directory is inside an installed path' >&2
      return 1
      ;;
  esac
  install -d -m 700 "$dest"
  install_atomic "$SOURCE/admission.py" "$dest/admission.py" 644
  install_atomic "$SOURCE/budgets.json" "$dest/budgets.json" 644
  install_atomic "$SOURCE/light-started.sh" "$dest/light-started.sh" 755
  install_atomic "$SOURCE/light-completed.sh" "$dest/light-completed.sh" 755
  echo "staged $dest"
}

cmd_rollback() {
  local manifest=${1:?manifest}
  local reason backup sha mode owner path
  reason=$(safety_reason)
  if [[ -n $reason ]]; then
    echo "refusing before any installed-path change: $reason" >&2
    return 2
  fi
  [[ -f $manifest ]]
  backup=$(dirname -- "$manifest")
  while read -r sha mode owner path; do
    [[ -n ${sha:-} ]] || continue
    install_atomic "$backup/$sha" "$path" "$mode"
    chown -- "$owner" "$path"
  done < "$manifest"
  systemctl daemon-reload
  systemctl restart oren-ci-admission.service
  echo 'restored backed-up admission files and restarted on an idle boundary'
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
