import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, imports = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: id => imports[id], ...globals });
  return exports;
}
const model = load('../components/charts/kline-data.ts');
const candle = (timestamp, close = 12, extra = {}) => ({ timestamp, open: 10, high: 14, low: 9, close, ...extra });

test('OHLC preserves milliseconds, deduplicates, sorts, and excludes malformed candles', () => {
  const bars = model.buildCandleData([
    candle('2026-11-02T12:00:00.500Z'), candle('2026-11-01T12:00:00Z'),
    candle('2026-11-02T12:00:00.500Z', 13, { volume: 0 }),
    candle('invalid'), candle('2026-11-03', Infinity), candle('2026-11-04', 12, { high: 11 }),
    candle('2026-11-05', 12, { low: 11 }),
  ]);
  assert.equal(bars.length, 2);
  assert.equal(bars[0].timestamp, Date.parse('2026-11-01T12:00:00Z'));
  assert.equal(bars[1].timestamp, Date.parse('2026-11-02T12:00:00.500Z'));
  assert.equal(bars[1].close, 13);
  assert.equal(bars[1].volume, 0);
  assert.equal('volume' in bars[0], false);
});

test('missing and invalid volumes are not fabricated as zero; portfolio observations keep their actual values', () => {
  for (const volume of [undefined, NaN, Infinity, -1]) {
    const [bar] = model.buildCandleData([candle('2026-11-01', 12, { volume })]);
    assert.equal('volume' in bar, false);
  }
  const bars = model.buildLineData([{ timestamp: '2026-11-01', value: -10 }, { timestamp: 'bad', value: 1 }, { timestamp: '2026-11-02', value: NaN }]);
  assert.equal(bars.length, 1);
  assert.equal(bars[0].close, -10);
  assert.equal('volume' in bars[0], false);
  assert.deepEqual(JSON.parse(JSON.stringify(model.chartPeriod('7D'))), { type: 'hour', span: 4 });
  assert.deepEqual(JSON.parse(JSON.stringify(model.chartPeriod('24H'))), { type: 'hour', span: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(model.chartPeriod('1Y'))), { type: 'day', span: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(model.chartPeriod('7D', '15m'))), { type: 'minute', span: 15 });
  assert.deepEqual(JSON.parse(JSON.stringify(model.chartPeriod('7D', '1H'))), { type: 'hour', span: 1 });
});

function harness() {
  const calls = [], tasks = [], indicators = new Map(), drawings = new Map();
  let loader, crosshair, disconnected = false, drawingId = 0;
  const chart = {
    setSymbol: symbol => calls.push(['symbol', symbol]),
    setPeriod: period => calls.push(['period', period]),
    setStyles: styles => calls.push(['styles', styles]),
    subscribeAction: (_name, callback) => { crosshair = callback; },
    unsubscribeAction: (...args) => calls.push(['unsubscribe', ...args]),
    getSize: () => ({ width: 600 }), setBarSpace: value => calls.push(['space', value]),
    setOffsetRightDistance() {}, scrollToRealTime() {}, resize() {},
    setDataLoader: value => { loader = value; },
    getIndicators: ({ name }) => indicators.has(name) ? [indicators.get(name)] : [],
    createIndicator: value => { indicators.set(value.name, value); calls.push(['indicator', value]); },
    removeIndicator: ({ name }) => indicators.delete(name), setPaneOptions() {},
    createOverlay: value => { const id = `drawing-${++drawingId}`; drawings.set(id, value); return id; },
    removeOverlay: filter => filter ? drawings.delete(filter.id) : drawings.clear(),
  };
  const library = { init: () => chart, registerLocale() {}, dispose: () => calls.push(['dispose']) };
  const engine = load('../components/charts/kline-engine.ts', { './kline-data': model }, {
    Intl, queueMicrotask: fn => tasks.push(fn), getComputedStyle: () => ({ fontFamily: 'sans-serif', getPropertyValue: () => '#123456' }),
    ResizeObserver: class { observe() {} disconnect() { disconnected = true; } },
  });
  let selectedBar;
  const session = engine.createKlineChart(library, { clientWidth: 600 }, { symbol: 'NVDA', locale: 'en', timeZone: 'UTC', labels: {}, technical: true,
    onCrosshair: bar => { selectedBar = bar; }, onDrawingEnd: () => calls.push(['drawingEnd']) });
  return { session, calls, chart, indicators, drawings, tasks, get loader() { return loader; },
    get disconnected() { return disconnected; }, crosshair: bar => { crosshair({ kLineData: bar }); return selectedBar; } };
}

test('KLine v10 loader delivers the selected window once, with pagination closed and disposal guarded', () => {
  const h = harness();
  const bars = model.buildCandleData([candle('2026-11-01')]);
  h.session.update(bars, '7D');
  const replies = [];
  h.loader.getBars({ type: 'init', callback: (...args) => replies.push(args) });
  assert.equal(replies.length, 0);
  h.tasks.shift()();
  assert.equal(replies[0][0], bars);
  assert.equal(replies[0][1], false);
  h.loader.getBars({ type: 'forward', callback: (...args) => replies.push(args) });
  h.tasks.shift()();
  assert.equal(replies[1][0].length, 0);
  h.loader.getBars({ type: 'init', callback: () => assert.fail('disposed chart received data') });
  h.session.dispose();
  h.tasks.shift()();
  assert.equal(h.disconnected, true);
  assert.equal(h.calls.filter(call => call[0] === 'dispose').length, 1);
});

test('mode/theme and indicator changes retain drawings, respect actual volume, and do not duplicate indicators', () => {
  const h = harness();
  h.session.setIndicators(['MA', 'VOL', 'RSI'], false);
  assert.deepEqual([...h.indicators.keys()], ['MA', 'RSI']);
  assert.deepEqual(JSON.parse(JSON.stringify(h.indicators.get('MA').calcParams)), [20, 50]);
  h.session.setIndicators(['MA', 'VOL', 'RSI'], true);
  assert.equal(h.calls.filter(call => call[0] === 'indicator' && call[1].name === 'MA').length, 1);
  h.session.draw('segment');
  const [[id, drawing]] = [...h.drawings];
  drawing.onDrawEnd();
  h.session.setMode('candles');
  h.session.setMode('line');
  h.session.updateColors();
  assert.equal(h.drawings.has(id), true);
  h.session.setIndicators(['MACD'], true);
  assert.deepEqual([...h.indicators.keys()], ['MACD']);
  const bar = { timestamp: 1, close: 12 };
  assert.equal(h.crosshair(bar), bar);
  h.session.draw('horizontalStraightLine');
  h.session.cancelDrawing();
  assert.equal(h.drawings.size, 1, 'cancel only removes the unfinished drawing');
  h.session.clearDrawings();
  assert.equal(h.drawings.size, 0);
});
