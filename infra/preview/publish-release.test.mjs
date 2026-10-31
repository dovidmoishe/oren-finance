import test from 'node:test';
import assert from 'node:assert/strict';
import { publishRelease } from './publish-release.mjs';

function fixture(existing) {
  const calls = [];
  return {calls, github:{rest:{actions:{getWorkflowRun:async()=>({data:{created_at:'2026-10-31T10:00:00Z'}})},repos:{
    getReleaseByTag:async()=>{if(existing)return {data:existing}; throw Object.assign(Error('missing'),{status:404});},
    generateReleaseNotes:async()=>({data:{body:'Changes'}}),
    createRelease:async data=>{calls.push(data);return {data};},
  }}},context:{repo:{owner:'owner',repo:'repo'},runId:123,serverUrl:'https://github.com',payload:{}},core:{info(){}},env:{IMAGE_TAG:'a'.repeat(40),API_DIGEST:'sha256:'+'b'.repeat(64),APP_DIGEST:'sha256:'+'c'.repeat(64)}};
}
test('release records pin commit and digests with a stable run-based tag',async()=>{
  const f=fixture();await publishRelease(f);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].tag_name,'prod-20261031-123');
  assert.equal(f.calls[0].target_commitish,f.env.IMAGE_TAG);
  assert.match(f.calls[0].body,/API image: sha256:bbbb/);assert.match(f.calls[0].body,/Migration sources:/);
});
test('reruns do not duplicate releases, and conflicting tags fail',async()=>{
  const f=fixture({target_commitish:'a'.repeat(40),html_url:'https://example.com'});await publishRelease(f);assert.equal(f.calls.length,0);
  await assert.rejects(publishRelease(fixture({target_commitish:'d'.repeat(40)})),/different commit/);
});
test('manual rollbacks are labelled and malformed metadata never publishes',async()=>{
  const f=fixture();f.context.payload.inputs={image_tag:f.env.IMAGE_TAG};await publishRelease(f);assert.match(f.calls[0].body,/Manual deployment \/ rollback/);
  f.env.API_DIGEST='unresolved';await assert.rejects(publishRelease(f),/Invalid API_DIGEST/);assert.equal(f.calls.length,1);
});
