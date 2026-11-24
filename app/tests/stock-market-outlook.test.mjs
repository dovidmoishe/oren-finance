import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const exports = {};
const code = ts.transpileModule(readFileSync(new URL('../components/stock/stock-market-outlook.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
vm.runInNewContext(code, { exports, require(id) {
  if (id === 'lucide-react') return new Proxy({}, { get: () => () => null });
  if (id === '@/services/stock-news') return { filterStockNews: items => items };
  if (id === '@/components/stock/technical-brief-panel') return { TechnicalBriefPanel: () => null };
  if (id === '@/components/ui/utils') return {
    formatPercent: (n, _locale, signed = true) => `${signed && n >= 0 ? '+' : ''}${n.toFixed(2)}%`,
    cn: (...values) => values.filter(Boolean).join(" "), formatNumber: String, formatCurrency: String, formatRelativeTime: () => 'just now',
  };
  return require(id);
} });
const analysis = {
  opportunityScore: 46.31, riskLabel: 'high', signals: { momentum7d: 2.222222, volatility30d: 7.111015 },
  technicalBrief: { regime: 'downtrend', risks: ['Elevated daily ATR versus price.'] }, highlights: [],
};
function render(change24hPct, data = analysis, news = []) {
  return renderToStaticMarkup(require('react').createElement(exports.StockMarketOutlook, {
    stock: { assetId: 'nvidia', name: 'NVIDIA', ticker: 'NVDA', change24hPct }, analysis: data, news,
  }));
}
test('daily rally is distinct from the moving-average downtrend and seven-bar momentum', () => {
  const html = render(22.764914);
  for (const text of ['up 22.76% over the past 24 hours', 'longer-term technical trend is downtrend', '7-bar momentum', '+2.22%', '30-bar daily volatility', 'No matching stories available from the connected feed.']) assert.ok(html.toLowerCase().includes(text.toLowerCase()), text);
  assert.ok(!html.includes('over the past week'));
  assert.ok(!html.includes('No recent coverage.'));
});
test('missing daily price change is unavailable rather than zero or weekly return', () => {
  const html = render(undefined);
  assert.ok(html.includes('longer-term technical trend'));
  assert.ok(html.includes('@container/outlook'));
  assert.ok(html.includes('role="meter"'));
  assert.ok(html.includes('Unavailable'));
  assert.ok(!html.includes('over the past 24 hours'));
});
test('negative and zero daily changes retain their correct direction and value', () => {
  assert.ok(render(-4).includes('down 4.00% over the past 24 hours'));
  assert.ok(render(0).includes('up 0.00% over the past 24 hours'));
});
test('stories remain visible and unavailable analysis keeps its fallback', () => {
  assert.ok(render(24, null).includes('Analysis is currently unavailable.'));
  const html = render(24, analysis, [{ id: 'news', headline: 'NVIDIA reinstates CEO', publishedAt: '2026-11-23' }]);
  assert.ok(html.includes('NVIDIA reinstates CEO'));
  assert.ok(!html.includes('No matching stories'));
});
