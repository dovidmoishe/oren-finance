import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyDocs } from './smoke.mjs';

const sha = 'a'.repeat(40);
function fixture({ badSha = false, failPath, healthFailures = 0 } = {}) {
  const calls = [];
  return {
    calls,
    options: { attempts: 3, sleep: async () => {}, fetcher: async (url, options) => {
      const path = new URL(url).pathname;
      calls.push({ url, options });
      if (path === '/api/health') {
        if (healthFailures-- > 0) throw Error('DNS not ready');
        return Response.json({ status: 'ok', service: 'oren-docs', commitSha: badSha ? 'b'.repeat(40) : sha });
      }
      if (path === failPath) return new Response('unavailable', { status: 503 });
      if (path === '/') return new Response(null, { status: 307, headers: { Location: '/docs' } });
      if (path === '/api/search') return Response.json([{ id: 'portfolio' }]);
      if (path === '/docs/__deployment-missing-page__') return new Response(null, { status: 404 });
      if (options.headers?.Accept === 'text/markdown') return new Response('# Quickstart', { headers: { 'Content-Type': 'text/markdown' } });
      return new Response('Oren Docs');
    } },
  };
}

test('checks the exact release, guides, search, Markdown and missing-page handling', async () => {
  const f = fixture();
  await verifyDocs('https://docs.oren.finance', sha, f.options);
  assert.ok(f.calls.some(({ url }) => url.endsWith('/api/search?query=portfolio')));
  assert.ok(f.calls.some(({ options }) => options.headers?.Accept === 'text/markdown'));
});
test('waits for DNS/TLS startup, but rejects a different running release', async () => {
  const f = fixture({ healthFailures: 2 });
  await verifyDocs('https://docs.oren.finance', sha, f.options);
  assert.equal(f.calls.filter(({ url }) => url.endsWith('/api/health')).length, 3);
  await assert.rejects(verifyDocs('https://docs.oren.finance', sha, fixture({ badSha: true }).options), /did not become healthy/);
});
test('a broken content endpoint blocks a healthy container from passing release checks', async () => {
  await assert.rejects(verifyDocs('https://docs.oren.finance', sha, fixture({ failPath: '/llms.txt' }).options), /should be available/);
});
test('rejects abbreviated or arbitrary release names before making requests', async () => {
  const f = fixture();
  await assert.rejects(verifyDocs('https://docs.oren.finance', 'master', f.options), /full release SHA/);
  assert.equal(f.calls.length, 0);
});
