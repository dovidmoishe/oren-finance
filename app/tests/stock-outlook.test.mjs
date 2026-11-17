import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { filterStockNews } from '../services/stock-news.ts';
import * as utils from '../components/ui/utils.ts';

const stock = { assetId: 'take-two-interactive', ticker: 'TTWO', name: 'Take-Two Interactive' };
const item = (headline, extra = {}) => ({ id: headline, headline, publishedAt: '2026-11-14T12:00:00Z', ...extra });

test('stock news rejects partial company-name matches and retains explicit stock coverage', () => {
  const irrelevant = item('XRP price prediction — These TWO factors can help altcoin reclaim $1.2-level');
  const relevant = [item('TTWO reports earnings'), item('Take Two Interactive announces results'), item('New release', { ticker: 'ttwo' }), item('New filing', { assetId: stock.assetId })];
  assert.deepEqual(filterStockNews([irrelevant, ...relevant], stock), relevant);
  assert.equal(filterStockNews([item('TTWOX reports results'), item('Interactive markets take off')], stock).length, 0);
});

function loadOutlook() {
  const exports = {};
  const require = createRequire(import.meta.url);
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../components/stock/stock-market-outlook.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require(id) {
    if (id === '@/components/stock/technical-brief-panel') return { TechnicalBriefPanel: () => null };
    if (id === '@/components/ui/utils') return utils;
    if (id === '@/services/stock-news') return { filterStockNews };
    return require(id);
  } });
  return exports.StockMarketOutlook;
}
const Outlook = loadOutlook();

test('outlook keeps deterministic metrics, bounds its score and omits unrelated news', () => {
  const analysis = { opportunityScore: 120, signals: { momentum7d: 8.84, volatility30d: 2.27 }, highlights: [], analyzedAt: '2026-11-14T12:00:00Z', riskLabel: 'moderate' };
  const html = renderToStaticMarkup(createElement(Outlook, { stock, analysis, news: [item('XRP TWO factors')] }));
  for (const label of ['Market outlook', '+8.84%', '2.27%', 'No recent coverage.', 'View technical details']) assert.ok(html.includes(label), label);
  assert.match(html, /role="meter"/);
  assert.match(html, /aria-valuenow="100"/);
  assert.doesNotMatch(html, /XRP TWO factors/);
});

test('unavailable analysis has no invented score and unsafe news links are not clickable', () => {
  const html = renderToStaticMarkup(createElement(Outlook, { stock, news: [item('TTWO earnings', { url: 'javascript:alert(1)' })] }));
  assert.match(html, /Analysis is currently unavailable/);
  assert.match(html, /TTWO earnings/);
  assert.doesNotMatch(html, /role="meter"|javascript:|NaN/);
});
