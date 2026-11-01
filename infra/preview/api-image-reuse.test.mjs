import test from 'node:test';
import assert from 'node:assert/strict';
import {findReusableApiImage} from './api-image-reuse.mjs';

const now = Date.parse('2026-11-01T12:00:00Z');
const target = 'a'.repeat(40);
const previous = 'b'.repeat(40);
const digest = `sha256:${'c'.repeat(64)}`;

function fixture({sameTree = true, ageDays = 1, state = 'success'} = {}) {
  const calls = [];
  const github = {rest:{
    git:{
      getCommit: async ({commit_sha}) => ({data:{tree:{sha: commit_sha}}}),
      getTree: async ({tree_sha}) => ({data:{tree:[{path:'api',type:'tree',sha: tree_sha === target || sameTree ? 'shared' : 'changed'}]}}),
    },
    repos:{
      listReleases: async () => ({data:[{tag_name:'prod-20261031-123',target_commitish:previous,body:`API image: ${digest}`,published_at:new Date(now-ageDays*86400000).toISOString()}]}),
      listDeployments: async args => {calls.push(args.environment);return {data:[{id:9,sha:previous}]};},
      listDeploymentStatuses: async () => ({data:[{state,description:`api ${digest}`,created_at:new Date(now-ageDays*86400000).toISOString()}]}),
    },
  }};
  return {github,calls};
}

test('production reuses only a recent verified digest with the same API tree', async () => {
  const {github} = fixture();
  assert.equal(await findReusableApiImage({github,repo:{owner:'o',repo:'r'},sha:target,environment:'production',now}), digest);
  for (const options of [{sameTree:false},{ageDays:8}]) {
    assert.equal(await findReusableApiImage({github:fixture(options).github,repo:{owner:'o',repo:'r'},sha:target,environment:'production',now}), null);
  }
});

test('preview requires a successful deployment for the same PR', async () => {
  const {github,calls} = fixture();
  assert.equal(await findReusableApiImage({github,repo:{owner:'o',repo:'r'},sha:target,environment:'preview',pr:42,now}), digest);
  assert.deepEqual(calls,['preview-pr-42']);
  assert.equal(await findReusableApiImage({github:fixture({state:'failure'}).github,repo:{owner:'o',repo:'r'},sha:target,environment:'preview',pr:42,now}), null);
});

test('invalid identifiers and missing digest fail closed', async () => {
  const {github} = fixture();
  await assert.rejects(findReusableApiImage({github,repo:{owner:'o',repo:'r'},sha:'short',environment:'production',now}),/Invalid target/);
  await assert.rejects(findReusableApiImage({github,repo:{owner:'o',repo:'r'},sha:target,environment:'preview',pr:0,now}),/Invalid preview/);
  github.rest.repos.listReleases = async () => ({data:[{tag_name:'prod-20261031-123',target_commitish:previous,body:'API image: invalid',published_at:new Date(now).toISOString()}]});
  assert.equal(await findReusableApiImage({github,repo:{owner:'o',repo:'r'},sha:target,environment:'production',now}), null);
});
