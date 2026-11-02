import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize} from './ci-speed.mjs';
test('median and nearest-rank p90 use paired observations, with a five-sample minimum', () => {
  assert.deepEqual(summarize([10, 40, 20, 50, 30]), {n: 5, medianSeconds: 30, p90Seconds: 50, accepted: true});
  assert.deepEqual(summarize([10, 20, 30, 40]), {n: 4, medianSeconds: 25, p90Seconds: 40, accepted: false});
  assert.deepEqual(summarize([]), {n: 0, medianSeconds: null, p90Seconds: null, accepted: false});
});
