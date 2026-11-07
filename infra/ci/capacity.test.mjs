import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessCapacity } from './capacity.mjs';

const facts = {totalMiB: 11520, availableMiB: 9800, cpus: 5, cgroupVersion: 2, cgroupDriver: 'systemd'};
const budget = {poolMiB: 8192, poolCpus: 3, reserveMiB: 1024, reserveCpus: 2, workers: 2};
const selected = JSON.parse(readFileSync(new URL('./upgrade-profile.json', import.meta.url), 'utf8'));

test('selected 3 CPU / 10 GB profile preserves serving capacity and rejects old host', () => {
  assert.equal(assessCapacity({...facts, totalMiB: 9472, availableMiB: 7900, cpus: 3}, selected.budget).ready, true);
  assert.equal(assessCapacity({...facts, totalMiB: 7424, availableMiB: 5910, cpus: 2}, selected.budget).ready, false);
  // CPU hotplug alone does not prove the memory upgrade was applied.
  assert.equal(assessCapacity({...facts, totalMiB: 7424, availableMiB: 7000, cpus: 3}, selected.budget).ready, false);
  assert.equal(selected.components.build.memoryMiB + selected.components.trustedControl.memoryMiB, selected.budget.poolMiB);
  assert.equal(selected.components.build.cpus + selected.components.trustedControl.cpus, selected.budget.poolCpus);
});

test('a two-worker upgrade fits only with serving headroom available', () => {
  assert.equal(assessCapacity(facts, budget).ready, true);
  assert.equal(assessCapacity({...facts, availableMiB: 8500}, budget).ready, false);
});

test('the existing two-CPU VPS rejects the proposed upgraded allocation', () => {
  const result = assessCapacity({...facts, totalMiB: 7424, availableMiB: 5878, cpus: 2}, budget);
  assert.equal(result.ready, false);
  assert.ok(result.problems.some(p => p.includes('CPU')));
  assert.ok(result.problems.some(p => p.includes('RAM')));
});

test('three total CPUs require a smaller CI quota than five total CPUs', () => {
  assert.equal(assessCapacity({...facts, cpus: 3}, budget).ready, false);
  assert.equal(assessCapacity({...facts, cpus: 3}, {
    poolMiB: 4096, poolCpus: 2, reserveMiB: 1536, reserveCpus: 1, workers: 1,
  }).ready, true);
});

test('nominal slice memory does not make a dedicated 4 GB host ready automatically', () => {
  assert.equal(assessCapacity({...facts, totalMiB: 3800, availableMiB: 3400, cpus: 3}, {
    poolMiB: 4096, poolCpus: 2, reserveMiB: 512, reserveCpus: 1, workers: 1,
  }).ready, false);
});

test('reject missing facts, non-finite inputs, unsupported limits and excess workers', () => {
  for (const input of [
    assessCapacity({}, budget),
    assessCapacity(facts, {...budget, poolCpus: Number.NaN}),
    assessCapacity({...facts, cgroupDriver: 'none'}, budget),
    assessCapacity(facts, {...budget, workers: 6}),
    assessCapacity(facts, {...budget, poolMiB: 4096}),
  ]) assert.equal(input.ready, false);
});
