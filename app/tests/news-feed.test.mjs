import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement, Children, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(file, mocks = {}, extra = '') {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8') + extra, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: (id) => id in mocks ? mocks[id] : require(id), URL, AbortController });
  return exports;
}

test('personal news sends an authenticated no-store request and checks cancellation after token restoration', async () => {
  const calls = [];
  const service = load('../services/news-feed-service.ts', { './api-client': { apiRequest: async (...args) => { calls.push(args); return { items: [] }; } } });
  const controller = new AbortController();
  await service.getNewsFeed('for-you', controller.signal, { wallet: 'linked-wallet', getAccessToken: async () => 'session' });
  assert.equal(calls[0][0], '/news/for-you');
  assert.equal(calls[0][1].cache, 'no-store');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer session');
  assert.equal(calls[0][1].query.walletAddress, 'linked-wallet');
  await assert.rejects(service.getNewsFeed('for-you', controller.signal, { wallet: 'wallet', getAccessToken: async () => { controller.abort(); return 'old-session'; } }));
  assert.equal(calls.length, 1);
});

test('public trending never sends a token or wallet and missing auth does not make a private request', async () => {
  const calls = [];
  const service = load('../services/news-feed-service.ts', { './api-client': { apiRequest: async (...args) => { calls.push(args); return { items: [] }; } } });
  await service.getNewsFeed('trending', new AbortController().signal);
  assert.equal(calls[0][0], '/news/trending');
  assert.equal(calls[0][1].headers, undefined);
  assert.equal(calls[0][1].query, undefined);
  await assert.rejects(service.getNewsFeed('for-you', new AbortController().signal, { wallet: 'wallet', getAccessToken: async () => null }));
  assert.equal(calls.length, 1);
});

const story = { id: 'one', headline: 'NVIDIA reports quarterly results', summary: 'The company published its latest results.', source: 'Company newsroom', url: 'https://example.com/results', publishedAt: '2026-11-19T10:00:00Z', stocks: [{ assetId: 'nvda', ticker: 'NVDA', name: 'NVIDIA' }] };
const baseFeed = { items: [story], selection: 'agent', state: 'ready', stocks: story.stocks, totalHoldings: 1, partial: false, generatedAt: '2026-11-19T11:00:00Z' };
const { exploreFeedKey } = load('../store/explore-store.ts', { '@/services/news-feed-service': {} });

function fixture({ feed = baseFeed, auth = { ready: true, authenticated: true, address: 'wallet', userId: 'owner' }, busy = false, error = false, loading = false } = {}) {
  const calls = [];
  const store = { isSending: busy, setPanelOpen: (...args) => calls.push(['open', ...args]), sendMessage: (...args) => calls.push(['send', ...args]) };
  const explore = {
    selectedScope: 'for-you',
    selectScope: (scope) => { explore.selectedScope = scope; },
    feeds: {
      [exploreFeedKey('for-you', auth.userId, auth.address)]: { feed, error, isLoading: loading },
      trending: { feed, error, isLoading: loading },
    },
    loadFeed: (...args) => { calls.push(['load', ...args]); return Promise.resolve(); },
  };
  const hooks = { useEffect() {}, useLayoutEffect() {}, useRef: (value) => ({ current: value }) };
  const exports = load('../components/news/news-page.tsx', {
    react: hooks,
    'next/link': { default: ({ children, href, ...props }) => createElement('a', { href, ...props }, children) },
    '@/components/auth/auth-context': { useOrenAuth: () => auth },
    '@/components/brand/oren-logo': { OrenLogo: () => null },
    '@/components/ui': { cn: (...values) => values.filter(Boolean).join(' '), Button: ({ children, ...props }) => createElement('button', props, children) },
    '@/store': { exploreFeedKey, useExploreStore: (select) => select(explore), useAgentStore: (select) => select(store) },
  }, '\nexport { NewsFeedSection, StoryRow };');
  return { ...exports, calls, auth,
    renderPage(scope = explore.selectedScope) { explore.selectedScope = scope; return renderToStaticMarkup(createElement(exports.ExplorePage)); },
    renderFeed() { return renderToStaticMarkup(createElement(exports.NewsFeedSection, { scope: 'for-you', userId: auth.userId, wallet: auth.address, getAccessToken: async () => 'session' })); },
  };
}

