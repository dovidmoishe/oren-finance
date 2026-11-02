import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize, cacheEvidence} from './ci-speed.mjs';
test('median and nearest-rank p90 use paired observations, with a five-sample minimum', () => {
  assert.deepEqual(summarize([10, 40, 20, 50, 30]), {n: 5, medianSeconds: 30, p90Seconds: 50, accepted: true});
  assert.deepEqual(summarize([10, 20, 30, 40]), {n: 4, medianSeconds: 25, p90Seconds: 40, accepted: false});
  assert.deepEqual(summarize([]), {n: 0, medianSeconds: null, p90Seconds: null, accepted: false});
});
test('cache evidence requires the pnpm layer itself and distinguishes materialized images', () => {
  const prefix = '2026-11-02T13:03:11Z ';
  const log = `${prefix}load: true\n${prefix}#12 CACHED\n${prefix}#14 [dependencies 2/2] RUN pnpm install --frozen-lockfile\n${prefix}#14 CACHED\n`;
  const result = cacheEvidence(log);
  assert.equal(result.materialized, true);
  assert.equal(result.dependencyCacheHit, true);
  assert.equal(result.evidence.length, 2);
  assert.equal(cacheEvidence(log.replace('#14 CACHED', '#14 DONE 60.0s')).dependencyCacheHit, false);
  assert.equal(cacheEvidence(log.replace('load: true', 'load: false')).materialized, false);
  assert.equal(cacheEvidence('#12 CACHED\nimporting cache manifest').dependencyCacheHit, null);
});
