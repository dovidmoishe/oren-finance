import test from 'node:test';
import assert from 'node:assert/strict';
import {requireProductionCi} from './production-ci.mjs';

const sha = 'a'.repeat(40);
const repo = {owner: 'owner', repo: 'repo'};
const good = {id: 10, head_sha: sha, event: 'push', head_branch: 'master',
  repository: {full_name: 'owner/repo'}, head_repository: {full_name: 'owner/repo'},
  path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success'};
function fixture(pages) {
  const queries = [], sleeps = [];
  return {queries, sleeps, args: {repo, sha, attempts: pages.length,
    sleep: async ms => sleeps.push(ms),
    github: {rest: {actions: {listWorkflowRuns: async query => {
      queries.push(query); return {data: {workflow_runs: pages.shift()}};
    }}}}}};
}
test('waits for exact master CI while images build independently', async () => {
  const f = fixture([[], [{...good, status: 'in_progress', conclusion: null}], [good]]);
  assert.equal(await requireProductionCi(f.args), 10);
  assert.deepEqual(f.sleeps, [15000, 15000]);
  assert.ok(f.queries.every(q => q.head_sha === sha && q.workflow_id === 'ci.yml' && q.event === 'push' && q.branch === 'master'));
});
test('wrong SHA, PR, branch, repository, fork and workflow cannot authorize deploy', async () => {
  for (const patch of [{head_sha: 'b'.repeat(40)}, {event: 'pull_request'}, {head_branch: 'feature'},
    {repository: {full_name: 'other/repo'}}, {head_repository: {full_name: 'fork/repo'}}, {path: '.github/workflows/other.yml'}]) {
    await assert.rejects(requireProductionCi(fixture([[{...good, ...patch}]]).args), /Timed out/);
  }
});
test('all unsuccessful conclusions block deployment', async () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'skipped', 'neutral', 'action_required', null]) {
    await assert.rejects(requireProductionCi(fixture([[{...good, conclusion}]]).args), /Master CI/);
  }
});
test('newest run controls authorization, including a pending or failed rerun', async () => {
  await assert.rejects(requireProductionCi(fixture([[good, {...good, id: 11, conclusion: 'failure'}]]).args), /Master CI 11/);
  await assert.rejects(requireProductionCi(fixture([[good, {...good, id: 11, status: 'queued', conclusion: null}]]).args), /Timed out/);
});
test('invalid SHA and API errors fail closed', async () => {
  const f = fixture([[good]]);
  await assert.rejects(requireProductionCi({...f.args, sha: 'master'}), /Invalid/);
  assert.equal(f.queries.length, 0);
  f.args.github.rest.actions.listWorkflowRuns = async () => {throw Error('unavailable');};
  await assert.rejects(requireProductionCi(f.args), /unavailable/);
});
