import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = new URL('../components/trading/quote-review-modal.tsx', import.meta.url);
const sourceRequire = createRequire(source);
const english = JSON.parse(readFileSync(new URL('../i18n/messages/en.json', import.meta.url), 'utf8'));
function render(coverage) {
  const exports = {};
  const quote = { id: 'quote', side: 'buy', ticker: 'STOCK', provider: 'jupiter', inputAmount: 10,
    outputAmount: 1, inputSymbol: 'USDC', outputSymbol: 'STOCK', slippageBps: 50, estimatedPriceUsd: 10, priceImpactPercent: 0 };
  const modules = {
    '@/services/environment': { financialExecutionEnabled: true },
    '@/services/route-label': { routeVenueLabel: () => 'Jupiter' },
    '@/hooks/use-approval-review': { useApprovalReview: () => ({ approval: { id: 'approval', status: 'prepared',
      feeLamports: '5000', details: { quote, ataRentSponsored: coverage } }, secondsLeft: 30 }) },
    '@/i18n/i18n': { useI18n: () => ({ locale: 'en', t: key => key.split('.').reduce((value, part) => value?.[part], english) ?? key }) },
    '@/components/ui': {
      Modal: ({ children }) => React.createElement('main', null, children),
      Button: ({ children, disabled, onClick }) => React.createElement('button', { disabled, onClick }, children),
      Toast: () => null, formatCurrency: value => '$' + value, formatNumber: value => String(value),
    },
    './market-session-notice': { MarketSessionNotice: () => null },
    './price-moved-review': { PriceMovedReview: () => null },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports, require(id) { return id in modules ? modules[id] : sourceRequire(id); } });
  return renderToStaticMarkup(React.createElement(exports.QuoteReviewModal,
    { open: true, quote, status: 'quoted', onClose() {}, async onSign() {} }));
}
test('review displays confirmed ATA setup coverage alongside the existing network fee', () => {
  const html = render(true);
  assert.match(html, /Account setup/);
  assert.match(html, /Covered by Oren/);
  assert.match(html, /0\.000005 SOL/);
});
test('review never claims setup coverage for omitted, failed, or untrusted flags', () => {
  for (const coverage of [undefined, false, 'true']) {
    const html = render(coverage);
    assert.doesNotMatch(html, /Account setup|Covered by Oren/);
    assert.match(html, /0\.000005 SOL/);
  }
});
