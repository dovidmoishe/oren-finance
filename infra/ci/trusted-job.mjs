import { pathToFileURL } from 'node:url';

const REPOSITORY = 'dovidmoishe/oren-finance';
const controlWorkflows = new Set([
  'deploy-production', 'deploy-docs', 'preview', 'preview-maintenance', 'preview-setup',
  'bootstrap-signer-gate', 'diagnose-signer-gate', 'enable-mcp-oauth',
  'enable-owner-buy', 'kill-owner-buy', 'provision-signer-gate-roles',
]);

// This runs as the administrator-configured job-start hook, before container
// initialization or action pre-steps. Runner JobHookProvider supplies an empty
// job-env dictionary; ScriptHandler exports GitHub's immutable runtime context.
// A workflow label alone is not an authorization boundary.
export function authorizeTrustedJob(role, env) {
  if (!['release', 'control'].includes(role)) throw Error('Unknown trusted runner role');
  if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_REF !== 'refs/heads/master') {
    throw Error('Trusted runner requires this repository and its master ref');
  }
  const prefix = `${REPOSITORY}/.github/workflows/`;
  const reference = env.GITHUB_WORKFLOW_REF ?? '';
  if (!reference.startsWith(prefix) || !reference.endsWith('.yml@refs/heads/master')) {
    throw Error('Trusted runner requires default-branch workflow provenance');
  }
  const workflow = reference.slice(prefix.length, -'.yml@refs/heads/master'.length);
  if (!controlWorkflows.has(workflow)) throw Error('Workflow is not authorized for trusted runners');
  if (role === 'release' && (!['deploy-production', 'deploy-docs'].includes(workflow) ||
      !['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME))) {
    throw Error('Release builder accepts only trusted production/docs releases');
  }
  if (role === 'control' && !['push', 'workflow_dispatch', 'workflow_run', 'pull_request_target', 'schedule'].includes(env.GITHUB_EVENT_NAME)) {
    throw Error('PR job execution is forbidden on trusted control runners');
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { authorizeTrustedJob(process.argv[2], process.env); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
