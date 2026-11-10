import test from 'node:test';
import assert from 'node:assert/strict';
import {cancelCompetingPullRequests, coordinateReleaseGate, RELEASE_IMAGE_JOB, releaseBuildsFinished, rerunWorkflows} from './release-lane.mjs';

const repo = {owner: 'owner', repo: 'repo'};
const sha = 'a'.repeat(40);

function actions(overrides = {}) {
  const calls = {list: [], cancel: [], jobs: [], rerun: []};
  const github = {rest: {actions: {
    listWorkflowRuns: async query => {
      calls.list.push(query);
      if (overrides.listError) throw overrides.listError;
      return {data: {workflow_runs: overrides.runs?.[`${query.workflow_id}:${query.status}`] ?? []}};
    },
    cancelWorkflowRun: async ({run_id}) => {
      calls.cancel.push(run_id);
      if (overrides.cancelError) throw overrides.cancelError;
    },
    listJobsForWorkflowRun: async query => {
      calls.jobs.push(query);
      if (overrides.jobsError) throw overrides.jobsError;
      const jobs = typeof overrides.jobs === 'function' ? overrides.jobs() : (overrides.jobs ?? []);
      return {data: {jobs}};
    },
    reRunWorkflow: async ({run_id}) => {
      calls.rerun.push(run_id);
      if (overrides.rerunError) throw overrides.rerunError;
    },
  }}};
  return {calls, github};
}

const pr = (id, workflow, extra = {}) => ({
  id, event: 'pull_request', path: `.github/workflows/${workflow}`, ...extra,
});

test('cancels only active pull-request CI and documentation runs', async () => {
  const master = {id: 1, event: 'push', path: '.github/workflows/ci.yml'};
  const foreign = {id: 2, event: 'pull_request', path: '.github/workflows/preview.yml'};
  const {calls, github} = actions({runs: {
    'ci.yml:in_progress': [pr(10, 'ci.yml'), master, foreign],
    'ci.yml:queued': [pr(11, 'ci.yml')],
    'docs-site.yml:waiting': [pr(12, 'docs-site.yml')],
  }});
  const cancelled = await cancelCompetingPullRequests({github, repo});
  assert.deepEqual([...cancelled].sort(), [10, 11, 12]);
  assert.deepEqual([...calls.cancel].sort(), [10, 11, 12]);
  assert.ok(calls.list.every(query => query.event === 'pull_request'));
});

test('an unsupported status filter does not fail the sweep', async () => {
  const error = Object.assign(Error('bad status'), {status: 422});
  const {calls, github} = actions({
    listError: error,
    runs: {},
  });
  // listError applies to every status; 422 is ignored per status.
  assert.deepEqual(await cancelCompetingPullRequests({github, repo}), []);
  assert.ok(calls.list.length >= 2);
});

test('a finished cancel is ignored and other cancel errors propagate', async () => {
  const gone = Object.assign(Error('gone'), {status: 409});
  const {github} = actions({runs: {'ci.yml:queued': [pr(7, 'ci.yml')]}, cancelError: gone});
  assert.deepEqual(await cancelCompetingPullRequests({github, repo}), []);
  const denied = Object.assign(Error('denied'), {status: 403});
  const failing = actions({runs: {'ci.yml:queued': [pr(8, 'ci.yml')]}, cancelError: denied});
  await assert.rejects(cancelCompetingPullRequests({github: failing.github, repo}), /denied/);
});

test('release build completion follows the image job', async () => {
  const running = actions({jobs: [{name: RELEASE_IMAGE_JOB, status: 'in_progress'}]});
  assert.equal(await releaseBuildsFinished({github: running.github, repo, runId: 5}), false);
  const done = actions({jobs: [{name: RELEASE_IMAGE_JOB, status: 'completed', conclusion: 'failure'}]});
  assert.equal(await releaseBuildsFinished({github: done.github, repo, runId: 5}), true);
  const missing = actions({jobs: [{name: 'Deploy release to VPS', status: 'completed'}]});
  assert.equal(await releaseBuildsFinished({github: missing.github, repo, runId: 5}), false);
});

test('rerun retries then records a permanent failure', async () => {
  const sleeps = [];
  let tries = 0;
  const flaky = actions({});
  flaky.github.rest.actions.reRunWorkflow = async ({run_id}) => {
    tries += 1;
    if (tries < 2) throw Error('not completed yet');
    flaky.calls.rerun.push(run_id);
  };
  assert.deepEqual(await rerunWorkflows({
    github: flaky.github, repo, runIds: [4, 4], sleep: async ms => sleeps.push(ms), attempts: 3,
  }), {rerun: [4], failed: []});
  assert.deepEqual(sleeps, [5000]);

  const broken = actions({rerunError: Error('nope')});
  const result = await rerunWorkflows({
    github: broken.github, repo, runIds: [9], sleep: async () => {}, attempts: 2,
  });
  assert.deepEqual(result.rerun, []);
  assert.equal(result.failed[0].id, 9);
  assert.match(result.failed[0].message, /nope/);
});

test('a push pauses pull request CI until the image job finishes, then requeues it', async () => {
  let builds = 0;
  const notices = [];
  const {calls, github} = actions({
    runs: {'ci.yml:in_progress': [pr(20, 'ci.yml')]},
    jobs: () => [{name: RELEASE_IMAGE_JOB, status: ++builds < 2 ? 'in_progress' : 'completed'}],
  });
  const sleeps = [];
  await coordinateReleaseGate({
    github, repo, sha, runId: 99, eventName: 'push',
    core: {notice: message => notices.push(message), warning() {}},
    sleep: async ms => sleeps.push(ms),
    requireCi: async () => 42,
    guardAttempts: 5,
  });
  assert.deepEqual([...new Set(calls.cancel)], [20]);
  assert.deepEqual(calls.rerun, [20]);
  assert.ok(sleeps.includes(15000));
  assert.match(notices.join('\n'), /42/);
  assert.match(notices.join('\n'), /Requeued pull request CI: 20/);
});

test('a failed master CI still lets images finish and then rejects the gate', async () => {
  const {calls, github} = actions({
    runs: {'ci.yml:queued': [pr(21, 'ci.yml')]},
    jobs: [{name: RELEASE_IMAGE_JOB, status: 'completed', conclusion: 'success'}],
  });
  await assert.rejects(coordinateReleaseGate({
    github, repo, sha, runId: 100, eventName: 'push',
    core: {notice() {}, warning() {}},
    sleep: async () => {},
    requireCi: async () => { throw Error('Master CI 7: failure'); },
    guardAttempts: 2,
  }), /Master CI 7/);
  assert.deepEqual(calls.cancel, [21]);
  assert.deepEqual(calls.rerun, [21]);
});

test('a rollback verifies CI and does not cancel pull requests', async () => {
  const {github} = actions({});
  github.rest.actions.listWorkflowRuns = async () => { throw Error('should not list pull requests'); };
  const notices = [];
  await coordinateReleaseGate({
    github, repo, sha, runId: 101, eventName: 'workflow_dispatch',
    core: {notice: message => notices.push(message), warning() {}},
    sleep: async () => { throw Error('should not wait'); },
    requireCi: async ({sha: given}) => {
      assert.equal(given, sha);
      return 8;
    },
  });
  assert.match(notices.join('\n'), /Production CI verified: 8/);
});
