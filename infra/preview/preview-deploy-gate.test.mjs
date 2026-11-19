import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow = readFileSync(new URL('../../.github/workflows/preview.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const block = workflow.split('      - id: deployment\n')[1];
const marker = '          script: |\n';
const lines = [];
for (const line of block.slice(block.indexOf(marker) + marker.length).split('\n')) {
  if (!line.startsWith('            ')) break;
  lines.push(line.slice(12));
}
const admit = new (Object.getPrototypeOf(async function () {}).constructor)('github', 'context', 'process', 'core', lines.join('\n'));
const sha = 'a'.repeat(40);

function fixture(head = sha, state = 'open') {
  const deployments = [];
  const notices = [];
  const outputs = {};
  const github = {rest: {pulls: {get: async () => ({data: {state, head: {sha: head}}})}, repos: {
    createDeployment: async body => { deployments.push(body); return {data: {id: 100}}; },
    createDeploymentStatus: async body => deployments.push(body),
  }}};
  const core = {notice: message => notices.push(message), setOutput: (key, value) => { outputs[key] = value; }};
  const context = {repo: {owner: 'owner', repo: 'repo'}};
  const process = {env: {PR: '42', SHA: sha}};
  return {run: () => admit(github, context, process, core), deployments, notices, outputs};
}

test('a closed or superseded head does not create a deployment', async () => {
  for (const args of [['b'.repeat(40)], [sha, 'closed']]) {
    const f = fixture(...args);
    await f.run();
    assert.equal(f.outputs.current, 'false');
    assert.equal(f.deployments.length, 0);
    assert.match(f.notices[0], /not deploying/);
  }
});

test('the current open head records an in-progress preview deployment', async () => {
  const f = fixture();
  await f.run();
  assert.equal(f.outputs.current, 'true');
  assert.equal(f.outputs.id, 100);
  assert.equal(f.deployments[0].ref, sha);
  assert.equal(f.deployments[0].environment, 'preview-pr-42');
  assert.equal(f.deployments[0].production_environment, false);
  assert.equal(f.deployments[1].state, 'in_progress');
});
