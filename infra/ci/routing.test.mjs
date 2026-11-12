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
    assert.ok(runners.every(r => /^\[self-hosted, linux, x64, (oren-(build|release|control|light)|"\$\{\{ matrix\.runner \}\}")\]$/.test(r)), file);
  }
});

test('CI aggregate runs on the light lane, so a polling control gate cannot deadlock it', () => {
  const ci = workflow('ci');
  for (const name of ['preview-infra', 'api', 'app-check']) assert.match(job(ci, name), /oren-build/);
  assert.doesNotMatch(job(ci, 'app-check'), /oren-light/);
  assert.match(job(ci, 'app-check'), /node scripts\/lint-bounded\.mjs/);
  assert.match(job(ci, 'app'), /oren-light/);
  assert.match(job(ci, 'app'), /if: always\(\)/);
  assert.match(job(ci, 'app'), /test "\$RESULT" = success/);
  assert.doesNotMatch(ci, /\bsudo\b|install -d \/opt\/oren|5432:5432|--network host/);
  assert.match(ci, /job.services.postgres.ports\['5432'\]/);
  assert.match(ci, /job.services.postgres.id/);
  assert.match(ci, /head.repo.full_name == github.repository/);
  assert.match(ci, /chmod -R go-rwx lib\/db/);
  assert.match(ci, /runtime-readable.mjs/);
});

test('production publishers cannot share PR identities, daemons or remote caches', () => {
  const production=workflow('deploy-production');
  const build=job(production,'build-images');
  assert.match(build, /oren-release/);
  assert.doesNotMatch(build, /oren-build\]|type=gha|cache-to:/);
  assert.match(build, /keep-state: true/);
  assert.match(build, /name: oren-api-release/);
  assert.match(build, /name: oren-app-release/);
  assert.match(build, /from=type=local,src=\/home\/oren-ci-release\/cache\/api/);
  assert.match(build, /from=type=local,src=\/home\/oren-ci-release\/cache\/app/);
  assert.match(build, /api_digest: \$\{\{ steps\.api\.outputs\.digest \}\}/);
  assert.match(build, /app_digest: \$\{\{ steps\.app\.outputs\.digest \}\}/);
  assert.match(job(workflow('deploy-docs'),'build'), /oren-release/);
  assert.match(job(production,'deploy'), /Select immutable production images/);
  assert.match(job(production,'deploy'), /\/opt\/oren\/releases\/\$IMAGE_TAG.env/);
  const provision=readFileSync(new URL('./provision.sh',import.meta.url),'utf8');
  assert.doesNotMatch(provision,/Slice=oren-ci-build.slice/);
  assert.match(provision,/oren-ci-admission.service/);
  assert.match(provision,/oren-ci-release/);
  assert.match(provision,/mask=0022/);
  const docker=readFileSync(new URL('../../api/Dockerfile',import.meta.url),'utf8');
  assert.match(docker,/chmod -R a\+rX lib\/db/);
});

test('production images build ahead of the CI gate and only a verified SHA deploys', () => {
  const production = workflow('deploy-production');
  assert.doesNotMatch(job(production, 'build-images'), /\n\s+needs:/);
  const deploy = job(production, 'deploy');
  assert.match(deploy, /needs: \[ci-gate, build-images\]/);
  assert.match(deploy, /needs\['ci-gate'\]\.result == 'success'/);
  assert.match(deploy, /needs\['build-images'\]\.result == 'success'/);
  assert.match(deploy, /workflow_dispatch/);
  assert.match(job(production, 'ci-gate'), /coordinateReleaseGate/);
  assert.match(job(production, 'release'), /needs: \[build-images, deploy\]/);
  for (const name of ['build-api', 'build-app']) {
    assert.match(job(workflow('preview'), name), /needs: \[resolve, ci-gate\]/);
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
