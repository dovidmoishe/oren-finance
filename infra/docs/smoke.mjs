import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';

export async function verifyDocs(base, sha, { fetcher = fetch, sleep = setTimeout, attempts = 60 } = {}) {
  const origin = new URL(base).origin;
  assert.match(sha, /^[a-f0-9]{40}$/, 'Expected a full release SHA');
  const request = (path, options = {}) => fetcher(`${origin}${path}`, { signal: AbortSignal.timeout(5000), ...options });
  let ready = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await request('/api/health');
      const health = await response.json();
      ready = response.ok && health.status === 'ok' && health.service === 'oren-docs' && health.commitSha === sha;
    } catch { /* DNS, TLS and container startup can still be settling. */ }
    if (ready) break;
    if (attempt + 1 < attempts) await sleep(1000);
  }
  assert.ok(ready, `Docs release ${sha} did not become healthy at ${origin}`);
  const root = await request('/', { redirect: 'manual' });
  assert.equal(root.status, 307, 'Root should redirect to the introduction');
  assert.equal(root.headers.get('location'), '/docs');
  for (const path of ['/docs', '/docs/mcp/quickstart', '/llms.txt', '/llms-full.txt', '/sitemap.xml', '/robots.txt']) {
    const response = await request(path);
    assert.equal(response.status, 200, `${path} should be available`);
    assert.ok((await response.text()).length > 0, `${path} should have content`);
  }
  const search = await request('/api/search?query=portfolio');
  assert.equal(search.status, 200);
  const results = await search.json();
  assert.ok(Array.isArray(results) && results.length > 0, 'Search should return portfolio results');
  const markdown = await request('/docs/mcp/quickstart', { headers: { Accept: 'text/markdown' } });
  assert.equal(markdown.status, 200);
  assert.match(markdown.headers.get('content-type') ?? '', /text\/markdown/);
  assert.match(await markdown.text(), /^# /);
  assert.equal((await request('/docs/__deployment-missing-page__')).status, 404);
  console.log(`Verified Oren docs ${sha} at ${origin}`);
}

// A direct file invocation and `node --input-type=module -` both pass base/SHA here.
if (process.argv[2] && process.argv[3]) {
  await verifyDocs(process.argv[2], process.argv[3]);
}
