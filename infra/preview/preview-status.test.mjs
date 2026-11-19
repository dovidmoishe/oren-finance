import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Exercise the actual github-script body used by the workflow, including the
// older-attempt/newer-attempt race introduced by cancellable image jobs.
const workflow = readFileSync(new URL('../../.github/workflows/preview.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const block = workflow.split('      - name: Publish final status\n')[1];
const marker = '          script: |\n';
const source = block.slice(block.indexOf(marker) + marker.length).split('\n').map(line => line.replace(/^ {12}/, '')).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const publish = new AsyncFunction('github', 'context', 'process', source);
const sha = 'a'.repeat(40);
const runUrl = 'https://github.com/owner/repo/actions/runs/10';

function fixture({statuses = [{id: 1, context: 'Preview ready', state: 'pending', target_url: runUrl}], head = sha, jobStatus = 'success'} = {}) {
  const commitStatuses = [], deployments = [];
  const github = {request: async (route, args) => {
    assert.equal(route, 'GET /repos/{owner}/{repo}/commits/{ref}/statuses');
    assert.equal(args.ref, sha);
    return {data: statuses};
  }, rest: {pulls: {get: async () => ({data: {state: 'open', head: {sha: head}}})}, repos: {
    createDeploymentStatus: async s => deployments.push(s),
    createCommitStatus: async s => commitStatuses.push(s),
  }}};
  const context = {repo: {owner: 'owner', repo: 'repo'}, serverUrl: 'https://github.com', runId: 10};
  const process = {env: {PR: '42', SHA: sha, JOB_STATUS: jobStatus, DEPLOYMENT_ID: '100', PREVIEW_DOMAIN: 'preview.example.com', API_DIGEST: 'sha256:' + 'b'.repeat(64)}};
  return {run: () => publish(github, context, process), commitStatuses, deployments};
}
test('own successful attempt publishes healthy status and digest evidence', async () => {
  const f = fixture(); await f.run();
  assert.equal(f.commitStatuses.length, 1);
  assert.equal(f.commitStatuses[0].state, 'success');
  assert.equal(f.commitStatuses[0].target_url, 'https://pr-42.preview.example.com');
  assert.match(f.commitStatuses[0].description, /financial execution disabled/);
  assert.equal(f.deployments[0].state, 'success');
  assert.match(f.deployments[0].description, /^api sha256:/);
});
test('older failed/cancelled image attempt cannot overwrite a newer pending or healthy attempt', async () => {
  for (const latest of [{id: 2, state: 'pending', target_url: runUrl.replace('/10', '/11')},
    {id: 2, state: 'success', target_url: 'https://pr-42.preview.example.com'}]) {
    const f = fixture({jobStatus: 'failure', statuses: [
      {id: 1, context: 'Preview ready', target_url: runUrl}, {...latest, context: 'Preview ready'},
    ]});
    await f.run();
    assert.equal(f.commitStatuses.length, 0);
    assert.equal(f.deployments[0].state, 'inactive');
  }
});
test('a failed activation reports failure only for its own current attempt', async () => {
  const f = fixture({jobStatus: 'failure'}); await f.run();
  assert.equal(f.commitStatuses[0].state, 'failure');
  assert.equal(f.commitStatuses[0].target_url, runUrl);
  assert.equal(f.deployments[0].state, 'failure');
});
test('rerunning a failed deployment job can recover its own failure status', async () => {
  const f = fixture({statuses: [{id: 3, context: 'Preview ready', state: 'failure', target_url: runUrl}]});
  await f.run();
  assert.equal(f.commitStatuses[0].state, 'success');
});
test('a superseded head never publishes readiness for its replacement', async () => {
  const f = fixture({head: 'c'.repeat(40)}); await f.run();
  assert.equal(f.commitStatuses.length, 0);
  assert.equal(f.deployments[0].state, 'inactive');
});
test('a cancelled run does not mark the current head as a failed preview', async () => {
  const f = fixture({jobStatus: 'cancelled'}); await f.run();
  assert.equal(f.commitStatuses.length, 0);
  assert.equal(f.deployments[0].state, 'inactive');
});
