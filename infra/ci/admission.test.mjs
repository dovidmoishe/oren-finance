import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('root admission rejects identity spoofing and serializes bounded builders', {skip:process.platform==='win32'}, () => {
  const result=spawnSync('python3',[fileURLToPath(new URL('./admission_test.py',import.meta.url))],{encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+result.stderr);
});
