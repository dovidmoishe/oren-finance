import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const text = name => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
const budget = JSON.parse(text('./budgets.json'));
const workflows = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));

test('measured eslint peak does not fit the 512 MiB light cap', () => {
  assert.equal(budget.lintPeakBytes, 1140269056);
  assert.ok(budget.lintPeakBytes > budget.lightMaxMiB * 1024 * 1024);
  assert.ok(budget.lintPeakBytes > budget.lightHighMiB * 1024 * 1024);
  assert.ok(budget.idleDockerdBytes + budget.downshiftMarginMiB * 1024 * 1024 <= budget.heavyIdleMaxMiB * 1024 * 1024);
  assert.ok(budget.buildPeakBytes > budget.heavyIdleMaxMiB * 1024 * 1024);
  const ci = text('../../.github/workflows/ci.yml');
  const appCheck = ci.split('\n  app-check:\n')[1].split('\n  app:\n')[0];
  assert.match(appCheck, /check: \[test, lint, build\]/);
  assert.match(appCheck, /oren-build/);
  assert.doesNotMatch(appCheck, /oren-light/);
});

test('oren-light is only the aggregate app check', () => {
  const hits = [];
  for (const file of readdirSync(workflows)) {
    if (!file.endsWith('.yml')) continue;
    const lines = readFileSync(`${workflows}/${file}`, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (line.includes('oren-light')) hits.push(`${file}:${index + 1}:${line.trim()}`);
    });
  }
  assert.equal(hits.length, 1);
  assert.match(hits[0], /^ci\.yml:\d+:runs-on: \[self-hosted, linux, x64, oren-light\]$/);
  const ci = text('../../.github/workflows/ci.yml');
  const aggregate = ci.split('\n  app:\n')[1];
  assert.match(aggregate, /test "\$RESULT" = success/);
  assert.doesNotMatch(aggregate, /docker|pnpm run lint|pnpm test|pnpm run build/);
});

test('light hooks do not reach docker or the heavy lease', () => {
  for (const name of ['./light-started.sh', './light-completed.sh']) {
    const source = text(name);
    assert.match(source, /oren-ci-light/);
    assert.doesNotMatch(source, /docker|lease-client|systemctl|oren-ci-build|oren-ci-release|MemoryMax/);
  }
  const provision = text('./provision.sh');
  assert.match(provision, /for account in oren-ci-build oren-ci-release; do/);
  assert.doesNotMatch(provision, /usermod -a -G oren-ci-workers oren-ci-light/);
  assert.match(provision, /"\$lane" == light/);
  assert.match(provision, /MemoryMax=512M/);
});

test('admission restart stays blocked for a live worker or a fat cgroup', () => {
  const reason = (workers, ...usages) => spawnSync('bash', ['-c', `
    source infra/ci/light-lane.sh
    restart_block_reason ${workers} ${usages.join(' ')}
  `], { encoding: 'utf8', cwd: fileURLToPath(new URL('../..', import.meta.url)) });
  const idle = 200 * 1024 * 1024;
  const fat = 1400 * 1024 * 1024;
  const clear = reason(0, idle, idle);
  assert.equal(clear.status, 0, clear.stderr);
  assert.equal(clear.stdout, '');
  assert.match(reason(1, idle, idle).stdout, /runner worker still exists/);
  assert.match(reason(0, fat, idle).stdout, /cgroup above idle floor/);
  const script = text('./light-lane.sh');
  const restartAt = script.indexOf("systemctl restart oren-ci-admission.service");
  const checkAt = script.indexOf('if [[ -n $reason ]]');
  assert.ok(checkAt !== -1 && checkAt < restartAt);
});
