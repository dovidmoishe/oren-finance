const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function recent(date, now) {
  const timestamp = Date.parse(date ?? '');
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= MAX_AGE_MS;
}

function releaseDigest(body) {
  return /^API image: (sha256:[a-f0-9]{64})$/m.exec(body ?? '')?.[1];
}

function deploymentDigest(description) {
  return /^api (sha256:[a-f0-9]{64})$/.exec(description ?? '')?.[1];
}

async function apiTree(github, repo, sha) {
  const {data: commit} = await github.rest.git.getCommit({...repo, commit_sha: sha});
  const {data: root} = await github.rest.git.getTree({...repo, tree_sha: commit.tree.sha});
  if (root.truncated) return null;
  return root.tree.find(item => item.path === 'api' && item.type === 'tree')?.sha ?? null;
}

async function candidates(github, repo, environment, pr, now) {
  if (environment === 'production') {
    const {data: releases} = await github.rest.repos.listReleases({...repo, per_page: 30});
    return releases.filter(release => /^prod-\d{8}-\d+$/.test(release.tag_name ?? '') && recent(release.published_at, now))
      .map(release => ({sha: release.target_commitish, digest: releaseDigest(release.body)}));
  }
  if (environment !== 'preview' || !Number.isSafeInteger(pr) || pr < 1) throw Error('Invalid preview environment');
  const {data: deployments} = await github.rest.repos.listDeployments({...repo, environment: `preview-pr-${pr}`, per_page: 30});
  const result = [];
  for (const deployment of deployments) {
    if (!SHA.test(deployment.sha ?? '')) continue;
    const {data: statuses} = await github.rest.repos.listDeploymentStatuses({...repo, deployment_id: deployment.id, per_page: 1});
    const status = statuses[0];
    if (status?.state === 'success' && recent(status.created_at, now)) {
      result.push({sha: deployment.sha, digest: deploymentDigest(status.description)});
    }
  }
  return result;
}

export async function findReusableApiImage({github, repo, sha, environment, pr, now = Date.now()}) {
  if (!SHA.test(sha ?? '')) throw Error('Invalid target commit');
  const targetTree = await apiTree(github, repo, sha);
  if (!targetTree) return null;
  for (const candidate of await candidates(github, repo, environment, pr, now)) {
    if (!SHA.test(candidate.sha ?? '') || !DIGEST.test(candidate.digest ?? '')) continue;
    try {
      if (await apiTree(github, repo, candidate.sha) === targetTree) return candidate.digest;
    } catch {
      // A deleted preview commit or inaccessible record cannot authorize reuse.
    }
  }
  return null;
}
