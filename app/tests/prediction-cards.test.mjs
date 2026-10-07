import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
let connected = true;
const prepared = [];
const source = readFileSync(new URL('../components/predictions/prediction-cards.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exports = {};
new Function('require', 'exports', compiled)((name) => {
  if (name === '@solana/wallet-adapter-react') return { useWallet: () => ({ connected }) };
  if (name === '@/store') return { useAgentStore: (select) => select({ prefillPrompt: (prompt) => prepared.push(prompt) }) };
  if (name === '@/components/ui') return { Button: (props) => React.createElement('button', props) };
  if (name === 'next/link') return { default: (props) => React.createElement('a', props) };
  return require(name);
}, exports);

const market = {
  marketId: 'fixture-event', title: 'Nvidia event', category: 'finance', phase: 'secondary',
  relevance: { reason: 'Names NVDA' }, source: { stale: true, observedAt: '2026-10-07T10:00:00Z' },
  outcomes: [{ side: 'YES', priceUsdc: '1.250000000001' }, { side: 'NO', priceUsdc: null }],
  endTime: null, resolutionTime: null, resolutionRule: null, sourcesOfTruth: null,
};

test('fixture cards preserve decimal prices, missing contract fields and attribution', () => {
  const html = renderToStaticMarkup(React.createElement(exports.PredictionCard, { market, detail: true }));
  for (const text of ['1.250000000001 USDC/share', 'Price unavailable', 'Unavailable from Panta', 'Stale data', 'Powered by', 'prices are not win probabilities']) assert.ok(html.includes(text), text);
  assert.ok(html.includes('https://www.panta.market/market/fixture-event'));
});

test('research action prepares an explicit prompt without submitting it and respects wallet gating', () => {
  connected = true;
  exports.ResearchButton({ market }).props.onClick();
  assert.equal(prepared.length, 1);
  assert.ok(prepared[0].includes('fixture-event: Nvidia event'));
  connected = false;
  assert.equal(exports.ResearchButton({ market }).props.disabled, true);
  connected = true;
});

test('restored brief renders original citations, unknown publication dates and warnings', () => {
  const brief = { market, status: 'researched', generatedAt: '2026-10-07T10:00:00Z', summary: 'Cited event', supporting: [{ text: 'Evidence', sourceIds: ['s1'] }], counterarguments: [], portfolioRelevance: [], uncertainty: [], unresolvedQuestions: [], warnings: ['Rules unavailable'], sources: [{ id: 's1', url: 'https://www.sec.gov/fixture', title: 'Filing', publishedAt: null, retrievedAt: '2026-10-07T09:00:00Z', kind: 'official' }] };
  const html = renderToStaticMarkup(React.createElement(exports.PredictionBrief, { brief }));
  assert.ok(html.includes('https://www.sec.gov/fixture'));
  assert.ok(html.includes('date unavailable'));
  assert.ok(html.includes('Rules unavailable'));
});
