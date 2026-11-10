import {requireProductionCi} from '../preview/production-ci.mjs';

export const RELEASE_IMAGE_JOB = 'Build and publish release images';

// These pull-request workflows take a heavy build account. A master release
// pauses them so they do not sit on the two heavy slots while images build.
const HEAVY_PR_WORKFLOWS = ['ci.yml', 'docs-site.yml'];
const ACTIVE = ['queued', 'in_progress', 'waiting', 'pending', 'requested'];

export async function cancelCompetingPullRequests({github, repo}) {
  const cancelled = [];
  const seen = new Set();
  for (const workflowId of HEAVY_PR_WORKFLOWS) {
    for (const status of ACTIVE) {
      for (let page = 1; page <= 5; page++) {
        let data;
        try {
          ({data} = await github.rest.actions.listWorkflowRuns({
            ...repo, workflow_id: workflowId, event: 'pull_request', status, per_page: 100, page,
          }));
        } catch (error) {
          if (error.status === 422 || error.status === 404) break;
          throw error;
        }
        const runs = data.workflow_runs ?? [];
        for (const run of runs) {
          if (run.event !== 'pull_request' || seen.has(run.id)) continue;
          const path = run.path ?? '';
          if (path !== `.github/workflows/${workflowId}`) continue;
          seen.add(run.id);
          try {
            await github.rest.actions.cancelWorkflowRun({...repo, run_id: run.id});
            cancelled.push(run.id);
          } catch (error) {
            if (error.status !== 409 && error.status !== 404) throw error;
          }
        }
        if (runs.length < 100) break;
      }
    }
  }
  return cancelled;
}

export async function releaseBuildsFinished({github, repo, runId}) {
  const {data} = await github.rest.actions.listJobsForWorkflowRun({
    ...repo, run_id: runId, per_page: 100,
  });
  const build = (data.jobs ?? []).find(job => job.name === RELEASE_IMAGE_JOB);
  return build?.status === 'completed';
}

export async function rerunWorkflows({github, repo, runIds, sleep = async () => {}, attempts = 6}) {
  let pending = [...new Set(runIds)];
  const rerun = [];
  const failed = [];
  for (let attempt = 0; attempt < attempts && pending.length > 0; attempt++) {
    const still = [];
    for (const id of pending) {
      try {
        await github.rest.actions.reRunWorkflow({...repo, run_id: id});
        rerun.push(id);
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
  requireCi = requireProductionCi,
  guardAttempts = 120,
}) {
  const push = eventName === 'push';
  const cancelled = new Set();
  const preempt = async () => {
    if (!push) return;
    try {
      for (const id of await cancelCompetingPullRequests({github, repo})) cancelled.add(id);
    } catch (error) {
      core.warning(`Could not cancel competing pull request CI: ${error.message}`);
    }
  };
  await preempt();
  let ciError;
  try {
    const id = await requireCi({
      github, repo, sha,
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
        finished = await releaseBuildsFinished({github, repo, runId});
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
      const {rerun, failed} = await rerunWorkflows({github, repo, runIds: [...cancelled], sleep});
      if (rerun.length) core.notice(`Requeued pull request CI: ${rerun.join(', ')}`);
      for (const item of failed) core.warning(`Could not rerun ${item.id}: ${item.message}`);
    } catch (error) {
      core.warning(`Could not rerun pull request CI: ${error.message}`);
    }
  }
  if (ciError) throw ciError;
}
