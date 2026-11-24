import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
function loadLocal(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, URL, require(id) {
    if (id === './agent-markdown') return loadLocal('../components/agent/agent-markdown.ts');
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime');
    return require(id);
  } });
  return exports;
}
function loadComponent(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, URL, require(id) {
    if (id === './agent-artifacts') throw new Error('Paused artifact UI must not load');
    if (id === './agent-conversation') return {
      AgentConversationThread: () => createElement('div', { 'data-thread': true }, 'Conversation'),
      AgentComposer: () => createElement('div', { 'data-composer': true }, 'Composer'),
    };
    if (id === './agent-composer-view') return {};
    if (id === './agent-utils') return { toolLabel: () => 'Running Oren analysis' };
    if (id === './agent-message-body') return loadLocal('../components/agent/agent-message-body.tsx');
    if (id === './agent-markdown') return loadLocal('../components/agent/agent-markdown.ts');
    if (id === '@/components/ui') return { cn: (...values) => values.filter(Boolean).join(' ') };
    if (id === '@/components/auth/auth-context') return {};
    if (id === 'lucide-react') return new Proxy({}, { get: () => () => null });
    if (id === '@/components/ui/interface-icon') return { InterfaceIcon: () => null };
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime');
    return require(id);
  } });
  return exports;
}

const { AgentMessage } = loadComponent('../components/agent/agent-conversation.tsx');
const { AgentWorkspace } = loadComponent('../components/agent/agent-workspace.tsx');
const artifacts = [{ type: 'analysis', data: { ticker: 'SPCX' } }];
const base = { id: 'assistant-1', role: 'assistant', content: '', artifacts };
const markup = (message) => renderToStaticMarkup(createElement(AgentMessage, { message }));

test('tool results stay hidden before and during text streaming in chat and workspace', () => {
  for (const content of ['', 'SPCX is range-bound']) {
    const message = { ...base, content, streaming: true };
    const html = markup(message);
    assert.doesNotMatch(html, /data-artifacts/);
    assert.match(html, content ? /SPCX is range-bound/ : /Oren is thinking/);
  }
});

test('completed and restored responses keep answer text while artifacts are paused', () => {
  for (const streaming of [false, undefined]) {
    const message = { ...base, content: 'SPCX is range-bound.', streaming };
    const html = markup(message);
    assert.match(html, /SPCX is range-bound/);
    assert.doesNotMatch(html, /data-artifacts|Analysis card/);
  }
});

test('stopped or failed responses do not suddenly reveal buffered cards', () => {
  const message = { ...base, content: 'Partial answer', streaming: false, interrupted: true };
  assert.doesNotMatch(markup(message), /data-artifacts/);
  assert.match(markup(message), /Stopped before completion/);
});

test('expanded chat retains conversation and composer without a working-set rail', () => {
  for (const messages of [[], [{ ...base, content: 'Previous answer' }]]) {
    const html = renderToStaticMarkup(createElement(AgentWorkspace, { messages }));
    assert.match(html, /data-thread/);
    assert.match(html, /data-composer/);
    assert.doesNotMatch(html, /<aside|Working set|Page context|data-artifacts/);
  }
});
