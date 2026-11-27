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
    if (id === '@/components/ui/states') return { Skeleton: ({ className }) => createElement('div', { className }) };
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
  for (const label of ['Market outlook', '+8.84%', '2.27%', 'No matching stories available from the connected feed.', 'View technical details']) assert.ok(html.includes(label), label);
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

test('pending stock news reserves the loaded card padding and desktop columns', () => {
  const render = props => renderToStaticMarkup(createElement(Outlook, { stock, news: [], ...props }));
  const loading = render({ newsLoading: true });
  const loaded = render({ news: [item('TTWO earnings')] });
  const asideClass = html => html.match(/<aside[^>]+class="([^"]+)"/)[1];
  const gridClass = html => html.match(/<div class="(grid[^\"]*)"/)[1];
  assert.equal(asideClass(loading), asideClass(loaded));
  assert.equal(gridClass(loading), gridClass(loaded));
  assert.ok(gridClass(loading).includes('@3xl/outlook:grid-cols-'));
  assert.match(loading, /<aside[^>]+aria-busy="true"/);
  assert.equal((loading.match(/class="py-3 first:pt-0 last:pb-0"/g) ?? []).length, 3);
  assert.equal((loading.match(/class="h-12 w-full"/g) ?? []).length, 3);
  assert.doesNotMatch(loading, /No matching stories/);
  assert.match(loaded, /TTWO earnings/);
  assert.doesNotMatch(loaded, /role="status"/);
  const empty = render({ news: [item('Unrelated story')] });
  assert.match(empty, /No matching stories available/);
  assert.match(asideClass(empty), /flex flex-wrap items-center/);
  assert.doesNotMatch(gridClass(empty), /grid-cols-/);
});
