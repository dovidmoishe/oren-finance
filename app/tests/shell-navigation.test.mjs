import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);

function navigationAt(desktop) {
  const changes = [];
  let dismissed = 0;
  const navigation = () => null;
  const store = { panelOpen: true, hydrated: true, expanded: false, setPanelOpen: (open) => changes.push(open) };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../components/shell/app-shell.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, window: { matchMedia: () => ({ matches: desktop }) }, require(id) {
    if (id === 'react') return {
      useEffect() {}, useId: () => 'navigation', useState: (value) => [value, () => {}],
      useRef: () => ({ current: { hidePopover: () => dismissed++ } }),
    };
    if (id === 'react/jsx-runtime') return require(id);
    if (id === 'next/navigation') return { usePathname: () => '/app' };
    if (id === 'next/dynamic') return { default: () => () => null };
    if (id === '@/components/auth/auth-context') return { useOrenAuth: () => ({ depositOpen: false }) };
    if (id === '@/store/agent-store') return { useAgentStore: (select) => select(store) };
    if (id === '@/store/wallet-store') return { useWalletStore: (select) => select({}) };
    if (id === '@/i18n/i18n') return { useT: () => (key) => key };
    if (id === '@/components/ui') return { cn: (...values) => values.filter(Boolean).join(' ') };
    if (id === './navigation-link') return { NavigationLink: navigation };
    if (id === './copilot-resize-handle') return { MAX_COPILOT_WIDTH: 560, MIN_COPILOT_WIDTH: 304 };
    return new Proxy({}, { get: () => () => null });
  } });
  const links = [];
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    if (node.type === navigation) links.push(node.props);
    visit(node.props?.children);
  }
  visit(exports.AppShell({ children: null }));
  return { links, changes, dismissed: () => dismissed };
}

test('mobile navigation closes the copilot so every destination is visible', () => {
  const state = navigationAt(false);
  for (const href of ['/app/markets', '/app/explore', '/app/settings']) {
    state.links.find((link) => link.href === href).onNavigate();
  }
  assert.deepEqual(state.changes, [false, false, false]);
  assert.equal(state.dismissed(), 3);
  assert.equal(state.links.some((link) => link.href === '/app/activity'), false);
});

test('desktop navigation keeps the docked copilot open', () => {
  const state = navigationAt(true);
  state.links.find((link) => link.href === '/app/markets').onNavigate();
  assert.deepEqual(state.changes, []);
  assert.equal(state.dismissed(), 1);
});
