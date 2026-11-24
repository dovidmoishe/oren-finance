import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const react = require('react');
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const timing = {};
vm.runInNewContext(compile('../components/landing/walkthrough-timing.ts'), { exports: timing });
function render(elapsed, snapshot) {
  const values = [snapshot, snapshot ? 'ready' : 'unavailable', elapsed, false, true, true];
  let state = 0;
  const exports = {};
  vm.runInNewContext(compile('../components/landing/product-walkthrough.tsx'), { exports, require(id) {
    if (id === 'react') return { useState: () => [values[state++], () => {}], useRef: () => ({ current: null }), useEffect() {}, useMemo: fn => fn(), useId: () => 'chart' };
    if (id === 'lucide-react') return new Proxy({}, { get: () => () => null });
    if (id === 'next/image') return { default: ({ alt, ...props }) => react.createElement('img', { alt, ...props }) };
    if (id === '@/components/brand/oren-logo') return { OrenLogo: () => null };
    if (id === './stock-logos') return { stockLogos: { NVDA: '/nvda.png', AAPL: '/aapl.png', MSFT: '/msft.png', TSLA: '/tsla.png' } };
    if (id === '@/services/market-service') return {};
    if (id === './walkthrough-timing') return timing;
    if (id === '@/components/ui/utils') return { formatCurrency: n => `$${n.toFixed(2)}`, formatPercent: (n, _locale, signed = true) => `${signed && n >= 0 ? '+' : ''}${n.toFixed(2)}%`, formatRelativeTime: () => 'just now' };
    return require(id);
  } });
  return renderToStaticMarkup(react.createElement(exports.ProductWalkthrough));
}
const snapshot = {
  retrievedAt: '2026-11-24T00:00:00Z', stale: false,
  data: { source: 'Tokens.xyz', stocks: ['NVDA', 'AAPL', 'MSFT', 'TSLA'].map(ticker => ({ ticker, price: 200, priceChange24h: -5 })),
    candles: [{ timestamp: '2026-11-01', close: 210 }, { timestamp: '2026-11-23', close: 200 }],
    analysis: { opportunityScore: 41, signals: { momentum7d: -2, volatility30d: 7 }, technicalBrief: { regime: 'downtrend' } },
  },
};
test('demo fits a twelve-second flow while retaining a static review poster', () => {
  assert.equal(timing.WALKTHROUGH_DURATION, 12000);
  assert.equal(timing.walkthroughPosition(2199).step, 0);
  assert.equal(timing.walkthroughPosition(2200).step, 1);
  assert.equal(timing.walkthroughPosition(999999).step, 3);
  assert.equal(timing.walkthroughPosition(999999).ended, true);
});
test('live snapshot updates list, chart, score, narrative and illustrative quantity together', () => {
  const market = render(0, snapshot);
  assert.ok(market.includes('$200.00'));
  assert.ok(market.includes('-5.00%'));
  assert.ok(market.includes('41 / 100'));
  const stock = render(4000, snapshot);
  assert.ok(stock.includes('Market snapshot NVIDIA 30-day price chart'));
  assert.ok(!stock.includes('186 dollars'));
  const agent = render(7000, snapshot);
  assert.ok(agent.includes('NVIDIA is down 5.00% over 24 hours'));
  assert.ok(agent.includes('longer-term technical trend is downtrend'));
  const review = render(12000, snapshot);
  assert.ok(review.includes('0.5000'));
  assert.ok(!review.includes('0.5364'));
  assert.ok(review.includes('Portfolio and trade are examples.'));
  assert.ok(review.includes('Tokens.xyz'));
  assert.ok(review.includes('Replay'));
});
test('offline rendering remains explicitly sample data', () => {
  const html = render(0);
  assert.ok(html.includes('Sample market data'));
  assert.ok(html.includes('Market snapshot unavailable'));
  assert.ok(!html.includes('Market data: Tokens.xyz'));
});
test('chart scale follows the actual prices, including a flat market', () => {
  for (const prices of [[1000, 800], [5, 5]]) {
    const chart = timing.chartGeometry(prices);
    assert.ok(!chart.path.includes('NaN'));
    for (const price of prices) assert.ok(chart.y(price) >= 0 && chart.y(price) <= 210);
  }
});
