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
  assert.equal(sha('./job-started.sh'), '9a349f812fbbaddf53366ed2502c7040ac64d66c2fbba1163a656ac79b0272cf');
  assert.equal(sha('./job-completed.sh'), 'adc77f9de26d18d6291a0b43950078298001e76f3e6b94bc557bd6876a3f8a9c');
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

test('light cap covers a measured chunk and keeps the 1.75 GiB reserve', () => {
  assert.equal(budget.lintChunkPeakBytes, 468426752);
  assert.ok(budget.lintChunkPeakBytes < budget.lightHighMiB * 1024 * 1024);
  assert.ok(budget.lintProcessPeakBytes > 512 * 1024 * 1024);
  assert.equal(budget.lightStartMinAvailableMiB,
    budget.lightMaxMiB + budget.heavyGrowthSlackMiB + budget.prodReserveMiB);
  const sum = budget.heavyActiveMaxMiB + budget.heavyIdleMaxMiB + budget.controlMaxMiB + budget.lightMaxMiB;
  assert.equal(sum, 5632);
  assert.equal(budget.hostMiB - sum, budget.prodReserveMiB);
  assert.equal(budget.prodReserveMiB, 1792);
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
    assert.doesNotMatch(source, /docker|lease-client|systemctl|oren-ci-build|oren-ci-release|MemoryMax/);
  }
  assert.match(text('./light-started.sh'), /lightStartMinAvailableMiB/);
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
  const script = text('./light-lane.sh');
  const restartAt = script.indexOf('systemctl restart oren-ci-admission.service');
  const checkAt = script.indexOf('if [[ -n $reason ]]');
  assert.ok(checkAt !== -1 && checkAt < restartAt);
});
