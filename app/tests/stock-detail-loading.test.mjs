import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const messages = JSON.parse(readFileSync(new URL('../i18n/messages/en.json', import.meta.url), 'utf8'));
const t = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), key.split('.').reduce((value, name) => value?.[name], messages) ?? key);
const stock = { assetId: 'spacex', name: 'SpaceX', ticker: 'SPCX', logoUrl: 'https://example.com/spacex.png', variants: [] };

function render(state = {}) {
  const exports = {};
  const defaults = { chart: [], news: [], loadStock() {}, loadChart() {}, reset() {} };
  const source = ts.transpileModule(readFileSync(new URL('../components/stock/stock-detail.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require(id) {
    if (id === 'lucide-react') return new Proxy({}, { get: () => () => null });
    if (id === 'next/link') return { default: props => createElement('a', props) };
    if (id === '@/store') return { useStockStore: selector => selector({ ...defaults, ...state }) };
    if (id === '@/i18n/i18n') return { useI18n: () => ({ locale: 'en', t }) };
    if (id === '@/components/ui') return {
      Skeleton: () => createElement('div', { role: 'status' }, 'Loading stock'),
      ErrorState: ({ title, description }) => createElement('div', { role: 'alert' }, title, description),
      Button: props => createElement('button', props), cn: (...values) => values.filter(Boolean).join(' '), formatRelativeTime: () => 'just now',
    };
    if (id === '@/components/charts') return { MarketChart: ({ symbolLogo }) => createElement('section', {}, symbolLogo) };
    if (id === '@/components/markets/market-stock-logo') return { MarketStockLogo: ({ stock }) => createElement('img', { src: stock.logoUrl, alt: `${stock.name} logo` }) };
    if (id.startsWith('@/components/')) return new Proxy({}, { get: () => () => null });
    return require(id);
  } });
  return renderToStaticMarkup(createElement(exports.StockDetail, { assetId: 'spacex' }));
}

test('first render and route transitions show loading before effects start', () => {
  for (const state of [
    { isLoading: false },
    { requestedAssetId: 'spacex', isLoading: true },
    { requestedAssetId: 'nvidia', selected: { ...stock, assetId: 'nvidia', name: 'NVIDIA' } },
    { requestedAssetId: 'nvidia', error: 'Previous stock failed', isLoading: false },
  ]) {
    const html = render(state);
    assert.ok(html.includes('Loading stock'));
    assert.ok(!html.includes('Stock unavailable'));
    assert.ok(!html.includes('NVIDIA'));
  }
});

test('a failed current-stock request still shows the actual error', () => {
  const html = render({ requestedAssetId: 'spacex', isLoading: false, error: 'Provider unavailable' });
  assert.ok(html.includes('Stock unavailable'));
  assert.ok(html.includes('Provider unavailable'));
  assert.ok(!html.includes('Loading stock'));
});

test('a loaded stock passes its logo to the chart header', () => {
  const html = render({ requestedAssetId: 'spacex', selected: stock, isLoading: false });
  assert.ok(html.includes('SpaceX'));
  assert.ok(html.includes('src="https://example.com/spacex.png"'));
  assert.ok(html.includes('alt="SpaceX logo"'));
  assert.ok(!html.includes('Stock unavailable'));
});
