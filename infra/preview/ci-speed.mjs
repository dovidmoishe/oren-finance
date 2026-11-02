import {execFile} from 'node:child_process';
import {promisify, stripVTControlCharacters} from 'node:util';
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const exec = promisify(execFile);
export function summarize(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const n = sorted.length;
  return {n, medianSeconds: n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2 : null,
    p90Seconds: n ? sorted[Math.ceil(n * 0.9) - 1] : null, accepted: n >= 5};
}
const seconds = (start, end) => (Date.parse(end) - Date.parse(start)) / 1000;
const repo = 'dovidmoishe/oren-finance';
export function cacheEvidence(raw) {
  const log = stripVTControlCharacters(raw);
  const install = log.split('\n').find(line => /#\d+ \[dependencies [^\]]+\] RUN pnpm install --frozen-lockfile/.test(line));
  const id = install?.match(/#(\d+)/)?.[1];
  const hit = id ? log.split('\n').find(line => new RegExp(`#${id} CACHED\\s*$`).test(line)) : null;
  const probe = log.match(/#(\d+) \[dependency-probe [^\]]+\] RUN node -e/);
  const probeRan = probe && new RegExp(`#${probe[1]} DONE `).test(log) && /no-cache-filters: dependency-probe/.test(log);
  return {materialized: /\bload: true\b/.test(log) || Boolean(probeRan), dependencyCacheHit: id ? Boolean(hit) : null,
    evidence: [install, hit].filter(Boolean)};
}
async function benchmarkJobs(id) {
  const result = [];
  for (const j of await jobs(id)) {
    let evidence = {};
    if (j.conclusion === 'success') {
      const {stdout} = await exec('gh', ['api', `repos/${repo}/actions/jobs/${j.id}/logs`, '--allow-escape-sequences'], {maxBuffer: 16 * 1024 * 1024});
      evidence = cacheEvidence(stdout);
    }
    result.push({name: j.name, seconds: seconds(j.started_at, j.completed_at), conclusion: j.conclusion, ...evidence,
      steps: j.steps?.map(s => ({name: s.name, seconds: seconds(s.started_at, s.completed_at), conclusion: s.conclusion}))});
  }
  return result;
}
async function api(path) {
  const {stdout} = await exec('gh', ['api', `repos/${repo}/${path}`], {maxBuffer: 16 * 1024 * 1024});
  return JSON.parse(stdout);
}
async function jobs(id) {
  const result = [];
  for (let page = 1; ; page++) {
    const data = await api(`actions/runs/${id}/jobs?per_page=100&page=${page}`);
    result.push(...data.jobs);
    if (data.jobs.length < 100) return result;
  }
}
export async function collect({limit = 10, since = '2026-11-01T00:00:00Z', until = new Date().toISOString(), label = 'baseline'} = {}) {
  const result = {label, capturedAt: new Date().toISOString(), since, until,
    definition: {preview: 'Successful exact-head PR CI created_at to successful preview deployment status created_at; CI creation is a push-time proxy, not PR creation time',
      production: 'PR merged_at to completion of Verify public production endpoints for the exact merge SHA',
      p90: 'Nearest-rank percentile; retries excluded from comparable latency, retained in exclusions/failures'},
    preview: [], production: [], failures: [], excluded: [], benchmark: []};
  const inWindow = r => r.created_at >= since && r.created_at <= until;
  const releases = await api('actions/workflows/deploy-production.yml/runs?per_page=100');
  for (const run of releases.workflow_runs.filter(inWindow)) {
    if (run.conclusion && run.conclusion !== 'success') result.failures.push({kind: 'production', run: run.id, sha: run.head_sha, conclusion: run.conclusion});
    if (run.conclusion !== 'success') continue;
    if (run.event === 'workflow_dispatch' || run.run_attempt !== 1) {result.excluded.push({run: run.id, reason: 'manual deployment or retry'}); continue;}
    if (result.production.length >= limit) continue;
    if (result.production.some(p => p.sha === run.head_sha)) {result.excluded.push({run: run.id, reason: 'duplicate merge SHA'}); continue;}
    const prs = await api(`commits/${run.head_sha}/pulls?per_page=100`);
    const pr = prs.find(p => p.merged_at && p.merge_commit_sha === run.head_sha && p.base.ref === 'master');
    if (!pr) {result.excluded.push({run: run.id, reason: 'no exact merged PR'}); continue;}
    const runJobs = await jobs(run.id);
    const health = runJobs.flatMap(j => j.steps ?? []).find(s => s.name === 'Verify public production endpoints' && s.conclusion === 'success');
    if (!health) {result.excluded.push({run: run.id, reason: 'no successful public health step'}); continue;}
    const duration = seconds(pr.merged_at, health.completed_at);
    if (duration < 0) throw Error('Invalid production timestamps');
    result.production.push({pr: pr.number, sha: run.head_sha, run: run.id, url: run.html_url,
      mergedAt: pr.merged_at, healthyAt: health.completed_at, seconds: duration, overlapped: run.event === 'push',
      stages: runJobs.map(j => ({name: j.name, seconds: seconds(j.started_at, j.completed_at), conclusion: j.conclusion}))});
  }
  const deployments = await api('deployments?per_page=100');
  for (const dep of deployments.filter(d => /^preview-pr-\d+$/.test(d.environment) && inWindow(d))) {
    const statuses = await api(`deployments/${dep.id}/statuses?per_page=100`);
    // A subsequent inactive status does not erase a previously verified deployment.
    const success = statuses.find(s => s.state === 'success');
    const failure = statuses.find(s => s.state === 'failure' || s.state === 'error');
    if (failure) result.failures.push({kind: 'preview', deployment: dep.id, sha: dep.sha,
      run: Number(/\/actions\/runs\/(\d+)/.exec(failure.log_url ?? '')?.[1]) || null,
      url: failure.log_url, conclusion: failure.state});
    if (!success || result.preview.length >= limit) continue;
    const previewRunId = Number(/\/actions\/runs\/(\d+)/.exec(success.log_url ?? '')?.[1]);
    if (!previewRunId) continue;
    const run = await api(`actions/runs/${previewRunId}`);
    if (run.event === 'workflow_dispatch' || run.run_attempt !== 1) {result.excluded.push({run: run.id, reason: 'manual preview or retry'}); continue;}
    const cis = await api(`actions/workflows/ci.yml/runs?head_sha=${dep.sha}&event=pull_request&per_page=100`);
    const ci = cis.workflow_runs.filter(c => c.conclusion === 'success' && c.run_attempt === 1 && c.created_at <= dep.created_at)
      .sort((a, b) => b.id - a.id)[0];
    if (!ci || result.preview.some(p => p.sha === dep.sha)) continue;
    const duration = seconds(ci.created_at, success.created_at);
    if (duration < 0) throw Error('Invalid preview timestamps');
    const ciJobs = await jobs(ci.id);
    const parallelWebChecks = ['App test', 'App lint', 'App build'].every(name => ciJobs.some(j => j.name === name));
    result.preview.push({parallelWebChecks, pr: Number(dep.environment.slice('preview-pr-'.length)), sha: dep.sha,
      ciRun: ci.id, previewRun: run.id, deployment: dep.id, url: success.log_url,
      ciCreatedAt: ci.created_at, readyAt: success.created_at, seconds: duration});
  }
  for (const [workflow, kind] of [['preview.yml', 'preview-workflow'], ['ci.yml', 'ci']]) {
    const runs = await api(`actions/workflows/${workflow}/runs?per_page=100`);
    for (const run of runs.workflow_runs.filter(inWindow)) {
      if (!run.conclusion || run.conclusion === 'success') continue;
      if (run.conclusion === 'cancelled') {result.excluded.push({kind, run: run.id, reason: 'cancelled/superseded; not a latency sample'}); continue;}
      if (result.failures.some(f => f.run === run.id)) continue;
      const runJobs = await jobs(run.id);
      result.failures.push({kind, run: run.id, workflowSha: run.head_sha, conclusion: run.conclusion, url: run.html_url,
        failedJobs: runJobs.filter(j => j.conclusion === 'failure').map(j => ({name: j.name, steps: j.steps?.filter(s => s.conclusion === 'failure').map(s => s.name)})),
        hasDeployJob: kind === 'preview-workflow' ? runJobs.some(j => j.name === 'deploy') : undefined});
    }
  }
  try {
    const benchmarks = await api('actions/workflows/benchmark-web-deps.yml/runs?per_page=20');
    for (const run of benchmarks.workflow_runs.filter(r => inWindow(r) && r.status === 'completed')) {
      result.benchmark.push({run: run.id, sha: run.head_sha, conclusion: run.conclusion,
        jobs: await benchmarkJobs(run.id)});
    }
  } catch (error) {
    if (!String(error.stderr).includes('404')) throw error;
  }
  result.summary = {cohorts: {serialWebPreview: summarize(result.preview.filter(p => !p.parallelWebChecks).map(p => p.seconds)), parallelWebPreview: summarize(result.preview.filter(p => p.parallelWebChecks).map(p => p.seconds)), serialProduction: summarize(result.production.filter(p => !p.overlapped).map(p => p.seconds)), overlappedProduction: summarize(result.production.filter(p => p.overlapped).map(p => p.seconds))}, preview: summarize(result.preview.map(p => p.seconds)), production: summarize(result.production.map(p => p.seconds)), failures: result.failures.length};
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {const i = a.indexOf('='); return [a.slice(2, i), a.slice(i + 1)];}));
  const result = await collect({limit: Number(args.limit ?? 10), since: args.since, until: args.until, label: args.label});
  if (args.output) writeFileSync(args.output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result.summary, null, 2));
}
