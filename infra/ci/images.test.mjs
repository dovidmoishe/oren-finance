import test from 'node:test';
import assert from 'node:assert/strict';
import { builtImages, recordedImages } from './images.mjs';
const api='sha256:'+'a'.repeat(64), app='sha256:'+'b'.repeat(64);
test('deployment selection accepts content-addressed trusted build outputs only',()=>{
  const images=builtImages('owner',api,app);
  assert.equal(images.OREN_API_IMAGE,`ghcr.io/owner/oren-api@${api}`);
  for (const invalid of ['latest','a'.repeat(40),'sha256:wrong',undefined]) assert.throws(()=>builtImages('owner',invalid,app));
});
test('rollback requires the exact server-side verified image record, without eval or tag fallback',()=>{
  const record=`OREN_API_IMAGE=ghcr.io/owner/oren-api@${api}\nOREN_APP_IMAGE=ghcr.io/owner/oren-app@${app}\n`;
  assert.deepEqual(recordedImages('owner',record),builtImages('owner',api,app));
  for (const invalid of [record.replace('/owner/','/attacker/'),record.replace('@sha256:',':latest#'),record+'OTHER=value\n',record.replace('OREN_APP_IMAGE','OREN_API_IMAGE')]) {
    assert.throws(()=>recordedImages('owner',invalid));
  }
});
