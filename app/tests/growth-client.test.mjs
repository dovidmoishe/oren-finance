import test from 'node:test';
import assert from 'node:assert/strict';
import { attributionHeader, nextAttribution, nextSession, readUtms } from '../lib/growth-client.mjs';

test('first touch survives a later visit and the consent header', () => {
  const params = new URLSearchParams('utm_source=x&utm_campaign=launch&utm_content=a');
  const first = nextAttribution({ visitorId: '11111111-1111-4111-8111-111111111111' }, readUtms(params), '2026-11-01T00:00:00.000Z', '/agents');
  const later = nextAttribution(first, { source: 'x', campaign: 'launch', content: 'b' }, '2026-11-02T00:00:00.000Z', '/agents');
  assert.equal(later.first.content, 'a');
  assert.equal(later.last.content, 'b');
  const header = attributionHeader(later);
  const decoded = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
  assert.equal(decoded.first.content, 'a');
  assert.equal(decoded.visitorId, '11111111-1111-4111-8111-111111111111');
});

test('a session rotates after 30 idle minutes and stays put before that', () => {
  const first = nextSession(undefined, 0);
  const same = nextSession({ sessionId: first.sessionId, sessionSeenAt: 0 }, 10 * 60 * 1000);
  const rotated = nextSession({ sessionId: first.sessionId, sessionSeenAt: 0 }, 31 * 60 * 1000);
  assert.equal(same.sessionId, first.sessionId);
  assert.equal(same.fresh, false);
  assert.notEqual(rotated.sessionId, first.sessionId);
  assert.equal(rotated.fresh, true);
});
