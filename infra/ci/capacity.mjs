import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// A read-only capacity gate. Passing it does not install or activate runners.
export function assessCapacity(facts, budget) {
  const problems = [];
  const positive = value => Number.isFinite(value) && value > 0;
  for (const [name, value] of Object.entries({
    totalMiB: facts.totalMiB,
    availableMiB: facts.availableMiB,
    cpus: facts.cpus,
    poolMiB: budget.poolMiB,
    poolCpus: budget.poolCpus,
    reserveMiB: budget.reserveMiB,
    reserveCpus: budget.reserveCpus,
    workers: budget.workers,
  })) {
    if (!positive(value)) problems.push(`${name} must be a positive finite number`);
  }
  if (problems.length) return {ready: false, problems};
  if (!Number.isInteger(budget.workers) || budget.workers > 2) {
    problems.push('start with one or two build workers; PR count is not worker count');
  }
  if (facts.availableMiB > facts.totalMiB) problems.push('available RAM exceeds total RAM');
  if (budget.minimumTotalMiB !== undefined) {
    if (!positive(budget.minimumTotalMiB)) problems.push('minimumTotalMiB must be positive and finite');
    else if (facts.totalMiB < budget.minimumTotalMiB) problems.push('host RAM upgrade is not visible yet');
  }
  if (budget.poolMiB < budget.workers * 4096) {
    problems.push('allow at least 4096 MiB per build worker, including its helpers');
  }
  if (budget.poolMiB + budget.reserveMiB > facts.availableMiB) {
    problems.push('available RAM cannot cover the CI pool plus additional serving headroom');
  }
  if (budget.poolCpus + budget.reserveCpus > facts.cpus) {
    problems.push('CPU quota would consume the serving CPU allowance');
  }
  if (facts.cgroupVersion !== 2 || facts.cgroupDriver !== 'systemd') {
    problems.push('require cgroup v2 and the systemd driver before relying on resource limits');
  }
  return {
    ready: problems.length === 0,
    problems,
    allocation: {
      ...budget,
      // This is instantaneous additional headroom, not a production peak claim.
      spareAvailableMiB: facts.availableMiB - budget.poolMiB - budget.reserveMiB,
      spareCpus: facts.cpus - budget.poolCpus - budget.reserveCpus,
    },
    notes: [
      'enforce the pool over runner, Docker daemon, builds and service containers together',
      'rootless daemon controller delegation and network isolation require separate verification',
      'no changes to workflows, server configuration, previews or runner registrations',
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const result = assessCapacity(input.facts ?? {}, input.budget ?? {});
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ready ? 0 : 1;
  } catch (error) {
    console.error(`Capacity check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
