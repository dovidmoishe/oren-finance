#!/usr/bin/env bash
# Light-lane start hook. No Docker and no heavy-job lease.
# Headroom is the shared admission decision: both heavy user-slice
# memory.current values, the persisted heavy lease, the light cap, and
# the production reserve. A fixed 2,816 MiB MemAvailable check is not used.
set -euo pipefail
[[ $(id -un) == oren-ci-light ]]
root=/sys/fs/cgroup
status=${HEAVY_LEASE_FILE:-/run/oren-ci-status/heavy-lease}
build=$(id -u oren-ci-build)
release=$(id -u oren-ci-release)
source_dir=${BASH_SOURCE[0]%/*}
attempts=${LIGHT_ATTEMPTS:-180}
echo 'CI light preflight: waiting for central headroom across both heavy slices.'
for attempt in $(seq 1 "$attempts"); do
  decision=$(python3 - "$root" "$build" "$release" "$status" "$source_dir/admission.py" <<'PY'
import importlib.util
import sys
from pathlib import Path
root, build, release, status, admission_path = sys.argv[1:]
spec = importlib.util.spec_from_file_location('admission', admission_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def read_current(uid):
    path = Path(root) / 'user.slice' / f'user-{uid}.slice' / 'memory.current'
    return int(path.read_text().strip())

available = 0
with open('/proc/meminfo') as source:
    for line in source:
        if line.startswith('MemAvailable:'):
            available = int(line.split()[1]) * 1024
            break
try:
    build_bytes = read_current(build)
    release_bytes = read_current(release)
except OSError as error:
    print(f'unreadable:{error}')
    raise SystemExit(0)
active = None
lease = Path(status)
if lease.exists():
    try:
        parts = lease.read_text().split()
    except OSError as error:
        print(f'unreadable:{error}')
        raise SystemExit(0)
    if parts and parts[0] == str(build):
        active = 'build'
    elif parts and parts[0] == str(release):
        active = 'release'
ok = module.light_headroom_ok(available, build_bytes, release_bytes, active=active)
print(('allow' if ok else 'deny')
      + f' available={available} build={build_bytes} release={release_bytes} active={active}')
PY
)
  case $decision in
    allow*)
      echo "CI light preflight: $decision; heavy admission was not requested."
      exit 0
      ;;
    deny*)
      if (( attempt % 12 == 1 )); then
        echo "CI light preflight: $decision" >&2
      fi
      ;;
    unreadable:*|*)
      echo "CI light preflight failed closed: $decision" >&2
      exit 1
      ;;
  esac
  sleep 5
done
echo 'CI light preflight failed closed: central headroom stayed below the production reserve.' >&2
exit 1
