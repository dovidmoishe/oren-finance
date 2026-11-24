import test from 'node:test';
import assert from 'node:assert/strict';
import {requirePreviewCi, waitForPreviewCi} from './preview-ci.mjs';

const sha = 'a'.repeat(40);
const repo = {owner: 'owner', repo: 'repo'};
const good = {id: 10, head_sha: sha, head_branch: 'feature', event: 'pull_request',
  path: '.github/workflows/ci.yml', repository: {full_name: 'owner/repo'},
  head_repository: {full_name: 'owner/repo'}, status: 'completed', conclusion: 'success'};
const current = {state: 'open', base: {ref: 'master'}, head: {sha, ref: 'feature', repo: {full_name: 'owner/repo'}}, user: {type: 'User', login: 'author'}};
function fixture(frames = [{runs: [good]}]) {
  let index = 0;
  const queries = [], sleeps = [];
  const github = {rest: {
    pulls: {get: async () => ({data: frames[index].pr ?? current})},
    repos: {getCollaboratorPermissionLevel: async () => ({data: {permission: frames[index].permission ?? 'write'}})},
    actions: {listWorkflowRuns: async q => {queries.push(q); return {data: {workflow_runs: frames[index].runs ?? []}};}},
  }};
  return {queries, sleeps, args: {github, repo, sha, pr: 42, attempts: frames.length,
    sleep: async ms => {sleeps.push(ms); index++;}}};
}
test('waitForPreviewCi returns once the newest exact-head run succeeds', async () => {
  const f = fixture([{runs: []}, {runs: [{...good, status: 'in_progress', conclusion: null}]}, {runs: [good]}]);
  assert.equal(await waitForPreviewCi(f.args), 10);
  assert.deepEqual(f.sleeps, [15000, 15000]);
  assert.ok(f.queries.every(q => q.head_sha === sha && q.event === 'pull_request' && q.workflow_id === 'ci.yml' && q.branch === 'feature'));
});
test('activation recheck rejects missing or pending CI without waiting', async () => {
  for (const runs of [[], [{...good, status: 'queued', conclusion: null}], [{...good, status: 'in_progress', conclusion: null}]]) {
    const f = fixture([{runs}]);
    await assert.rejects(requirePreviewCi(f.args), /Successful CI required/);
    assert.deepEqual(f.sleeps, []);
  }
  assert.equal(await requirePreviewCi(fixture().args), 10);
});
test('wrong SHA, event, branch, workflow, repository and fork never authorize activation', async () => {
  for (const patch of [{head_sha: 'b'.repeat(40)}, {event: 'push'}, {head_branch: 'other'},
    {path: '.github/workflows/other.yml'}, {repository: {full_name: 'other/repo'}}, {head_repository: {full_name: 'fork/repo'}}]) {
    await assert.rejects(waitForPreviewCi(fixture([{runs: [{...good, ...patch}]}]).args), /Timed out/);
  }
});
test('unsuccessful CI conclusions fail closed, even with an older successful run', async () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'skipped', 'neutral', 'action_required', null]) {
    await assert.rejects(waitForPreviewCi(fixture([{runs: [good, {...good, id: 11, conclusion}]}]).args), /Preview CI 11/);
  }
});
test('a newer pending run overrides previous success and a later rerun can recover', async () => {
  const pending = {...good, id: 11, status: 'in_progress', conclusion: null};
  const f = fixture([{runs: [good, pending]}, {runs: [good, {...pending, status: 'completed', conclusion: 'success'}]}]);
  assert.equal(await waitForPreviewCi(f.args), 11);
  await assert.rejects(requirePreviewCi(fixture([{runs: [good, pending]}]).args), /Successful CI required/);
});
test('closed, superseded, wrong-base, fork and bot PRs cannot activate', async () => {
  for (const patch of [{state: 'closed'}, {base: {ref: 'other'}}, {head: {...current.head, sha: 'b'.repeat(40)}},
    {head: {...current.head, repo: {full_name: 'fork/repo'}}}, {user: {type: 'Bot', login: 'bot'}}]) {
    const f = fixture([{pr: {...current, ...patch}, runs: [good]}]);
    await assert.rejects(waitForPreviewCi(f.args), /closed, superseded or untrusted/);
    assert.equal(f.queries.length, 0);
  }
});
test('new commits and permission revocation stop the wait before activation', async () => {
  const pending = {runs: [{...good, status: 'in_progress'}]};
  const f = fixture([pending, {pr: {...current, head: {...current.head, sha: 'b'.repeat(40)}}, runs: [good]}]);
  await assert.rejects(waitForPreviewCi(f.args), /superseded/);
  assert.equal(f.queries.length, 1);
  for (const permission of ['read', 'triage', 'none']) {
    await assert.rejects(requirePreviewCi(fixture([{permission, runs: [good]}]).args), /current repository collaborator/);
  }
});
test('malformed input, API failures and exhausted waits never succeed', async () => {
  for (const patch of [{sha: 'master'}, {pr: 0}, {pr: 1.5}, {attempts: 0}]) {
    await assert.rejects(waitForPreviewCi({...fixture().args, ...patch}));
  }
  const f = fixture();
  f.args.github.rest.actions.listWorkflowRuns = async () => {throw Error('GitHub unavailable');};
  await assert.rejects(requirePreviewCi(f.args), /GitHub unavailable/);
  await assert.rejects(waitForPreviewCi(fixture([{runs: []}]).args), /Timed out/);
});
