import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mcpEnrollmentLinks } from '../services/mcp-enrollment-flow.ts';

const require = createRequire(import.meta.url);
function settingsLinks(pathname, connection) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../components/settings/settings-panel.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require(id) {
    if (id === 'next/navigation') return { usePathname: () => pathname };
    if (id === 'next/link') return { default: ({ children, ...props }) => createElement('a', props, children) };
    if (id === 'lucide-react') return new Proxy({}, { get: () => () => null });
    if (id === '@/components/ui') return { cn: (...args) => args.filter(Boolean).join(' ') };
    if (id === '@/services/mcp-enrollment-flow') return { mcpEnrollmentLinks };
    return require(id);
  } });
  return renderToStaticMarkup(createElement(exports.SettingsLinks, { connection }));
}

test('settings has one active section and keeps a pending connection across every section', () => {
  for (const section of ['', '/preferences', '/connections']) {
    const html = settingsLinks(`/app/settings${section}`, 'pending_42');
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
    assert.match(html, new RegExp(`aria-current="page"[^>]+href="/app/settings${section}\\?connection=pending_42"`));
    for (const target of ['', '/preferences', '/connections']) assert.ok(html.includes(`href="/app/settings${target}?connection=pending_42"`));
  }
});

test('settings navigation never copies an untrusted return target into its links', () => {
  for (const value of [undefined, 'https://evil.example', '../other', 'a?connection=b', 'x'.repeat(201)]) {
    const html = settingsLinks('/app/settings', value);
    assert.doesNotMatch(html, /\?connection=/);
    assert.match(html, /href="\/app\/settings\/connections"/);
  }
});
