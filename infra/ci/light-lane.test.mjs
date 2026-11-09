import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const text = name => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
const sha = name => createHash('sha256').update(readFileSync(fileURLToPath(new URL(name, import.meta.url)))).digest('hex');
const budget = JSON.parse(text('./budgets.json'));
const workflows = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));
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
  assert.ok(budget.lintProcessPeakBytes > 512 * 1024 * 1024);
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

test('lint is the only heavy-sized check moved, and it is chunked', () => {
  const hits = [];
  for (const file of readdirSync(workflows)) {
    if (!file.endsWith('.yml')) continue;
    readFileSync(`${workflows}/${file}`, 'utf8').split('\n').forEach((line, index) => {
      if (line.includes('oren-light')) hits.push(`${file}:${index + 1}:${line.trim()}`);
    });
  }
  assert.equal(hits.length, 2);
  assert.ok(hits.every(hit => hit.startsWith('ci.yml:')));
  const ci = text('../../.github/workflows/ci.yml');
  const appCheck = ci.split('\n  app-check:\n')[1].split('\n  app:\n')[0];
  assert.match(appCheck, /check: test/);
  assert.match(appCheck, /runner: oren-build/);
  assert.match(appCheck, /check: lint/);
  assert.match(appCheck, /runner: oren-light/);
  assert.match(appCheck, /check: build/);
  assert.match(appCheck, /node scripts\/lint-bounded\.mjs/);
  assert.match(ci.split('\n  app:\n')[1], /test "\$RESULT" = success/);
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
  assert.match(provision, /MemoryMax=768M/);
  assert.match(provision, /MemoryHigh=640M/);
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
});
