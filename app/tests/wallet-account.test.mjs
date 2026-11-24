import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function fixture(override = {}) {
  let links = 0, reconnects = 0, walletLinks = 0;
  const auth = { ready: true, configured: true, authenticated: true, userId: 'alice',
    address: '11111111111111111111111111111111', walletKind: 'external', walletConnected: false,
    wallets: [{ address: '11111111111111111111111111111111', label: 'Phantom' }],
    linkEmail() { links++; }, connectWallet() { reconnects++; }, linkWallet() { walletLinks++; }, ...override };
  const Button = props => createElement('button', props);
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../components/settings/account-settings.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require(id) {
    if (id === '@/components/auth/auth-context') return { useOrenAuth: () => auth };
    if (id === '@/components/auth/restore-actions') return { restoreBlocked: () => false };
    if (id === '@/components/language/language-menu') return { LanguageMenu: () => null };
    if (id === '@/components/ui') return { Button };
    if (id === '@/i18n/locales') return { LOCALES: [{ code: 'en', name: 'English' }] };
    return require(id);
  } });
  return { html: () => renderToStaticMarkup(createElement(exports.AccountSettings)), tree: () => exports.AccountSettings(),
    counts: () => [links, reconnects, walletLinks], Button };
}
function elements(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(elements)];
}

test('wallet-only accounts offer email linking and reconnect without requiring another signup', () => {
  const app = fixture();
  const html = app.html();
  assert.match(html, /No email linked/);
  assert.match(html, /Notifications stay off/);
  assert.match(html, /Add email/);
  assert.match(html, /Reconnect wallet/);
  assert.match(html, /Link another wallet/);
  for (const button of elements(app.tree()).filter(node => node.type === app.Button &&
    ['Add email', 'Reconnect wallet', 'Link another wallet'].includes(node.props.children))) button.props.onClick();
  assert.deepEqual(app.counts(), [1, 1, 1]);
});

test('linked email and connected wallets replace the linking and reconnect prompts', () => {
  const html = fixture({ email: 'linked@example.test', walletConnected: true }).html();
  assert.match(html, /linked@example.test/);
  assert.doesNotMatch(html, /Add email|Reconnect wallet|No email linked/);
});

test('multiple linked wallets expose an explicit selector with both addresses', () => {
  const html = fixture({ wallets: [{ address: 'external', label: 'Phantom' }, { address: 'embedded', label: 'Privy' }], address: 'external' }).html();
  assert.match(html, /<select/);
  assert.match(html, /Phantom/); assert.match(html, /Privy/);
  assert.match(html, /value="external" selected/);
});
