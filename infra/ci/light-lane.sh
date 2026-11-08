#!/usr/bin/env bash
# Focused light-lane install. Do not run provision.sh for this change:
# provision restarts admission and the heavy runners.
# Default subcommand is check (read-only). apply installs files and restarts
# admission only when no Runner.Worker exists and both heavy slices are inside
# the idle cap plus margin.
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
  cat "$root/user.slice/user-$uid.slice/memory.current"
}

worker_count() {
  if [[ -n ${WORKER_LIST_FILE:-} ]]; then
    wc -l < "$WORKER_LIST_FILE"
    return 0
  fi
  pgrep -cx Runner.Worker || true
}

heavy_uids() {
  id -u oren-ci-build
  id -u oren-ci-release
}

safety_reason() {
  local workers uid reason usages=()
  workers=$(worker_count)
  workers=${workers// /}
  for uid in $(heavy_uids); do
    usages+=("$(usage_of "$uid")")
  done
  reason=$(restart_block_reason "$workers" "${usages[@]}")
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
  [[ ${EUID:-} == 0 ]] || { echo 'apply must run as root' >&2; exit 1; }
  local reason backup manifest
  reason=$(safety_reason) || true
  local stamp
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  backup=${HOST_ROOT}/root/oren-ci-light-backup-$stamp
  manifest=$backup/manifest.txt
  install -d -m 700 "$backup"
  : > "$manifest"
  local live=${HOST_ROOT}/opt/oren-ci/bin
  record_backup "$live/admission.py" "$backup" "$manifest"
  record_backup "$live/budgets.json" "$backup" "$manifest"
  install -d -m 755 "$live"
  install_atomic "$SOURCE/admission.py" "$live/admission.py" 644
  install_atomic "$SOURCE/budgets.json" "$live/budgets.json" 644
  install_atomic "$SOURCE/light-started.sh" "$live/light-started.sh" 755
  install_atomic "$SOURCE/light-completed.sh" "$live/light-completed.sh" 755
  chown root:root "$live/admission.py" "$live/budgets.json" "$live/light-started.sh" "$live/light-completed.sh"
  if ! id oren-ci-light >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash oren-ci-light
  fi
  [[ " $(id -nG oren-ci-light) " != *' docker '* && " $(id -nG oren-ci-light) " != *' sudo '* ]]
  [[ " $(id -nG oren-ci-light) " != *' oren-ci-workers '* ]]
  local light_id
  light_id=$(id -u oren-ci-light)
  write_light_slice "$light_id" "${HOST_ROOT}/etc/systemd/system/user-$light_id.slice.d/oren-ci.conf"
  write_light_unit "$light_id"
  echo "backup manifest $manifest"
  if [[ -n $reason ]]; then
    echo "files installed; admission restart blocked: $reason" >&2
    return 2
  fi
  systemctl daemon-reload
  systemctl restart oren-ci-admission.service
  echo 'admission restarted on an idle boundary; light runner was not started'
}

cmd_rollback() {
  local manifest=${1:?manifest}
  [[ -f $manifest ]]
  local reason backup sha mode owner path
  reason=$(safety_reason)
  if [[ -n $reason ]]; then
    echo "rollback blocked: $reason" >&2
    return 2
  fi
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
    rollback) cmd_rollback "${2:-}" ;;
    *) echo 'use check, apply, or rollback <manifest>' >&2; exit 1 ;;
  esac
fi
