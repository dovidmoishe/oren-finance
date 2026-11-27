import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { createSharedReadCache } from "../services/shared-read-cache.ts";

const require = createRequire(import.meta.url);
const tick = () => new Promise((resolve) => setImmediate(resolve));
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, AbortController, DOMException, Error, Date,
    require: (id) => id in mocks ? mocks[id] : require(id), ...globals });
  return exports;
}
function fixture(provider) {
  const calls = [], frames = [];
  const getStockCharts = async (ids, range, signal) => {
    calls.push({ ids: Array.from(ids), range, signal });
    return provider ? provider(ids, signal) : Object.fromEntries(ids.map((id) => [id, { candles: [{ close: id.length }] }]));
  };
  const { createSparklineReader } = load("../services/sparkline-read-cache.ts", {
    "./market-service": { getStockCharts }, "./shared-read-cache": { createSharedReadCache },
  });
  const read = createSparklineReader(getStockCharts, (flush) => frames.push(flush));
  const frame = async () => { await tick(); frames.splice(0).forEach((flush) => flush()); await tick(); };
  return { read, calls, frame };
}

test("desktop Markets collects visible rows into one batch and preserves the @3xl/visibility gates", async () => {
  const { read, calls, frame } = fixture((ids) => Object.fromEntries(ids.filter((id) => id !== "broken").map((id) => [id, { candles: [{ close: 10 }, { close: 12 }] }])));
  const effects = [], results = [];
  let visible = false, singles = 0;
  const stocks = Array.from({ length: 12 }, (_, index) => ({ assetId: index === 5 ? "broken" : `stock-${index}`, ticker: `S${index}`, name: `Stock ${index}` }));
  const state = { stocks, trending: [], opportunities: [], searchResults: [] };
  const { MarketsOverview } = load("../components/markets/markets-overview.tsx", {
    react: {
      useEffect: (effect) => effects.push(effect), useId: () => "sparkline", useMemo: (compute) => compute(),
      useRef: () => ({ current: null }), useState: (initial) => [initial, (value) => results.push(value)],
    },
    "next/link": { default: () => null }, "next/dynamic": { default: () => () => null },
    "@/components/ui": { cn: (...values) => values.join(" "), formatCurrency: String, formatPercent: String, formatCompactCurrency: String },
    "@/services/market-service": { getStockChart: () => { singles++; throw new Error("Unexpected per-row chart"); } },
    "@/services/sparkline-read-cache": { createSparklineReader: () => read },
    "@/store/market-store": { useMarketStore: (select) => select(state) },
    "@/hooks/use-element-visible": { useElementVisible: () => visible },
    "./market-for-you": {}, "./market-stock-logo": {},
  }, { process: { env: { NODE_ENV: "test" } } });
  function find(node, predicate) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap((child) => find(child, predicate));
    return [...(predicate(node) ? [node] : []), ...find(node.props?.children, predicate)];
  }
  const rows = find(MarketsOverview(), (node) => node.type?.name === "StockRow");
  assert.equal(rows.length, 12);
  const sparklines = rows.map((row) => {
    const tree = row.type(row.props);
    const [cell] = find(tree, (node) => node.props?.className === "hidden w-full max-w-28 justify-self-end @3xl:block");
    assert.ok(cell, "chart cell retains container breakpoint hiding");
    return cell.props.children;
  });
  effects.length = 0;
  for (const sparkline of sparklines) sparkline.type(sparkline.props);
  effects.splice(0).forEach((effect) => effect());
  await frame();
  assert.equal(calls.length, 0, "CSS-hidden or offscreen cells do not fetch");
  visible = true;
  for (const sparkline of sparklines) sparkline.type(sparkline.props);
  const cleanups = effects.splice(0).map((effect) => effect());
  await frame();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].ids, stocks.map((stock) => stock.assetId));
  assert.equal(calls[0].range, "1D");
  assert.equal(singles, 0);
  assert.equal(results.filter((result) => result.candles.length === 2).length, 11);
  assert.equal(results.find((result) => result.key === "broken:1D").candles.length, 0);
  cleanups.forEach((cleanup) => cleanup());
});

test("scrolling requests only uncached new ids, and omitted ids can retry without emptying others", async () => {
  const { read, calls, frame } = fixture((ids) => Object.fromEntries(ids.filter((id) => id !== "broken").map((id) => [id, { candles: [{ close: 1 }] }])));
  const first = read("nvidia"), failed = assert.rejects(read("broken"), /Chart unavailable/);
  await frame();
  await Promise.all([first, failed]);
  const cached = read("nvidia"), next = read("tesla");
  await frame();
  assert.deepEqual(await cached, [{ close: 1 }]);
  await next;
  assert.deepEqual(calls.map((call) => call.ids), [["nvidia", "broken"], ["tesla"]]);
  const retry = assert.rejects(read("broken"), /Chart unavailable/);
  await frame();
  await retry;
  assert.deepEqual(calls.at(-1).ids, ["broken"]);
});

test("per-id consumers cancel independently and the last visible id aborts the shared transport", async () => {
  const { read, calls, frame } = fixture((_ids, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")))));
  const a = new AbortController(), duplicate = new AbortController(), b = new AbortController();
  const first = assert.rejects(read("nvidia", a.signal), { name: "AbortError" });
  const second = assert.rejects(read("nvidia", duplicate.signal), { name: "AbortError" });
  const third = assert.rejects(read("tesla", b.signal), { name: "AbortError" });
  await frame();
  assert.equal(calls.length, 1);
  a.abort();
  await first;
  assert.equal(calls[0].signal.aborted, false);
  duplicate.abort();
  await second;
  assert.equal(calls[0].signal.aborted, false);
  b.abort();
  await third;
  assert.equal(calls[0].signal.aborted, true);
});

test("abandoned frame entries never fetch, batch size stays at 20, and HTTP concurrency stays at four", async () => {
  const releases = [];
  const { read, calls, frame } = fixture((ids) => new Promise((resolve) => releases.push(() => resolve(Object.fromEntries(ids.map((id) => [id, { candles: [] }]))))));
  const controller = new AbortController();
  const abandoned = assert.rejects(read("abandoned", controller.signal), { name: "AbortError" });
  controller.abort();
  await abandoned;
  await frame();
  assert.equal(calls.length, 0);
  const reads = Array.from({ length: 100 }, (_, index) => read(`stock-${index}`));
  await frame();
  assert.equal(calls.length, 4);
  assert.ok(calls.every((call) => call.ids.length === 20));
  releases.splice(0).forEach((resolve) => resolve());
  await tick();
  assert.equal(calls.length, 5);
  releases.splice(0).forEach((resolve) => resolve());
  await Promise.all(reads);
});

test("batch API uses /stocks/charts and detail pages retain /stocks/:id/chart", async () => {
  const calls = [];
  const services = load("../services/market-service.ts", { "./api-client": { apiRequest: async (path, options) => { calls.push({ path, options }); return { candles: [] }; } } });
  await services.getStockCharts(["nvidia", "tesla"], "1D");
  await services.getStockChart("nvidia", "1M");
  assert.equal(calls[0].path, "/stocks/charts");
  assert.equal(calls[0].options.query.ids, "nvidia,tesla");
  assert.equal(calls[0].options.query.range, "1D");
  assert.equal(calls[1].path, "/stocks/nvidia/chart");
});
