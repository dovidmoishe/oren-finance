import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { Children, isValidElement } from 'react';

const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: id => id in mocks ? mocks[id] : require(id) });
  return exports;
}
const utils = load('../components/agent/agent-utils.ts');
function find(node, type) {
  if (!isValidElement(node)) return;
  if (node.type === type) return node;
  for (const child of Children.toArray(node.props.children)) {
    const result = find(child, type);
    if (result) return result;
  }
}

test('page context recognizes investing routes and never labels settings as a portfolio', () => {
  for (const path of ['/app', '/app/portfolio', '/app/overview']) assert.equal(utils.pageContext(path).page, 'dashboard');
  for (const page of ['markets', 'vault', 'activity', 'calendar', 'leaderboard']) assert.equal(utils.pageContext(`/app/${page}`).page, page);
  assert.equal(utils.pageContext('/app/stocks/stock%3Anvda').assetId, 'stock:nvda');
  for (const path of ['/app/settings', '/app/settings/preferences', '/app/settings/connections', '/app/stocks/%ZZ', '/application', '/app/markets-extra']) {
    assert.equal(utils.pageContext(path), undefined);
  }
});

test('stock labels only use data belonging to the current route', () => {
  const stock = { assetId: 'aapl', ticker: 'AAPL' };
  assert.equal(utils.contextTicker({ page: 'stock', assetId: 'aapl' }, stock), 'AAPL');
  assert.equal(utils.contextTicker({ page: 'stock', assetId: 'nvda' }, stock), undefined);
  assert.equal(utils.contextTicker({ page: 'markets' }, stock), undefined);
  assert.equal(utils.contextTicker({ page: 'stock' }), undefined);
});

function panelFixture() {
  let pathname = '/app/stocks/aapl';
  const stock = { selected: { assetId: 'aapl', ticker: 'AAPL' } };
  const requests = [];
  const state = { panelOpen: true, expanded: false, hydrated: true, messages: [], recentThreads: [], sendMessage: async (...args) => requests.push(args) };
  const slots = [];
  let cursor = 0;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef: () => ({ current: null }), useMemo: fn => fn(), useCallback: fn => fn, useEffect() {},
  };
  const { AgentPanel } = load('../components/agent/agent-panel.tsx', {
    react: hooks,
    'next/navigation': { usePathname: () => pathname },
    'lucide-react': new Proxy({}, { get: () => () => null }),
    '@solana/wallet-adapter-react': { useWallet: () => ({ connected: true, publicKey: { toBase58: () => 'wallet' } }) },
    '@/components/auth/wallet-modal-context': { useWalletModal: () => ({ setVisible() {} }) },
    '@/components/ui': { cn: (...args) => args.filter(Boolean).join(' '), Button: 'button' },
    '@/components/ui/interface-icon': {}, '@/components/brand/oren-logo': { OrenLogo: 'logo' },
    '@/store': { useAgentStore: select => select(state), useStockStore: select => select(stock), usePortfolioStore: select => select({}) },
    './agent-utils': utils,
    './agent-view-context': { AgentViewContext: 'view-context' },
    './agent-action-review': { AgentActionReview: 'review' },
    './agent-conversation': { AgentConversationThread: 'conversation', AgentComposer: 'composer', ConversationHistory: 'history' },
    './agent-workspace': { AgentWorkspace: 'workspace', latestAssistantArtifacts: () => [] },
  });
  return { requests, state, stock, navigate: value => { pathname = value; }, render() { cursor = 0; return AgentPanel(); } };
}

test('docked and expanded copilot submit the current page and respect the context switch', async () => {
  const f = panelFixture();
  let tree = f.render();
  assert.equal(find(tree, 'view-context').props.ticker, 'AAPL');
  await find(tree, 'conversation').props.onPrompt('Explain this stock');
  assert.equal(f.requests.at(-1)[2].assetId, 'aapl');

  f.navigate('/app/stocks/nvda');
  tree = f.render();
  assert.equal(find(tree, 'view-context').props.ticker, undefined);
  assert.ok(find(tree, 'conversation').props.prompts.every(prompt => !prompt.includes('AAPL')));
  await find(tree, 'conversation').props.onPrompt('What about this one?');
  assert.equal(f.requests.at(-1)[2].assetId, 'nvda');
  assert.equal(f.requests[0][2].assetId, 'aapl');

  find(tree, 'view-context').props.onToggle();
  f.state.expanded = true;
  tree = f.render();
  assert.equal(find(tree, 'workspace').props.context, undefined);
  await find(tree, 'workspace').props.onPrompt('General question');
  assert.equal(f.requests.at(-1)[2], undefined);

  find(tree, 'view-context').props.onToggle();
  f.navigate('/app/settings/connections');
  tree = f.render();
  assert.equal(find(tree, 'view-context').props.context, undefined);
  await find(tree, 'workspace').props.onPrompt('Help me');
  assert.equal(f.requests.at(-1)[2], undefined);
});
