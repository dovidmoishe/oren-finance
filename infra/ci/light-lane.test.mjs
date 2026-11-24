import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const text = name => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
const sha = name => createHash('sha256').update(readFileSync(fileURLToPath(new URL(name, import.meta.url)))).digest('hex');
const budget = JSON.parse(text('./budgets.json'));
const repo = fileURLToPath(new URL('../..', import.meta.url));

test('installed heavy hooks and lease client stay byte-identical', () => {
  assert.equal(sha('./job-started.sh'), '4bceb6abdbf90ec3ffa1294674b04d7c4612c8ae149f426d958583add9be9533');
  assert.equal(sha('./job-completed.sh'), '3a642caa35bf4d624efc574e16b6cedb6f014c5bf8c0e6cef7135d3bc0dc57c0');
  assert.match(text('./job-started.sh'), /oren-ci-build-2/);
  assert.match(text('./job-started.sh'), /account" == oren-ci-release/);
  assert.ok(text('./job-started.sh').indexOf('trusted-job.mjs release') > text('./job-started.sh').indexOf('oren-ci-build-2'));
  assert.equal(sha('./lease-client.py'), '8ffd8bd1a4fcfb57e7ea06d6c98959cd586e38cbd4390520e2adb5cb43ce81dd');
  const started = text('./job-started.sh');
  assert.ok(started.indexOf('lease-client.py') < started.indexOf('docker_info='));
  assert.equal(started.match(/docker info/g).length, 1);
  assert.match(started, /\/usr\/bin\/timeout --signal=TERM --kill-after=5s 30s docker info/);
  assert.match(text('./admission.py'), /b'OK\\n'/);
  assert.match(text('./lease-client.py'), /b'OK\\n'/);
  assert.match(text('./admission.py'), /user-\{uid\}\.slice\/memory\.current/);
  assert.match(text('./admission.py'), /user-\{uid\}\.slice\/memory\.reclaim/);
  assert.doesNotMatch(text('./light-lane.sh'), /job-started\.sh|job-completed\.sh/);
});

test('light cap stays bounded and the 13 GiB host keeps a 3.75 GiB reserve', () => {
  assert.equal(budget.lintChunkPeakBytes, 468426752);
  assert.ok(budget.lintChunkPeakBytes < budget.lightHighMiB * 1024 * 1024);
  assert.ok(budget.lintProcessPeakBytes > budget.lightMaxMiB * 1024 * 1024);
  assert.ok(budget.installLightOomPeakBytes > budget.lightMaxMiB * 1024 * 1024);
  assert.ok(budget.installSerialOomPeakBytes >= budget.lightMaxMiB * 1024 * 1024);
  assert.ok(budget.installHeavyPeakBytes < budget.heavyActiveMaxMiB * 1024 * 1024);
  assert.equal(budget.lintHeavyPeakBytes, 643956736);
  assert.ok(budget.lintHeavyPeakBytes < budget.heavyActiveMaxMiB * 1024 * 1024);
  assert.equal(budget.lightStartMinAvailableMiB, undefined);
  assert.equal(budget.heavyGrowthSlackMiB, undefined);
  assert.equal(budget.heavyConcurrentMax, 2);
  assert.equal(budget.hostMiB, 13312);
  assert.equal(budget.logicalCpus, 4);
  const sum = (budget.heavyConcurrentMax * budget.heavyActiveMaxMiB)
    + budget.heavyIdleMaxMiB + budget.controlMaxMiB + budget.lightMaxMiB;
  assert.equal(sum, 9472);
  assert.equal(budget.hostMiB - sum, budget.prodReserveMiB);
  assert.equal(budget.prodReserveMiB, 3840);
  assert.ok(budget.prodReserveMiB >= 3 * 1024);
  assert.ok(budget.lightMaxMiB < 1280);
});

test('the legacy light lane keeps its memory and CPU caps', () => {
  const slice = text('./light.slice.conf');
  assert.match(slice, /MemoryHigh=768M\nMemoryMax=768M\nMemorySwapMax=0/);
  assert.match(slice, /CPUQuota=100%/);
  assert.match(text('./provision.sh'), /install -m 644 "\$SOURCE\/light\.slice\.conf"/);
});

test('light hooks do not reach docker or the heavy lease', () => {
  for (const name of ['./light-started.sh', './light-completed.sh']) {
    const source = text(name);
    assert.match(source, /oren-ci-light/);
    assert.doesNotMatch(source, /docker|lease-client|systemctl|MemoryMax/);
  }
  assert.match(text('./light-started.sh'), /light-client\.py/);
  assert.doesNotMatch(text('./light-started.sh'), /light_headroom_ok|MemAvailable|lightStartMinAvailableMiB/);
  const canary = text('./light-lane-canary.sh');
  assert.ok(canary.indexOf('light-client.py') < canary.indexOf('lint-bounded.mjs'));
  assert.match(canary, /oren-ci-light/);
  assert.doesNotMatch(canary, /EUID == 0/);
  const provision = text('./provision.sh');
  assert.match(provision, /for account in oren-ci-build oren-ci-release; do/);
  assert.doesNotMatch(provision, /usermod -a -G oren-ci-workers oren-ci-light/);
  assert.match(provision, /"\$lane" == light/);
  assert.match(text('./light.slice.conf'), /MemoryMax=768M/);
  assert.match(text('./light.slice.conf'), /MemoryHigh=768M/);
  assert.match(text('./light.slice.conf'), /CPUQuota=100%/);
});

test('admission restart stays blocked for a live worker or a fat cgroup', () => {
  const reason = (workers, ...usages) => spawnSync('bash', ['-c', `
    source infra/ci/light-lane.sh
    restart_block_reason ${workers} ${usages.join(' ')}
  `], { encoding: 'utf8', cwd: repo });
  const idle = 200 * 1024 * 1024;
  const fat = 1400 * 1024 * 1024;
  const clear = reason(0, idle, idle);
  assert.equal(clear.status, 0, clear.stderr);
  assert.equal(clear.stdout, '');
  assert.match(reason(1, idle, idle).stdout, /runner worker still exists/);
  assert.match(reason(0, fat, idle).stdout, /cgroup above idle floor/);
  const measured = 510881792;
  const floor = 448 * 1024 * 1024;
  assert.match(reason(0, measured, idle).stdout, /cgroup above idle floor/);
  assert.equal(reason(0, floor, floor).stdout, '');
  assert.match(reason(0, floor + 1, floor).stdout, /cgroup above idle floor/);
  const script = text('./light-lane.sh');
  const restartAt = script.indexOf('systemctl restart oren-ci-admission.service');
  const checkAt = script.indexOf('refusing before any installed-path change');
  assert.ok(checkAt !== -1 && checkAt < restartAt);
});

test('apply and rollback return before any installed-path write', () => {
  const probe = spawnSync('bash', ['-c', `
    set -euo pipefail
    source infra/ci/light-lane.sh
    touched=$(mktemp)
    rm -f "$touched"
    safety_reason() { echo 'runner worker still exists'; }
    install_atomic() { echo mutated >"$touched"; }
    record_backup() { echo mutated >"$touched"; }
    write_light_slice() { echo mutated >"$touched"; }
    write_light_unit() { echo mutated >"$touched"; }
    systemctl() { echo mutated >"$touched"; }
    useradd() { echo mutated >"$touched"; }
    set +e
    cmd_apply
    status=$?
    set -e
    test "$status" -eq 2
    test ! -e "$touched"
    set +e
    cmd_rollback /tmp/does-not-need-to-exist
    status=$?
    set -e
    test "$status" -eq 2
    test ! -e "$touched"
    rm -f "$touched"
  `], { encoding: 'utf8', cwd: repo });
  assert.equal(probe.status, 0, `${probe.stdout}\n${probe.stderr}`);
});

test('stage can copy outside installed paths and refuses installed paths', () => {
  const probe = spawnSync('bash', ['-c', `
    set -euo pipefail
    source infra/ci/light-lane.sh
    set +e
    cmd_stage /opt/oren-ci/bin
    status=$?
    set -e
    test "$status" -eq 1
    dest=$(mktemp -d)
    cmd_stage "$dest"
    test -f "$dest/admission.py"
    test -f "$dest/light-started.sh"
    rm -rf "$dest"
  `], { encoding: 'utf8', cwd: repo });
  assert.equal(probe.status, 0, `${probe.stdout}\n${probe.stderr}`);
});

test('the second heavy account is a separate UID and does not widen release', () => {
  const pair = text('./heavy-pair.sh');
  const register = text('./register-build-2.sh');
  assert.match(pair, /oren-ci-build-2/);
  assert.match(pair, /refusing before any installed-path change/);
  assert.match(pair, /user-\$id\.slice/);
  assert.doesNotMatch(pair, /usermod[^\n]*oren-ci-release/);
  assert.doesNotMatch(pair, /usermod -a -G docker/);
  assert.match(register, /--name oren-vps-build-2 --labels oren-build/);
  assert.match(register, /id" != "\$\(id -u oren-ci-build\)/);
  assert.match(register, /admission was not restarted and release was not changed/);
  assert.doesNotMatch(text('./job-started.sh'), /oren-ci-build-2[\s\S]{0,80}trusted-job/);
  const registerAt = register.indexOf('systemctl --user enable --now oren-runner-build-2.service');
  assert.ok(register.indexOf('UMask=0022') !== -1 && register.indexOf('UMask=0022') < registerAt);
  assert.ok(register.indexOf('DOCKER_HOST=unix:///run/user/$id/docker.sock') < registerAt);
});

test('migration preflight and a live worker abort before any installed file changes', () => {
  const probe = spawnSync('bash', ['-c', `
    set -euo pipefail
    source infra/ci/heavy-pair.sh
    touched=$(mktemp)
    rm -f "$touched"
    install_atomic() { echo mutated >"$touched"; }
    mutate_installed_files() { echo mutated >"$touched"; }
    account_exists() { [[ $1 == oren-ci-release ]]; }
    account_groups() { echo 'oren-ci-release docker'; }
    set +e
    preflight_privileges
    status=$?
    set -e
    test "$status" -eq 2
    test ! -e "$touched"
    account_exists() { return 1; }
    account_groups() { echo 'oren-ci-release'; }
    require_root() { true; }
    safety_reason() { echo 'runner worker still exists'; }
    signals=$(mktemp)
    signal_listener() { echo "$1 $2" >> "$signals"; }
    listeners=$(mktemp)
    printf '4242\\n' > "$listeners"
    export LISTENER_LIST_FILE=$listeners
    set +e
    cmd_apply
    status=$?
    set -e
    test "$status" -eq 2
    test ! -e "$touched"
    test ! -s "$signals"
    require_root() { true; }
    safety_reason() { echo 'light permit still held'; }
    set +e
    cmd_rollback /tmp/does-not-need-to-exist
    status=$?
    set -e
    test "$status" -eq 2
    test ! -e "$touched"
    rm -f "$touched" "$signals" "$listeners"
  `], { encoding: 'utf8', cwd: repo });
  assert.equal(probe.status, 0, `${probe.stdout}\n${probe.stderr}`);
});

test('a failed rootless docker install still restores the idle memory cap', () => {
  const heavy = text('./heavy-pair.sh');
  const raised = heavy.indexOf('MemoryMax=3840M MemoryHigh=3584M CPUQuota=100%');
  const restored = heavy.indexOf('MemoryMax=512M MemoryHigh=448M CPUQuota=25% MemorySwapMax=0');
  assert.ok(raised > 0 && restored > raised);
  assert.match(heavy, /install -d -m 755 "\$unit_dir"/);
  const light = text('./register-light.sh');
  assert.match(light, /runsvc\.sh/);
  assert.match(light, /\.path/);
});

test('build-2 unit is installed with the heavy hook environment before registration', () => {
  const probe = spawnSync('bash', ['-c', `
    set -euo pipefail
    source infra/ci/heavy-pair.sh
    root=$(mktemp -d)
    runner=$root/runner
    mkdir -p "$runner/bin"
    printf '#!/bin/sh\\nexec "\\$@"\\n' > "$runner/bin/runsvc.sh"
    chmod 755 "$runner/bin/runsvc.sh"
    printf 'stale\\n' > "$runner/runsvc.sh"
    UNIT_ROOT=$root/unit
    RUNNER_DIR=$runner
    write_runner_unit oren-ci-build-2 1099 build-2
    unit=$UNIT_ROOT/oren-runner-build-2.service
    grep -q '^UMask=0022$' "$unit"
    grep -q '^Environment=DOCKER_HOST=unix:///run/user/1099/docker.sock$' "$unit"
    grep -q '^Environment=ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/oren-ci/bin/job-started.sh$' "$unit"
    grep -q '^Environment=ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/opt/oren-ci/bin/job-completed.sh$' "$unit"
    grep -q "^ExecStart=$runner/runsvc.sh$" "$unit"
    grep -q "^WorkingDirectory=$runner$" "$unit"
    cmp "$runner/bin/runsvc.sh" "$runner/runsvc.sh"
    test -x "$runner/runsvc.sh"
    test -d "$runner/_work"
    test -d "$runner/_diag"
    grep -q '/opt/oren-ci/toolchain/node-v22.23.4-linux-x64/bin' "$runner/.path"
    rm -rf "$root"
  `], { encoding: 'utf8', cwd: repo });
  assert.equal(probe.status, 0, `${probe.stdout}\n${probe.stderr}`);
});

test('a non-root unit write refuses an unwritable runner directory', () => {
  const heavy = text('./heavy-pair.sh');
  assert.match(heavy, /directory=\$\{RUNNER_DIR:-\/home\/\$account_name\/runner-\$lane\}/);
  const probe = spawnSync('bash', ['-c', `
    set -euo pipefail
    source infra/ci/heavy-pair.sh
    test "$(id -u)" -ne 0
    root=$(mktemp -d)
    runner=$root/runner
    mkdir -p "$runner/bin"
    printf '#!/bin/sh\\nlive\\n' > "$runner/bin/runsvc.sh"
    printf 'live-runner\\n' > "$runner/runsvc.sh"
    chmod a-w "$runner"
    unit_root=$root/unit
    set +e
    UNIT_ROOT=$unit_root RUNNER_DIR=$runner write_runner_unit oren-ci-build-2 1099 build-2
    status=$?
    set -e
    test "$status" -eq 2
    test ! -e "$unit_root/oren-runner-build-2.service"
    chmod u+w "$runner"
    cmp -s <(printf 'live-runner\\n') "$runner/runsvc.sh"
    test ! -d "$runner/_work"
    rm -rf "$root"
  `], { encoding: 'utf8', cwd: repo });
  assert.equal(probe.status, 0, `${probe.stdout}\n${probe.stderr}`);
});

test('a live light permit blocks restart even when the heavy slices are idle', () => {
  const probe = spawnSync('bash', ['-c', `
    set -euo pipefail
    source infra/ci/light-lane.sh
    lease=$(mktemp)
    printf '1004 %s stamp\\n' $$ > "$lease"
    export LIGHT_LEASE_FILE=$lease
    light_permit_busy
    reason=$(safety_reason)
    test "$reason" = 'light permit still held'
    rm -f "$lease"
  `], { encoding: 'utf8', cwd: repo });
  assert.equal(probe.status, 0, `${probe.stdout}\n${probe.stderr}`);
});

test('a failed check after listeners are held resumes them and does not install', () => {
  const probe = spawnSync('bash', ['-c', `
    set -euo pipefail
    source infra/ci/heavy-pair.sh
    run_case() {
      local which=$1
      local touched signals listeners
      touched=$(mktemp)
      signals=$(mktemp)
      listeners=$(mktemp)
      rm -f "$touched"
      printf '4242\\n' > "$listeners"
      require_root() { true; }
      read_safety() { true; }
      signal_listener() { echo "$1 $2" >> "$signals"; }
      mutate_installed_files() { echo mutated >"$touched"; }
      ensure_account() { echo account >"$touched"; }
      useradd() { echo account >"$touched"; }
      install_atomic() { echo mutated >"$touched"; }
      systemctl() { echo restart >"$touched"; }
      export LISTENER_LIST_FILE=$listeners
      if [[ $which == privileges ]]; then
        preflight_host() { true; }
        preflight_privileges() {
          PRIV_N=\$((\${PRIV_N:-0} + 1))
          if (( PRIV_N >= 2 )); then return 2; fi
        }
      else
        preflight_privileges() { true; }
        preflight_host() {
          HOST_N=\$((\${HOST_N:-0} + 1))
          if (( HOST_N >= 2 )); then return 2; fi
        }
      fi
      set +e
      cmd_apply
      local status=$?
      set -e
      test "$status" -ne 0
      test ! -e "$touched"
      grep -q '^STOP 4242$' "$signals"
      grep -q '^CONT 4242$' "$signals"
      trap - EXIT
      rm -f "$touched" "$signals" "$listeners"
    }
    run_case privileges
    run_case host
    trap - EXIT
  `], { encoding: 'utf8', cwd: repo });
  assert.equal(probe.status, 0, `${probe.stdout}\n${probe.stderr}`);
});

test('unreadable cgroup usage and a failed safety check do not permit mutation', () => {
  const probe = spawnSync('bash', ['-c', `
    set -euo pipefail
    source infra/ci/heavy-pair.sh
    touched=$(mktemp)
    rm -f "$touched"
    require_root() { true; }
    mutate_installed_files() { echo mutated >"$touched"; }
    signal_listener() { echo "$1" >> "$touched.signals"; }
    account_exists() { [[ $1 == oren-ci-build-2 ]]; }
    uid_of() { echo 1099; }
    account_groups() { echo 'oren-ci-build-2'; }
    usage_of() { return 1; }
    set +e
    cmd_apply
    status=$?
    set -e
    test "$status" -eq 2
    test ! -e "$touched"
    test ! -e "$touched.signals"
    safety_reason() { return 1; }
    set +e
    read_safety
    status=$?
    set -e
    test "$status" -eq 2
    rm -f "$touched" "$touched.signals"
  `], { encoding: 'utf8', cwd: repo });
  assert.equal(probe.status, 0, `${probe.stdout}\n${probe.stderr}`);
});

test('a zombie runner worker is not a live job and a low MemTotal is refused', () => {
  const probe = spawnSync('bash', ['-c', `
    set -euo pipefail
    source infra/ci/light-lane.sh
    root=$(mktemp -d)
    mkdir -p "$root/10" "$root/11"
    printf 'Runner.Worker' > "$root/10/comm"
    printf '10 (Runner.Worker) Z 0\\n' > "$root/10/stat"
    printf 'Runner.Worker' > "$root/11/comm"
    printf '11 (Runner.Worker) R 0\\n' > "$root/11/stat"
    PROC_ROOT=$root
    test "$(worker_count)" = 1
    rm -rf "$root/11"
    PROC_ROOT=$root
    test "$(worker_count)" = 0
    rm -rf "$root"
    source infra/ci/heavy-pair.sh
    mem=$(mktemp)
    printf 'MemTotal: 12288000 kB\\nSwapTotal: 1048576 kB\\n' > "$mem"
    MEMINFO_FILE=$mem NPROC_VALUE=4
    set +e
    preflight_host
    status=$?
    set -e
    test "$status" -eq 2
    printf 'MemTotal: 13312000 kB\\nSwapTotal: 1048576 kB\\n' > "$mem"
    MEMINFO_FILE=$mem NPROC_VALUE=4
    preflight_host
    rm -f "$mem"
  `], { encoding: 'utf8', cwd: repo });
  assert.equal(probe.status, 0, `${probe.stdout}\n${probe.stderr}`);
});
