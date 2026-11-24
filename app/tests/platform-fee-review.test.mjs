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
function render(platformFee, minimumOutputAmount) {
  const exports = {};
  const quote = { id: 'quote', side: 'buy', ticker: 'STOCK', provider: 'jupiter', inputAmount: 10,
    outputAmount: 1, inputSymbol: 'USDC', outputSymbol: 'STOCK', slippageBps: 50, estimatedPriceUsd: 10, priceImpactPercent: 0 };
  quote.platformFee = platformFee;
  quote.minimumOutputAmount = minimumOutputAmount;
  const modules = {
    '@/services/environment': { financialExecutionEnabled: true },
    '@/services/route-label': { routeVenueLabel: () => 'Jupiter' },
    '@/hooks/use-approval-review': { useApprovalReview: () => ({ approval: { id: 'approval', status: 'prepared',
      feeLamports: '5000', details: { quote } }, secondsLeft: 30 }) },
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
test('review renders the approved Oren USDC fee and its percentage', () => {
  const html = render({ bps: 50, amountRaw: '50000', mint: 'USDC' });
  assert.match(html, /Oren fee/);
  assert.match(html, /0.5%.*\$0.05 USDC/);
});
test('review hides absent and zero Oren fees', () => {
  for (const fee of [undefined, null, { bps: 0, amountRaw: '0', mint: 'USDC' }])
    assert.doesNotMatch(render(fee), /Oren fee/);
});
test('review shows the server net minimum when the provider threshold differs', () => {
  assert.match(render({ bps: 50, amountRaw: '1', mint: 'USDC' }, 0.98), /0.98 STOCK/);
});

function renderBasket(platformFee) {
  const file = new URL('../components/trading/basket-review.tsx', import.meta.url);
  const exports = {};
  const div = ({ children }) => React.createElement('div', null, children);
  const modules = {
    '@/components/ui': { Card: div, CardHeader: div, CardContent: div, cn: () => '',
      formatCurrency: value => '$' + value, formatNumber: value => String(value) },
    '@/components/stock/stock-logo': { StockLogo: () => null },
    './market-session-notice': { MarketSessionNotice: () => null },
    '@/i18n/i18n': { useI18n: () => ({ locale: 'en', t: key => key.split('.').reduce((value, part) => value?.[part], english) ?? key }) },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports, require(id) { return id in modules ? modules[id] : sourceRequire(id); } });
  const basket = { totalAmountUsd: 10, allocations: [{ assetId: 'stock', ticker: 'STOCK', amountUsd: 10, weightPercent: 100 }] };
  const progress = { legs: [{ assetId: 'stock', status: 'awaiting_signature', quote: { platformFee } }] };
  return renderToStaticMarkup(React.createElement(exports.BasketReview, { basket, progress }));
}
test('basket review displays the USDC fee per leg and hides fee-free legs', () => {
  assert.match(renderBasket({ bps: 50, amountRaw: '50000', mint: 'USDC' }), /Oren fee.*0.5%.*\$0.05 USDC/);
  assert.doesNotMatch(renderBasket(undefined), /Oren fee/);
  assert.doesNotMatch(renderBasket({ bps: 0, amountRaw: '0', mint: 'USDC' }), /Oren fee/);
});
