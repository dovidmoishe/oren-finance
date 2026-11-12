// Images may build speculatively. Only this exact master push can authorize deploy.
export async function requireProductionCi({
  github, repo, sha, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  attempts = 120, request = operation => operation(),
}) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw Error('Invalid production SHA');
  const fullName = `${repo.owner}/${repo.repo}`;
  let consecutiveApiFailures = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let data;
    try {
      ({data} = await request(() => github.rest.actions.listWorkflowRuns({...repo,
        workflow_id: 'ci.yml', head_sha: sha, branch: 'master', event: 'push', per_page: 100})));
    } catch (error) {
      // Octokit reports transport failures such as "fetch failed" as HTTP 500.
      consecutiveApiFailures++;
      if (![500, 502, 503, 504].includes(error?.status) ||
          consecutiveApiFailures >= 4 || attempt + 1 === attempts) throw error;
      await sleep(15000);
      continue;
    }
    consecutiveApiFailures = 0;
    const run = data.workflow_runs.filter(run => run.head_sha === sha &&
      run.event === 'push' && run.head_branch === 'master' &&
      run.repository?.full_name === fullName && run.head_repository?.full_name === fullName &&
      run.path === '.github/workflows/ci.yml')
      .sort((a, b) => b.id - a.id)[0];
    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') throw Error(`Master CI ${run.id}: ${run.conclusion}`);
      return run.id;
    }
    if (attempt + 1 < attempts) await sleep(15000);
  }
  throw Error(`Timed out waiting for successful master CI for ${sha}`);
}
