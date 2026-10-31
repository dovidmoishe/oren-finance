// Run inside actions/github-script with the injected GitHub client.
export async function publishRelease({ github, context, core, env = process.env }) {
  const sha = env.IMAGE_TAG;
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw Error('Release requires a full commit SHA');
  for (const key of ['API_DIGEST', 'APP_DIGEST']) if (!/^sha256:[a-f0-9]{64}$/.test(env[key] ?? '')) throw Error(`Invalid ${key}`);
  const { data: run } = await github.rest.actions.getWorkflowRun({ ...context.repo, run_id: context.runId });
  const tag = `prod-${run.created_at.slice(0, 10).replaceAll('-', '')}-${context.runId}`;
  try {
    const { data: existing } = await github.rest.repos.getReleaseByTag({ ...context.repo, tag });
    if (existing.target_commitish !== sha) throw Error('Release tag already refers to a different commit');
    core.info(`Release already recorded: ${existing.html_url}`); return;
  } catch (error) { if (error.status !== 404) throw error; }
  const { data: notes } = await github.rest.repos.generateReleaseNotes({ ...context.repo, tag_name: tag, target_commitish: sha });
  const rollback = context.payload.inputs?.image_tag ? 'Manual deployment / rollback' : 'Automatic production deployment';
  await github.rest.repos.createRelease({ ...context.repo, tag_name: tag, target_commitish: sha, name: tag,
    body: `${rollback}\n\nCommit: ${sha}\nAPI image: ${env.API_DIGEST}\nApp image: ${env.APP_DIGEST}\nMigration sources: https://github.com/${context.repo.owner}/${context.repo.repo}/tree/${sha}/api/lib/db/migrations\nWorkflow: ${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}\n\nDatabase migrations are not automatically reversed by rollback.\n\n${notes.body}` });
}
