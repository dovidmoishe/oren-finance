import {requireProductionCi} from '../preview/production-ci.mjs';

export const RELEASE_IMAGE_JOB = 'Build and publish release images';

// These pull-request workflows take a heavy build account. A master release
// pauses them so they do not sit on the two heavy slots while images build.
const HEAVY_PR_WORKFLOWS = ['ci.yml', 'docs-site.yml'];
const ACTIVE = ['queued', 'in_progress', 'waiting', 'pending', 'requested'];
const SWEEP_INTERVAL_MS = 120_000;
const MAX_CANCELLATION_ATTEMPTS = 30;
const MAX_RATE_LIMIT_WAIT_MS = 240_000;
const direct = operation => operation();

function rateLimitedRequests({sleep, now}) {
  let remainingWait = MAX_RATE_LIMIT_WAIT_MS;
  let blockedUntil = 0;
  let lastError;
  return async operation => {
    for (;;) {
      const delay = blockedUntil - now();
      if (delay > 0) {
        if (delay > remainingWait) throw lastError;
        remainingWait -= delay;
        await sleep(delay);
      }
      try {
        return await operation();
      } catch (error) {
        const headers = error.response?.headers ?? {};
        const primaryLimit = String(headers['x-ratelimit-remaining']) === '0';
        const retryAfter = Number(headers['retry-after']);
        if (error.status !== 429 && !(error.status === 403 &&
            (primaryLimit || retryAfter > 0 || /secondary rate limit/i.test(error.message)))) throw error;
        const reset = Number(headers['x-ratelimit-reset']) * 1000;
        const delay = retryAfter > 0 ? retryAfter * 1000 :
          primaryLimit && reset > now() ? reset - now() + 1000 : 60_000;
        blockedUntil = now() + delay;
        lastError = error;
      }
    }
  };
}

export async function cancelCompetingPullRequests({
  github, repo, cancelled = new Set(), attempted = new Set(), request = direct,
}) {
  for (const workflowId of HEAVY_PR_WORKFLOWS) {
    for (const status of ACTIVE) {
      if (attempted.size >= MAX_CANCELLATION_ATTEMPTS) return [...cancelled];
      let data;
      try {
        ({data} = await request(() => github.rest.actions.listWorkflowRuns({
          ...repo, workflow_id: workflowId, event: 'pull_request', status, per_page: 100,
        })));
      } catch (error) {
        if (error.status === 422 || error.status === 404) continue;
        throw error;
      }
      for (const run of data.workflow_runs ?? []) {
        if (run.event !== 'pull_request' || attempted.has(run.id) ||
            run.path !== `.github/workflows/${workflowId}`) continue;
        attempted.add(run.id);
        try {
          await request(() => github.rest.actions.cancelWorkflowRun({...repo, run_id: run.id}));
          cancelled.add(run.id);
        } catch (error) {
          if (error.status !== 409 && error.status !== 404) throw error;
        }
        if (attempted.size >= MAX_CANCELLATION_ATTEMPTS) return [...cancelled];
      }
    }
  }
  return [...cancelled];
}

export async function releaseBuildsFinished({github, repo, runId, request = direct}) {
  const {data} = await request(() => github.rest.actions.listJobsForWorkflowRun({
    ...repo, run_id: runId, per_page: 100,
  }));
  const build = (data.jobs ?? []).find(job => job.name === RELEASE_IMAGE_JOB);
  return build?.status === 'completed';
}

async function rerunCurrentPullRequest({github, repo, id}) {
  const {data: run} = await github.rest.actions.getWorkflowRun({...repo, run_id: id});
  const workflowId = HEAVY_PR_WORKFLOWS.find(name => run.path === `.github/workflows/${name}`);
  const head = run.head_repository;
  if (run.event !== 'pull_request' || !workflowId || !head?.id ||
      !head.owner?.login || !run.head_branch || !run.head_sha) return false;
  if (run.status !== 'completed') throw Error('Cancellation is still in progress');
  if (run.conclusion !== 'cancelled') return false;
  const {data: {workflow_runs: recent}} = await github.rest.actions.listWorkflowRuns({
    ...repo, workflow_id: workflowId, event: 'pull_request', branch: run.head_branch, per_page: 100,
  });
  if (recent.some(candidate => candidate.head_repository?.id === head.id &&
      candidate.run_number > run.run_number)) return false;
  const {data: pulls} = await github.rest.pulls.list({
    ...repo, state: 'open', base: 'master', head: `${head.owner.login}:${run.head_branch}`,
  });
  if (!pulls.some(pr => pr.head.repo?.id === head.id && pr.head.sha === run.head_sha)) return false;
  await github.rest.actions.reRunWorkflow({...repo, run_id: id});
  return true;
}

export async function rerunWorkflows({
  github, repo, runIds, sleep = async () => {}, attempts = 6, request = direct,
}) {
  let pending = [...new Set(runIds)];
  const rerun = [];
  const failed = [];
  for (let attempt = 0; attempt < attempts && pending.length > 0; attempt++) {
    const still = [];
    for (const id of pending) {
      try {
        if (await request(() => rerunCurrentPullRequest({github, repo, id}))) rerun.push(id);
      } catch (error) {
        still.push({id, message: error.message ?? String(error)});
      }
    }
    if (attempt + 1 === attempts) {
      failed.push(...still);
      break;
    }
    pending = still.map(item => item.id);
    if (pending.length) await sleep(5000);
  }
  return {rerun, failed};
}

// Push releases build images immediately. This waits for master CI, and while
// that SHA's images are still building it keeps pull-request heavy jobs off
// the two build accounts. A rollback does not build and does not cancel PRs.
export async function coordinateReleaseGate({
  github, repo, core, sha, runId, eventName,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now,
  requireCi = requireProductionCi,
  guardAttempts = 120,
}) {
  const push = eventName === 'push';
  const cancelled = new Set();
  const attempted = new Set();
  const request = rateLimitedRequests({sleep, now});
  let nextSweep = 0;
  const preempt = async () => {
    if (!push || now() < nextSweep) return;
    nextSweep = now() + SWEEP_INTERVAL_MS;
    try {
      await cancelCompetingPullRequests({github, repo, cancelled, attempted, request});
    } catch (error) {
      core.warning(`Could not cancel competing pull request CI: ${error.message}`);
    }
  };
  await preempt();
  let ciError;
  try {
    const id = await requireCi({
      github, repo, sha, request,
      sleep: async ms => { await preempt(); await sleep(ms); },
    });
    core.notice(`Production CI verified: ${id} for ${sha}`);
  } catch (error) {
    ciError = error;
  }
  if (push) {
    for (let attempt = 0; attempt < guardAttempts; attempt++) {
      let finished = false;
      try {
        finished = await releaseBuildsFinished({github, repo, runId, request});
      } catch (error) {
        core.warning(`Could not read release build status: ${error.message}`);
        break;
      }
      if (finished) break;
      await preempt();
      await sleep(15000);
    }
    if (cancelled.size) core.notice(`Paused ${cancelled.size} pull request run(s) while release images built.`);
    try {
      const {rerun, failed} = await rerunWorkflows({github, repo, runIds: [...cancelled], sleep, request});
      if (rerun.length) core.notice(`Requeued pull request CI: ${rerun.join(', ')}`);
      for (const item of failed) core.warning(`Could not rerun ${item.id}: ${item.message}`);
    } catch (error) {
      core.warning(`Could not rerun pull request CI: ${error.message}`);
    }
  }
  if (ciError) throw ciError;
}
