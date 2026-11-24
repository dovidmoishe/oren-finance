import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function fixture(walletKind, scope = 'oren.read oren.trade.prepare') {
  const auth = { ready: true, configured: true, authenticated: true, address: 'wallet', walletKind };
  let calls = 0;
  let states;
  const reset = () => { states = [{ scope, callbackUrl: 'https://example.com/callback', callbackDestination: 'example.com' }, undefined, false, false, false, undefined, undefined]; };
  reset();
  const exports = {};
  const mocks = {
    react: { ...React, useEffect() {}, useState: () => [states.shift(), () => {}] },
    '@/components/auth/auth-context': { useOrenAuth: () => auth },
    '@/services/mcp-api-origin': { mcpApiOrigin: () => 'https://api.example.com' },
    '@/services/mcp-connector': { mcpConnector: () => undefined },
    '@/services/mcp-enrollment-flow': { mcpEnrollmentLinks: () => ({ settings: '/app/settings?mcp=resume' }) },
    '@/components/brand/oren-logo': { OrenLogo: () => null },
    '@/components/ui': { formatDateTime() {}, formatNumber: String },
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    'next/image': { default: () => null },
  };
  const code = ts.transpileModule(readFileSync(new URL('../app/connect/mcp/mcp-connect.tsx', import.meta.url), 'utf8') + '\nexport { McpConnection };', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: id => id in mocks ? mocks[id] : require(id), fetch: () => { calls++; throw new Error('Unexpected network call'); } });
  return { render() { reset(); return renderToStaticMarkup(React.createElement(exports.McpConnection, { uid: 'interaction' })); }, tree() { reset(); return exports.McpConnection({ uid: 'interaction' }); }, get calls() { return calls; } };
}
function connectionButton(node) {
  if (!React.isValidElement(node)) return;
  if (node.type === 'button' && React.Children.toArray(node.props.children).includes('Allow connection')) return node;
  for (const child of React.Children.toArray(node.props.children)) { const found = connectionButton(child); if (found) return found; }
}

test('external-wallet consent explains embedded-wallet eligibility and blocks submission before fetching', () => {
  const f = fixture('external');
  const html = f.render();
  assert.ok(html.includes('Agent connections currently require an Oren embedded wallet'));
  assert.ok(html.includes('/app/settings?mcp=resume'));
  const button = connectionButton(f.tree());
  assert.equal(button.props.disabled, true);
  button.props.onClick();
  assert.equal(f.calls, 0);
});

test('embedded wallets retain read/prepare consent and external wallets do not wait for trading limits', () => {
  assert.equal(connectionButton(fixture('embedded').tree()).props.disabled, false);
  const html = fixture('external', 'oren.read oren.trade.execute').render();
  assert.equal(html.includes('Checking your trading limits'), false);
});
