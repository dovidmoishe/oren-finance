import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeTrustedJob } from './trusted-job.mjs';
const good = {
  GITHUB_REPOSITORY: 'dovidmoishe/oren-finance', GITHUB_REF: 'refs/heads/master',
  GITHUB_EVENT_NAME: 'push',
  GITHUB_WORKFLOW_REF: 'dovidmoishe/oren-finance/.github/workflows/deploy-production.yml@refs/heads/master',
};
test('trusted release builder accepts only default-branch release workflow provenance', () => {
  assert.equal(authorizeTrustedJob('release', good), true);
  assert.equal(authorizeTrustedJob('release', {...good, GITHUB_EVENT_NAME:'workflow_dispatch'}), true);
  for (const patch of [
    {GITHUB_EVENT_NAME:'pull_request'}, {GITHUB_EVENT_NAME:'workflow_run'},
    {GITHUB_REF:'refs/pull/86/merge'}, {GITHUB_REPOSITORY:'fork/finance'},
    {GITHUB_WORKFLOW_REF:good.GITHUB_WORKFLOW_REF.replace('@refs/heads/master','@refs/heads/feature')},
    {GITHUB_WORKFLOW_REF:good.GITHUB_WORKFLOW_REF.replace('deploy-production','ci')},
  ]) assert.throws(()=>authorizeTrustedJob('release',{...good,...patch}));
});
test('trusted control hook rejects PR workflows claiming its label', () => {
  assert.equal(authorizeTrustedJob('control', {...good,GITHUB_EVENT_NAME:'workflow_run',GITHUB_WORKFLOW_REF:good.GITHUB_WORKFLOW_REF.replace('deploy-production','preview')}), true);
  assert.throws(()=>authorizeTrustedJob('control',{...good,GITHUB_EVENT_NAME:'pull_request'}));
  assert.throws(()=>authorizeTrustedJob('control',{...good,GITHUB_WORKFLOW_REF:good.GITHUB_WORKFLOW_REF.replace('deploy-production','attacker')}));
  assert.throws(()=>authorizeTrustedJob('unknown',good));
});
