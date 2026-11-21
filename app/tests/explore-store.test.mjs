import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function fixture(getNewsFeed) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../store/explore-store.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, AbortController, require: id => id === '@/services/news-feed-service' ? { getNewsFeed } : require(id) });
  return { store: exports.useExploreStore, key: exports.exploreFeedKey };
}
const identity = { userId: 'owner', wallet: 'wallet', getAccessToken: async () => 'session-token' };
const feed = (id) => ({ items: [{ id }], state: 'ready', selection: 'latest', generatedAt: '2026-11-21T10:00:00Z', stocks: [], totalHoldings: 0, partial: false });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('both tabs reuse their own loaded stories across switches and page visits', async () => {
  const calls = [];
  const { store, key } = fixture(async scope => { calls.push(scope); return feed(scope); });
  for (const scope of ['for-you', 'trending', 'for-you', 'trending']) {
    store.getState().selectScope(scope);
    await store.getState().loadFeed(scope, identity);
  }
  assert.deepEqual(calls, ['for-you', 'trending']);
  assert.equal(store.getState().selectedScope, 'trending');
  assert.equal(store.getState().feeds[key('for-you', 'owner', 'wallet')].feed.items[0].id, 'for-you');
  assert.equal(store.getState().feeds.trending.feed.items[0].id, 'trending');
});

test('switching while requests run keeps them alive and coalesces repeated mounts and refresh clicks', async () => {
  const personal = deferred(), trending = deferred(), calls = [];
  const { store } = fixture((scope, signal, auth) => { calls.push({ scope, signal, auth }); return scope === 'for-you' ? personal.promise : trending.promise; });
  const a = store.getState().loadFeed('for-you', identity);
  const b = store.getState().loadFeed('trending', identity);
  assert.equal(store.getState().loadFeed('for-you', identity), a);
  assert.equal(store.getState().loadFeed('trending', identity, true), b);
  await Promise.resolve();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].signal.aborted, false);
  assert.equal(calls[1].auth, undefined, 'public Trending must not receive identity/token callbacks');
  personal.resolve(feed('personal')); trending.resolve(feed('public'));
  await Promise.all([a, b]);
  assert.equal(store.getState().feeds.trending.isLoading, false);
});

test('explicit refresh reloads only the requested tab and retains its stories while loading', async () => {
  const calls = [], update = deferred();
  const { store, key } = fixture(async scope => { calls.push(scope); return calls.length === 3 ? update.promise : feed(scope); });
  await store.getState().loadFeed('for-you', identity);
  await store.getState().loadFeed('trending');
  const refreshing = store.getState().loadFeed('for-you', identity, true);
  const personalKey = key('for-you', 'owner', 'wallet');
  assert.equal(store.getState().feeds[personalKey].feed.items[0].id, 'for-you');
  assert.equal(store.getState().feeds[personalKey].isLoading, true);
  assert.equal(store.getState().feeds.trending.isLoading, false);
  update.resolve(feed('updated')); await refreshing;
  assert.deepEqual(calls, ['for-you', 'trending', 'for-you']);
  assert.equal(store.getState().feeds[personalKey].feed.items[0].id, 'updated');
});

test('failed refresh is preserved across navigation and explicit retry clears it', async () => {
  let calls = 0;
  const { store } = fixture(async () => { calls++; if (calls === 2) throw new Error('offline'); return feed(String(calls)); });
  await store.getState().loadFeed('trending');
  await store.getState().loadFeed('trending', undefined, true);
  assert.equal(store.getState().feeds.trending.error, true);
  assert.equal(store.getState().feeds.trending.feed.items[0].id, '1');
  await store.getState().loadFeed('trending');
  assert.equal(calls, 2);
  await store.getState().loadFeed('trending', undefined, true);
  assert.equal(store.getState().feeds.trending.error, false);
  assert.equal(store.getState().feeds.trending.feed.items[0].id, '3');
});

test('personal feed cache keys separate both account and wallet', async () => {
  let calls = 0;
  const { store, key } = fixture(async (_scope, _signal, auth) => { calls++; return feed(auth.userId + ':' + auth.wallet); });
  for (const auth of [identity, { ...identity, userId: 'other' }, { ...identity, wallet: 'other-wallet' }]) await store.getState().loadFeed('for-you', auth);
  assert.equal(calls, 3);
  assert.equal(store.getState().feeds[key('for-you', 'owner', 'wallet')].feed.items[0].id, 'owner:wallet');
  assert.equal(store.getState().feeds[key('for-you', 'other', 'wallet')].feed.items[0].id, 'other:wallet');
  assert.equal(key('for-you', 'owner', undefined), undefined);
});

test('session reset clears private stories and aborts requests without losing public Trending', async () => {
  const old = deferred(), replacement = deferred();
  let personalCalls = 0, oldSignal;
  const { store, key } = fixture((scope, signal) => {
    if (scope === 'trending') return Promise.resolve(feed('public'));
    personalCalls++;
    if (personalCalls === 1) { oldSignal = signal; return old.promise; }
    return replacement.promise;
  });
  await store.getState().loadFeed('trending');
  const oldRequest = store.getState().loadFeed('for-you', identity); await Promise.resolve();
  store.getState().resetPrivateFeeds();
  assert.equal(oldSignal.aborted, true);
  const privateKey = key('for-you', 'owner', 'wallet');
  assert.equal(store.getState().feeds[privateKey], undefined);
  assert.equal(store.getState().feeds.trending.feed.items[0].id, 'public');
  const next = store.getState().loadFeed('for-you', identity); await Promise.resolve();
  old.resolve(feed('discard')); await oldRequest;
  assert.equal(store.getState().feeds[privateKey].isLoading, true);
  assert.equal(store.getState().feeds[privateKey].feed, undefined);
  replacement.resolve(feed('new-session')); await next;
  assert.equal(store.getState().feeds[privateKey].feed.items[0].id, 'new-session');
  store.getState().resetPrivateFeeds();
  assert.equal(store.getState().feeds[privateKey], undefined);
});

test('session reset discards late failures and does not cancel a pending public request', async () => {
  const personal = deferred(), trending = deferred();
  const { store } = fixture(scope => scope === 'trending' ? trending.promise : personal.promise);
  const a = store.getState().loadFeed('for-you', identity), b = store.getState().loadFeed('trending');
  await Promise.resolve(); store.getState().resetPrivateFeeds();
  personal.reject(new Error('late failure')); await a;
  assert.deepEqual(Object.keys(store.getState().feeds), ['trending']);
  trending.resolve(feed('public')); await b;
  assert.equal(store.getState().feeds.trending.feed.items[0].id, 'public');
});

test('incomplete private identity never fetches or creates a cache entry', async () => {
  let calls = 0;
  const { store } = fixture(async () => { calls++; return feed('unexpected'); });
  await store.getState().loadFeed('for-you');
  await store.getState().loadFeed('for-you', { ...identity, userId: '' });
  await store.getState().loadFeed('for-you', { ...identity, wallet: '' });
  assert.equal(calls, 0);
  assert.equal(Object.keys(store.getState().feeds).length, 0);
});
