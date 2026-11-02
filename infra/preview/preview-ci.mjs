// Only trusted default-branch workflows call this gate. PR code never decides
// whether it is authorized to activate a preview.
function validate({sha, pr}) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '') || !Number.isSafeInteger(pr) || pr < 1) {
    throw Error('Preview requires a full SHA and positive PR number');
  }
}

async function inspectPreviewCi({github, repo, sha, pr}) {
  validate({sha, pr});
  const fullName = `${repo.owner}/${repo.repo}`;
  const {data: current} = await github.rest.pulls.get({...repo, pull_number: pr});
  if (current.state !== 'open' || current.base?.ref !== 'master' || current.head?.sha !== sha ||
      current.head?.repo?.full_name !== fullName || current.user?.type !== 'User') {
    throw Error('Preview PR closed, superseded or untrusted');
  }
  const {data: permission} = await github.rest.repos.getCollaboratorPermissionLevel({...repo, username: current.user.login});
  if (!['admin', 'maintain', 'write'].includes(permission.permission)) {
    throw Error('Preview requires a current repository collaborator');
  }
  const {data} = await github.rest.actions.listWorkflowRuns({...repo,
    workflow_id: 'ci.yml', head_sha: sha, branch: current.head.ref, event: 'pull_request', per_page: 100});
  const run = data.workflow_runs.filter(r => r.head_sha === sha && r.event === 'pull_request' &&
    r.head_branch === current.head.ref && r.path === '.github/workflows/ci.yml' &&
    r.repository?.full_name === fullName && r.head_repository?.full_name === fullName)
    .sort((a, b) => b.id - a.id)[0];
  if (run?.status !== 'completed') return null;
  if (run.conclusion !== 'success') throw Error(`Preview CI ${run.id}: ${run.conclusion}`);
  return run.id;
}

export async function requirePreviewCi(args) {
  const id = await inspectPreviewCi(args);
  if (!id) throw Error('Successful CI required for the current preview head');
  return id;
}

export async function waitForPreviewCi({sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 120, ...args}) {
  validate(args);
  if (!Number.isSafeInteger(attempts) || attempts < 1) throw Error('Invalid CI wait limit');
  for (let attempt = 0; attempt < attempts; attempt++) {
    const id = await inspectPreviewCi(args);
    if (id) return id;
    if (attempt + 1 < attempts) await sleep(15000);
  }
  throw Error(`Timed out waiting for preview CI for ${args.sha}`);
}
