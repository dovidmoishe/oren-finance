import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const workflow = name => readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const job = (text, name) => text.split(`\n  ${name}:\n`)[1]?.split(/\n  [a-z][a-z0-9-]*:\n/)[0];

test('all workflows run on GitHub-hosted Ubuntu', () => {
  for (const file of readdirSync(new URL('../../.github/workflows/', import.meta.url))) {
    if (!file.endsWith('.yml')) continue;
    const source = workflow(file.slice(0, -4));
    const runners = [...source.matchAll(/^\s+runs-on: (.+)$/gm)].map(m => m[1]);
    assert.ok(runners.length, file);
    assert.ok(runners.every(runner => runner === 'ubuntu-24.04'), file);
    const actions = [...source.matchAll(/^\s*(?:- )?uses:\s+(\S+)/gm)];
    assert.ok(actions.every(([, action]) => /@[a-f0-9]{40}$/.test(action)), file);
  }
});

test('fork PR CI runs with read-only permissions and keeps the required check names', () => {
  const ci = workflow('ci');
  for (const name of ['preview-infra', 'api', 'app-check']) {
    assert.doesNotMatch(job(ci, name), /head\.repo/);
    assert.match(job(ci, name), /persist-credentials: false/);
  }
  assert.doesNotMatch(job(workflow('docs-site'), 'docs'), /head\.repo/);
  assert.match(ci, /permissions:\n  contents: read/);
  assert.match(job(ci, 'app-check'), /node scripts\/lint-bounded\.mjs/);
  assert.match(job(ci, 'app-check'), /check: \[test, lint, build\]/);
  assert.match(job(ci, 'app-check'), /name: App \$\{\{ matrix\.check \}\}/);
  assert.doesNotMatch(ci, /App test, lint, and build/);
  assert.doesNotMatch(ci, /\bsudo\b|install -d \/opt\/oren|5432:5432|--network host/);
  assert.match(ci, /job.services.postgres.ports\['5432'\]/);
  assert.match(ci, /job.services.postgres.id/);
  assert.match(ci, /chmod -R go-rwx lib\/db/);
  assert.match(ci, /runtime-readable.mjs/);
});

test('production publishers use release cache scopes and immutable image pins', () => {
  const production=workflow('deploy-production');
  const build=job(production,'build-images');
  assert.match(build, /cache-from: type=gha,scope=oren-api-release/);
  assert.match(build, /cache-from: type=gha,scope=oren-app-release/);
  assert.doesNotMatch(build, /keep-state|\/home\/oren-ci-release/);
  assert.match(build, /api_digest: \$\{\{ steps\.api\.outputs\.digest \}\}/);
  assert.match(build, /app_digest: \$\{\{ steps\.app\.outputs\.digest \}\}/);
  assert.match(job(workflow('deploy-docs'), 'build'), /cache-from: type=gha,scope=oren-docs-release/);
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
  assert.match(job(production, 'ci-gate'), /requireProductionCi/);
  assert.match(job(production, 'release'), /needs: \[build-images, deploy\]/);
  const preview = workflow('preview');
  for (const name of ['build-api', 'build-app']) {
    assert.match(job(preview, name), /needs: \[resolve\]/);
    assert.doesNotMatch(job(preview, name), /ci-gate/);
  }
  assert.match(preview, /types: \[completed\]/);
  assert.match(preview, /branches-ignore: \[master\]/);
  assert.doesNotMatch(preview, /types: \[in_progress\]|waitForPreviewCi|ci-gate/);
  assert.match(preview, /workflow_run\.conclusion == 'success'/);
  assert.doesNotMatch(preview.split('\njobs:\n')[0], /^concurrency:/m);
  assert.doesNotMatch(preview, /group: production-deploy|pr-preview-/);
  const admitted = job(preview, 'resolve');
  assert.doesNotMatch(admitted, /concurrency:/);
  assert.match(admitted, /workflow_run\.head_repository\.full_name == github\.repository/);
  assert.match(admitted, /workflow_run\.conclusion == 'success'/);
  assert.match(admitted, /requirePreviewCi/);
  assert.match(admitted, /pr\.head\.repo\?\.full_name !== context\.payload\.repository\.full_name/);
  assert.match(admitted, /listPullRequestsAssociatedWithCommit/);
  const previewDeploy = job(preview, 'deploy');
  assert.match(previewDeploy, /needs\['build-api'\]\.result == 'success'/);
  assert.match(previewDeploy, /needs\['build-app'\]\.result == 'success'/);
  assert.match(previewDeploy, /cancel-in-progress: false/);
  assert.doesNotMatch(previewDeploy, /cancel-in-progress: true/);
  assert.match(previewDeploy, /JOB_STATUS === 'cancelled'/);
  assert.match(previewDeploy, /Preview cancelled; redeploy/);
  assert.match(previewDeploy, /if \(current && ownsStatus\)/);
  assert.match(previewDeploy, /requirePreviewCi/);
  assert.match(previewDeploy, /not deploying this preview/);
  assert.doesNotMatch(job(production, 'ci-gate'), /actions: write|coordinateReleaseGate/);
  assert.match(job(workflow('preview-maintenance'), 'maintain'), /pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(workflow('preview-setup'), /'App test','App lint','App build'/);
  assert.doesNotMatch(workflow('preview-setup'), /App test, lint, and build/);
});

test('test fixtures override paths while deployed preview defaults remain intact', () => {
  const compose = readFileSync(new URL('../preview/compose.yml', import.meta.url), 'utf8');
  assert.match(compose, /PREVIEW_PROVIDER_ENV:-\/opt\/oren\/preview\/provider.env/);
  assert.match(compose, /PREVIEW_OAUTH_ENV:-\/opt\/oren\/preview\/stacks\/pr-/);
  const isolation = readFileSync(new URL('../preview/isolation.sh', import.meta.url), 'utf8');
  assert.match(isolation, /GITHUB_RUN_ID/);
  assert.match(isolation, /oren-ci-preview-\$\{ID,,\}-a/);
});
