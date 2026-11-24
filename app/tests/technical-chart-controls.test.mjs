import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const messages = JSON.parse(readFileSync(new URL('../i18n/messages/en.json', import.meta.url), 'utf8'));
const t = (key, values = {}) => Object.entries(values).reduce((s, [name, value]) => s.replaceAll(`{${name}}`, value), key.split('.').reduce((v, name) => v?.[name], messages) ?? key);
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const model = {};
vm.runInNewContext(compile('../components/charts/kline-data.ts'), { exports: model });
const candles = Array.from({ length: 100 }, (_, i) => ({ timestamp: new Date(Date.UTC(2026, 10, 1, i)).toISOString(), open: 10, high: 12, low: 9, close: 11, volume: 100 }));

function harness() {
  const slots = [], exports = {}, intervals = [];
  let cursor = 0;
  const session = { cancelDrawing() {}, draw() {}, clearDrawings() {}, fit() {} };
  vm.runInNewContext(compile('../components/charts/market-chart.tsx'), { exports, Intl, require(id) {
    if (id === 'react') return { useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = i === 0 ? session : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; }, useRef: () => ({ current: null }), useMemo: fn => fn(), useEffect() {}, useId: () => 'indicator-menu' };
    if (id === 'lucide-react') return new Proxy({}, { get: () => () => null });
    if (id === '@/components/ui') return { cn: (...args) => args.filter(Boolean).join(' '), formatCurrency: n => `$${n ?? 0}`, formatDate: () => '', formatPercent: n => `${n ?? 0}%`, Tabs: () => null };
    if (id === '@/components/theme/theme-script') return {};
    if (id === '@/i18n/i18n') return { useI18n: () => ({ locale: 'en', timeZone: 'UTC', t }) };
    if (id === './kline-data') return model;
    if (id === './kline-engine') return {};
    return require(id);
  } });
  const render = () => { cursor = 0; return exports.MarketChart({ technical: true, symbol: 'NVDA', mode: 'candles', candleData: candles, activeRange: '7D', interval: '1H', onRangeChange() {}, onIntervalChange: value => intervals.push(value) }); };
  return { render, intervals };
}
function all(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(child => all(child, predicate));
  if (!tree?.props) return [];
  return [...(predicate(tree) ? [tree] : []), ...all(tree.props.children, predicate)];
}
test('technical chart starts clean and interval controls request their actual candle interval', () => {
  const h = harness();
  const tree = h.render();
  assert.equal(all(tree, e => e.type === 'input').length, 0, 'indicator controls are collapsed initially');
  const buttons = all(tree, e => e.type === 'button');
  const fiveMinutes = buttons.find(e => e.props.children === '5m');
  fiveMinutes.props.onClick();
  assert.deepEqual(h.intervals, ['5m']);
  const hour = buttons.find(e => e.props.children === '1h');
  assert.equal(hour.props['aria-pressed'], true);
  assert.equal(buttons.find(e => e.props['aria-expanded'] === false).props['aria-controls'], 'indicator-menu');
});
test('indicator menu toggles native checkboxes and keeps only one oscillator pane selected', () => {
  const h = harness();
  all(h.render(), e => e.type === 'button' && e.props['aria-expanded'] === false)[0].props.onClick();
  let inputs = all(h.render(), e => e.type === 'input');
  assert.equal(inputs.length, 6);
  assert.ok(inputs.every(input => !input.props.checked));
  inputs[4].props.onChange();
  inputs = all(h.render(), e => e.type === 'input');
  assert.equal(inputs[4].props.checked, true);
  inputs[5].props.onChange();
  inputs = all(h.render(), e => e.type === 'input');
  assert.equal(inputs[4].props.checked, false);
  assert.equal(inputs[5].props.checked, true);
});
