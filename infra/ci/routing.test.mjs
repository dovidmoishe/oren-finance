import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const workflow = name => readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
const job = (text, name) => text.split(`\n  ${name}:\n`)[1]?.split(/\n  [a-z][a-z0-9-]*:\n/)[0];

test('all workflows use dedicated self-hosted labels without hosted fallbacks', () => {
  for (const file of readdirSync(new URL('../../.github/workflows/', import.meta.url))) {
    if (!file.endsWith('.yml')) continue;
    const source = workflow(file.slice(0, -4));
    const runners = [...source.matchAll(/^\s+runs-on: (.+)$/gm)].map(m => m[1]);
    assert.ok(runners.length, file);
    assert.ok(runners.every(r => /^\[self-hosted, linux, x64, oren-(build|control)\]$/.test(r)), file);
  }
});

test('CI aggregate runs on the build lane, so a polling control gate cannot deadlock it', () => {
  const ci = workflow('ci');
  for (const name of ['preview-infra', 'api', 'app-check', 'app']) assert.match(job(ci, name), /oren-build/);
  assert.match(job(ci, 'app'), /if: always\(\)/);
  assert.match(job(ci, 'app'), /test "\$RESULT" = success/);
  assert.doesNotMatch(ci, /\bsudo\b|install -d \/opt\/oren|5432:5432|--network host/);
  assert.match(ci, /job.services.postgres.ports\['5432'\]/);
  assert.match(ci, /job.services.postgres.id/);
  assert.match(ci, /head.repo.full_name == github.repository/);
});

test('builds wait for exact-SHA CI before competing for the single build worker', () => {
  for (const name of ['build-api', 'build-app']) {
    assert.match(job(workflow('preview'), name), /needs: \[resolve, ci-gate\]/);
    assert.match(job(workflow('deploy-production'), name), /needs: ci-gate/);
  }
  for (const file of ['preview', 'deploy-production']) {
    assert.match(job(workflow(file), 'ci-gate'), /oren-control/);
    assert.match(job(workflow(file), 'deploy'), /oren-control/);
  }
});

test('test fixtures override paths while deployed preview defaults remain intact', () => {
  const compose = readFileSync(new URL('../preview/compose.yml', import.meta.url), 'utf8');
  assert.match(compose, /PREVIEW_PROVIDER_ENV:-\/opt\/oren\/preview\/provider.env/);
  assert.match(compose, /PREVIEW_OAUTH_ENV:-\/opt\/oren\/preview\/stacks\/pr-/);
  const isolation = readFileSync(new URL('../preview/isolation.sh', import.meta.url), 'utf8');
  assert.match(isolation, /GITHUB_RUN_ID/);
  assert.match(isolation, /oren-ci-preview-\$\{ID,,\}-a/);
});
