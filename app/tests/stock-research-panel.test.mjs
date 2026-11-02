import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);

test('stock research renders distinct evidence, sources, saved thesis and changes', () => {
  const report = {
    assetId: 'nvda', ticker: 'NVDA', name: 'NVIDIA',
    analysis: { available: true, observedAt: '2026-11-02', data: { summary: 'Range bound.', opportunityScore: 64 } },
    news: { available: true, data: [{ id: 'news-1', headline: 'Chip demand rises', url: 'https://example.com/news', publishedAt: '2026-11-01' }] },
    portfolio: { available: true, data: { allocationPercent: 12 } },
    opinions: { available: true, observedAt: '2026-11-02', data: { items: [{ author: 'Alice', source: 'Daily Tape', date: '2026-11-01', url: 'https://example.com/view', stance: 'BULLISH', action: 'ADD', summary: 'Demand is strong.' }], window: { from: '2026-10-01', to: '2026-11-01' }, mentionCount: 2, distinctAuthors: 1, coverage: 'thin', disagreement: false } },
    saved: { note: 'Watch valuation.', snapshot: { capturedAt: '2026-11-01', opinionCitations: [{ author: 'Alice', source: 'Daily Tape', date: '2026-11-01', url: 'https://example.com/view' }], newsCitations: [] } },
    changes: [{ kind: 'score', text: 'Oren Score rose 5 points.' }],
  };
  let state = 0;
  const values = [report, 'owned', 'Watch valuation.', false, false, undefined];
  const react = { useState() { return [values[state++], () => {}]; }, useRef: () => ({ current: 0 }), useEffect() {}, useCallback: (fn) => fn };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../components/stock/stock-research.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, setTimeout, clearTimeout, require(id) {
    if (id === 'react') return react;
    if (id === '@/components/auth/auth-context') return { useOrenAuth: () => ({ address: 'owned', getAccessToken: async () => 'token' }) };
    if (id === '@/services/research-service') return {};
    return require(id);
  } });
  const html = renderToStaticMarkup(require('react').createElement(exports.StockResearchPanel, { assetId: 'nvda' }));
  for (const label of ['Oren read', 'Recent cited news', 'Chip demand rises', 'Covered', 'Writer views', 'Where they disagree', 'Your view', 'What changed', 'View saved sources']) assert.ok(html.includes(label), label);
  assert.ok(html.includes('https://example.com/view'));
  assert.ok(html.includes('lg:grid-cols-2'));
  assert.ok(html.includes('Watch valuation.'));
});
