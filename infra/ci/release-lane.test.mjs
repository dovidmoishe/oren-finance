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
      if (query.branch) return {data: {workflow_runs: overrides.recent ?? []}};
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
    getWorkflowRun: async ({run_id}) => ({data: pr(run_id, 'ci.yml', {
      status: 'completed', conclusion: 'cancelled', ...overrides.run,
    })}),
    reRunWorkflow: async ({run_id}) => {
      calls.rerun.push(run_id);
      if (overrides.rerunError) throw overrides.rerunError;
    },
  }, pulls: {
    list: async () => ({data: overrides.pulls ?? [{head: {repo: {id: 123}, sha}}]}),
  }}};
  return {calls, github};
}

const pr = (id, workflow, extra = {}) => ({
  id, event: 'pull_request', path: `.github/workflows/${workflow}`, ...extra,
  head_branch: 'feature', head_sha: sha, head_repository: {id: 123, owner: {login: 'owner'}},
  run_number: id,
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

test('caps cancellation requests even when the listed runs have already finished', async () => {
  const {calls, github} = actions({
    runs: {'ci.yml:queued': Array.from({length: 50}, (_, id) => pr(id + 1, 'ci.yml'))},
    cancelError: Object.assign(Error('finished'), {status: 409}),
  });
  assert.deepEqual(await cancelCompetingPullRequests({github, repo}), []);
  assert.equal(calls.cancel.length, 30);
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

test('only reruns a cancelled workflow for the current open PR head and latest run', async () => {
  for (const overrides of [
    {pulls: []},
    {pulls: [{head: {repo: {id: 123}, sha: 'b'.repeat(40)}}]},
    {recent: [pr(10, 'ci.yml')]},
    {run: {conclusion: 'success'}},
  ]) {
    const {calls, github} = actions(overrides);
    assert.deepEqual(await rerunWorkflows({github, repo, runIds: [9]}), {rerun: [], failed: []});
    assert.deepEqual(calls.rerun, []);
  }
});

test('rechecks the PR head when retrying a rejected rerun', async () => {
  const overrides = {rerunError: Error('not ready')};
  const {calls, github} = actions(overrides);
  const result = await rerunWorkflows({
    github, repo, runIds: [9],
    sleep: async () => { overrides.pulls = [{head: {repo: {id: 123}, sha: 'b'.repeat(40)}}]; },
  });
  assert.deepEqual(result, {rerun: [], failed: []});
  assert.deepEqual(calls.rerun, [9]);
});

test('scans once per two minutes across CI and image polling', async () => {
  const {calls, github} = actions({});
  let elapsed = 0;
  let polls = 0;
  github.rest.actions.listJobsForWorkflowRun = async () => ({
    data: {jobs: [{name: RELEASE_IMAGE_JOB, status: ++polls === 9 ? 'completed' : 'in_progress'}]},
  });
  await coordinateReleaseGate({
    github, repo, sha, runId: 99, eventName: 'push', core: {notice() {}, warning() {}},
    now: () => elapsed, sleep: async ms => { elapsed += ms; },
    requireCi: async ({sleep}) => {
      for (let i = 0; i < 8; i++) await sleep(15_000);
      return 42;
    },
  });
  assert.equal(calls.list.length, 20);
  assert.equal(elapsed, 240_000);
});

test('waits for GitHub rate limits before retrying the master CI request', async () => {
  for (const [headers, expected] of [
    [{'retry-after': '2'}, 2000],
    [{'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '3'}, 4000],
  ]) {
    const {github} = actions({});
    let elapsed = 0;
    let requests = 0;
    await coordinateReleaseGate({
      github, repo, sha, runId: 99, eventName: 'workflow_dispatch', core: {notice() {}, warning() {}},
      now: () => elapsed, sleep: async ms => { elapsed += ms; },
      requireCi: ({request}) => request(async () => {
        if (++requests === 1) throw Object.assign(Error('API rate limit'), {status: 403, response: {headers}});
        return 42;
      }),
    });
    assert.equal(requests, 2);
    assert.equal(elapsed, expected);
  }
});

test('preserves successfully paused runs when a later scan request fails', async () => {
  const {calls, github} = actions({
    runs: {'ci.yml:queued': [pr(9, 'ci.yml')]},
    jobs: [{name: RELEASE_IMAGE_JOB, status: 'completed'}],
  });
  const list = github.rest.actions.listWorkflowRuns;
  github.rest.actions.listWorkflowRuns = async query => {
    if (query.status === 'in_progress') throw Error('list unavailable');
    return list(query);
  };
  await coordinateReleaseGate({
    github, repo, sha, runId: 99, eventName: 'push', core: {notice() {}, warning() {}},
    requireCi: async () => 42,
  });
  assert.deepEqual(calls.rerun, [9]);
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