test('personal feed retains original source links, dates and factual holdings reasons', () => {
  const html = fixture().renderFeed();
  for (const value of ['Selected by Oren', 'NVIDIA reports quarterly results', 'Company newsroom', 'You hold NVDA', 'https://example.com/results', '2026-11-19T10:00:00Z', 'Ask Oren']) assert.ok(html.includes(value), value);
  assert.match(html, /rel="noopener noreferrer"/);
  const fallback = fixture({ feed: { ...baseFeed, selection: 'latest', partial: true } }).renderFeed();
  assert.ok(fallback.includes('Latest stories about your holdings'));
  assert.ok(fallback.includes('Some coverage is unavailable'));
  assert.equal(fallback.includes('Selected by Oren'), false);
});

test('no holdings and no recent news have distinct honest empty states', () => {
  assert.ok(fixture({ feed: { ...baseFeed, items: [], state: 'no_holdings' } }).renderFeed().includes('No stock holdings yet'));
  assert.ok(fixture({ feed: { ...baseFeed, items: [], state: 'no_news' } }).renderFeed().includes('No recent stories'));
});

test('failed refresh shows a retry without mislabeling old stories as a successful new feed', () => {
  const html = fixture({ error: true }).renderFeed();
  assert.match(html, /role="alert"/);
  assert.ok(html.includes('News could not load'));
  assert.equal(html.includes(story.headline), false);
});

test('wallet setup failures explain the problem and expose an explicit retry while trending stays available', () => {
  let retries = 0;
  const view = fixture({ auth: { ready: true, authenticated: true, error: 'Wallet setup failed', createWallet: async () => { retries++; } } });
  function retry(node) {
    if (!isValidElement(node)) return;
    if (typeof node.props.onClick === 'function' && node.props.children === 'Retry wallet setup') return node;
    for (const child of Children.toArray(node.props.children)) { const found = retry(child); if (found) return found; }
  }
  retry(view.ExplorePage()).props.onClick();
  assert.equal(retries, 1);
  const html = view.renderPage();
  assert.match(html, /role="alert"/);
  assert.ok(html.includes('Wallet setup failed'));
  assert.ok(html.includes('Retry wallet setup'));
  assert.ok(view.renderPage('trending').includes(story.headline));
});

test('signed-out view hides private stories and provides a route to public trending', () => {
  const view = fixture({ auth: { ready: true, authenticated: false } });
  const html = renderToStaticMarkup(createElement(view.ExplorePage));
  assert.ok(html.includes('Your portfolio has a story.'));
  assert.ok(html.includes('Browse trending'));
  assert.equal(html.includes(story.headline), false);
});

test('changing the signed-in account or wallet remounts the personalized feed; sign-out removes it', () => {
  const view = fixture();
  function find(node) {
    if (!isValidElement(node)) return;
    if (node.type === view.NewsFeedSection) return node;
    for (const child of Children.toArray(node.props.children)) { const found = find(child); if (found) return found; }
  }
  const before = find(view.ExplorePage()).key;
  view.auth.address = 'other-wallet';
  assert.notEqual(find(view.ExplorePage()).key, before);
  view.auth.authenticated = false;
  assert.equal(find(view.ExplorePage()), undefined);
});

test('Ask Oren uses the current wallet, article source and news page context and refuses concurrent sends', () => {
  function button(node) {
    if (!isValidElement(node)) return;
    if (node.type === 'button') return node;
    for (const child of Children.toArray(node.props.children)) { const found = button(child); if (found) return found; }
  }
  const view = fixture();
  button(view.StoryRow({ story, personal: true, featured: true })).props.onClick();
  assert.equal(view.calls[0][0], 'open');
  assert.equal(view.calls[1][0], 'send');
  assert.ok(view.calls[1][1].includes(story.url));
  assert.equal(view.calls[1][2], 'wallet');
  assert.equal(view.calls[1][3].page, 'explore');
  const locked = fixture({ busy: true });
  button(locked.StoryRow({ story, personal: true, featured: true })).props.onClick();
  assert.equal(locked.calls.length, 0);
});
