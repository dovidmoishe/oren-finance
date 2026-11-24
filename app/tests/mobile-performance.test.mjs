import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { createSharedReadCache } from "../services/shared-read-cache.ts";
import { parsePerformanceBatch, routeBucket, resourceBucket } from "../lib/performance-schema.ts";

const require = createRequire(import.meta.url);
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, AbortController, DOMException, Error, Date, setTimeout, clearTimeout,
    require: (id) => id in mocks ? mocks[id] : require(id), ...globals });
  return exports;
}

test("chart reads share in-flight work and one consumer cannot abort another", async () => {
  const read = createSharedReadCache();
  const result = deferred();
  let calls = 0, providerSignal;
  const loader = (signal) => { calls++; providerSignal = signal; return result.promise; };
  const a = new AbortController(), b = new AbortController();
  const first = read("nvda:1D", loader, a.signal);
  const second = read("nvda:1D", loader, b.signal);
  await tick();
  assert.equal(calls, 1);
  const rejected = assert.rejects(first, { name: "AbortError" });
  a.abort();
  await rejected;
  assert.equal(providerSignal.aborted, false);
  result.resolve([1, 2]);
  assert.deepEqual(await second, [1, 2]);
  assert.deepEqual(await read("nvda:1D", loader), [1, 2]);
  assert.equal(calls, 1);
});

test("an invisible last chart consumer cancels provider work and the result is not cached", async () => {
  const read = createSharedReadCache();
  const result = deferred(), controller = new AbortController();
  let signal;
  const first = read("a", (s) => { signal = s; return result.promise; }, controller.signal);
  await tick();
  const rejected = assert.rejects(first, { name: "AbortError" });
  controller.abort();
  await rejected;
  assert.equal(signal.aborted, true);
  result.resolve("abandoned");
  await tick();
  assert.equal(await read("a", async () => "fresh"), "fresh");
});

test("chart queue caps concurrency and removes abandoned queued reads", async () => {
  const read = createSharedReadCache({ concurrency: 1, capacity: 3 });
  const pending = deferred(), controller = new AbortController();
  const calls = [];
  const a = read("a", () => { calls.push("a"); return pending.promise; });
  const b = read("b", async () => { calls.push("b"); return "b"; }, controller.signal);
  const c = read("c", async () => { calls.push("c"); return "c"; });
  await tick();
  assert.deepEqual(calls, ["a"]);
  const rejected = assert.rejects(b, { name: "AbortError" });
  controller.abort();
  await rejected;
  pending.resolve("a");
  await Promise.all([a, c]);
  assert.deepEqual(calls, ["a", "c"]);
});

test("chart cache expires, evicts old entries and retries failures", async () => {
  const read = createSharedReadCache({ ttlMs: 0, capacity: 1 });
  let calls = 0;
  await read("a", async () => ++calls);
  await tick();
  await read("a", async () => ++calls);
  assert.equal(calls, 2);
  await tick();
  await assert.rejects(read("b", async () => { throw new Error("offline"); }), /offline/);
  await tick();
  assert.equal(await read("b", async () => "recovered"), "recovered");
  const bounded = createSharedReadCache({ capacity: 1 });
  await bounded("a", async () => "a");
  await tick();
  await bounded("b", async () => "b");
  await tick();
  assert.equal(await bounded("a", async () => "reloaded"), "reloaded");
});

function stockStore() {
  const requests = new Map();
  const services = Object.fromEntries(["getStock", "getStockChart", "getStockAnalysis", "getStockNews"].map((name) => [name, (id, ...args) => {
    const result = deferred();
    requests.set(name + ":" + id + (name === "getStockChart" ? ":" + args[0] : ""), { ...result, signal: args.at(-1) });
    return result.promise;
  }]));
  return { requests, store: load("../store/stock-store.ts", { "@/services/market-service": services }).useStockStore };
}
test("stock identity and chart render while optional analysis/news remain pending", async () => {
  const { store, requests } = stockStore();
  assert.equal(store.getState().requestedAssetId, undefined);
  const done = store.getState().loadStock("nvda");
  assert.equal(store.getState().requestedAssetId, "nvda");
  requests.get("getStock:nvda").resolve({ assetId: "nvda" });
  requests.get("getStockChart:nvda:1M").resolve([{ close: 10 }]);
  await tick();
  assert.equal(store.getState().selected.assetId, "nvda");
  assert.equal(store.getState().isLoading, false);
  assert.equal(store.getState().isChartLoading, false);
  assert.equal(store.getState().isAnalysisLoading, true);
  requests.get("getStockAnalysis:nvda").reject(new Error("offline"));
  requests.get("getStockNews:nvda").resolve([]);
  await done;
  assert.equal(store.getState().selected.assetId, "nvda");
  assert.equal(store.getState().isAnalysisLoading, false);
});

test("initial chart completion cannot replace a subsequently selected range", async () => {
  const { store, requests } = stockStore();
  const initial = store.getState().loadStock("nvda");
  const range = store.getState().loadChart("nvda", "1D");
  requests.get("getStockChart:nvda:1D").resolve([{ close: 20 }]);
  await range;
  requests.get("getStockChart:nvda:1M").resolve([{ close: 10 }]);
  requests.get("getStock:nvda").resolve({ assetId: "nvda" });
  requests.get("getStockAnalysis:nvda").resolve({});
  requests.get("getStockNews:nvda").resolve([]);
  await initial;
  assert.equal(store.getState().chart[0].close, 20);
});

test("navigation aborts old stock reads and late responses cannot repopulate reset state", async () => {
  const { store, requests } = stockStore();
  const done = store.getState().loadStock("old");
  store.getState().reset();
  assert.equal(store.getState().requestedAssetId, undefined);
  assert.equal(requests.get("getStock:old").signal.aborted, true);
  for (const [key, request] of requests) request.resolve(key.startsWith("getStock:") ? { assetId: "old" } : []);
  await done;
  assert.equal(store.getState().selected, undefined);
  assert.equal(store.getState().chart.length, 0);
});

test("Markets rows publish independently and concurrent mounts share the startup requests", async () => {
  const stocks = deferred(), featured = deferred();
  let calls = 0;
  const store = load("../store/market-store.ts", { "@/services/market-service": {
    getStocks: () => { calls++; return stocks.promise; },
    getTrendingStocks: () => featured.promise, getMarketOpportunities: () => featured.promise,
  } }).useMarketStore;
  const first = store.getState().loadMarkets(), second = store.getState().loadMarkets();
  assert.equal(calls, 1);
  stocks.resolve({ items: [{ assetId: "nvda" }], pagination: { hasMore: true } });
  await tick();
  assert.equal(store.getState().stocks[0].assetId, "nvda");
  assert.equal(store.getState().isLoading, false);
  featured.resolve([]);
  await Promise.all([first, second]);
});

test("Markets can retry a failed list without waiting for stalled optional cards", async () => {
  const featured = deferred();
  let calls = 0, featuredCalls = 0;
  const store = load("../store/market-store.ts", { "@/services/market-service": {
    getStocks: async () => { if (++calls === 1) throw new Error("offline"); return { items: [{ assetId: "nvda" }], pagination: { hasMore: false } }; },
    getTrendingStocks: () => { featuredCalls++; return featured.promise; },
    getMarketOpportunities: () => featured.promise,
  } }).useMarketStore;
  await store.getState().loadMarkets();
  assert.equal(store.getState().error, "offline");
  await store.getState().loadMarkets();
  assert.equal(store.getState().stocks[0].assetId, "nvda");
  assert.equal(featuredCalls, 1);
  featured.resolve([]);
});

test("portfolio and activity consumers coalesce and explicit refreshes bypass pending data", async () => {
  const requests = [], activities = [];
  const store = load("../store/portfolio-store.ts", {
    "@/services/portfolio-service": {
      getPortfolio: () => { const p = deferred(); requests.push(p); return p.promise; },
      getPortfolioActivity: () => { const p = deferred(); activities.push(p); return p.promise; },
    },
    "@/services/wallet-session": { sessionSetter: (set) => set },
  }).usePortfolioStore;
  const a = store.getState().loadPortfolio("wallet"), b = store.getState().loadPortfolio("wallet");
  assert.equal(requests.length, 1);
  const fresh = store.getState().loadPortfolio("wallet", true);
  assert.equal(requests.length, 2);
  requests[1].resolve({ wallet: "wallet", totalValueUsd: 20 });
  await fresh;
  requests[0].resolve({ wallet: "wallet", totalValueUsd: 10 });
  await Promise.all([a, b]);
  assert.equal(store.getState().portfolio.totalValueUsd, 20);
  const c = store.getState().loadActivity("wallet"), d = store.getState().loadActivity("wallet");
  assert.equal(activities.length, 1);
  store.getState().reset();
  activities[0].resolve([{ id: "private" }]);
  await Promise.all([c, d]);
  assert.equal(store.getState().activity.length, 0);
});

function portfolioRefreshFixture() {
  const requests = [];
  const store = load("../store/portfolio-store.ts", {
    "@/services/portfolio-service": {
      getPortfolio: () => { const request = deferred(); requests.push(request); return request.promise; },
    },
    "@/services/wallet-session": { sessionSetter: (set) => set },
  }).usePortfolioStore;
  return { requests, store };
}

test("funding balance increases refresh a fresh cached portfolio and supersede an older pending read", async () => {
  for (const balance of ["usdcAtomic", "solLamports"]) {
    const { requests, store } = portfolioRefreshFixture();
    const initial = store.getState().loadPortfolio("wallet");
    requests[0].resolve({ wallet: "wallet", cashUsd: 10 });
    await initial;
    let callback, cleanup;
    const hook = load("../hooks/use-funding.ts", {
      react: { useState: (initial) => [initial, () => {}], useEffect: (effect) => { cleanup = effect(); } },
      "@/store": { usePortfolioStore: store, useWalletStore: { getState: () => ({ address: "wallet" }) } },
      "@/services/funding-stream": {
        FundingStreamError: class extends Error {},
        streamFunding: (_wallet, _token, onEvent) => { callback = onEvent; return new Promise(() => {}); },
      },
    }, { document: { hidden: false, addEventListener() {}, removeEventListener() {} } }).useFunding;
    hook("wallet", async () => "token");
    try {
      const snapshot = { slot: 100, usdcAtomic: "10", solLamports: "10" };
      callback({ type: "snapshot", data: snapshot });
      assert.equal(requests.length, 1, "initial funding snapshot does not trigger a refresh");
      callback({ type: "snapshot", data: { ...snapshot, slot: 101, [balance]: "20" } });
      assert.equal(requests.length, 2, "a deposit bypasses the 30-second cache");
      requests[1].resolve({ wallet: "wallet", cashUsd: 20 });
      await tick();
      assert.equal(store.getState().portfolio.cashUsd, 20);
      const olderRead = store.getState().loadPortfolio("wallet", true);
      callback({ type: "snapshot", data: { ...snapshot, slot: 102, [balance]: "30" } });
      assert.equal(requests.length, 4, "a later deposit bypasses an older pending read");
      requests[3].resolve({ wallet: "wallet", cashUsd: 30 });
      await tick();
      requests[2].resolve({ wallet: "wallet", cashUsd: 20 });
      await olderRead;
      assert.equal(store.getState().portfolio.cashUsd, 30);
    } finally { cleanup(); }
  }
});

test("Vault Refresh bypasses fresh portfolio data and older pending reads while navigation reuses the cache", async () => {
  const { requests, store } = portfolioRefreshFixture();
  const initial = store.getState().loadPortfolio("wallet");
  requests[0].resolve({ wallet: "wallet", cashUsd: 10, positions: [] });
  await initial;
  const effects = [], vaultReads = [];
  const Button = () => null;
  const { VaultDashboard } = load("../components/vault/vault-dashboard.tsx", {
    react: {
      useEffect: (effect) => effects.push(effect), useMemo: (compute) => compute(),
      useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
    },
    "@/components/auth/auth-context": { useOrenAuth: () => ({ ready: true, authenticated: true }) },
    "@/components/auth/restore-actions": { restoreBlocked: () => false },
    "@/components/ui": { Button, cn: () => "", formatCurrency: String, formatNumber: String },
    "@/store": {
      usePortfolioStore: (select) => select(store.getState()),
      useWalletStore: (select) => select({ address: "wallet", connected: true }),
      useVaultStore: (select) => select({ positions: [], loadVaults: (wallet) => vaultReads.push(wallet) }),
    },
    "@/services/environment": { financialExecutionEnabled: true },
    "@/i18n/i18n": { useI18n: () => ({ t: (key) => key }) },
    "./vault-review-modal": { VaultReviewModal: () => null },
  });
  const tree = VaultDashboard();
  for (const effect of effects) effect();
  assert.equal(requests.length, 1, "mounting the Vault reuses fresh portfolio data");
  function findRefresh(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.map(findRefresh).find(Boolean);
    if (node.type === Button && node.props.children.includes("vault.refresh")) return node;
    return findRefresh(node.props?.children);
  }
  const refresh = findRefresh(tree);
  assert.ok(refresh);
  assert.equal(refresh.props.disabled, false);
  refresh.props.onClick();
  assert.equal(requests.length, 2, "Refresh bypasses the 30-second cache");
  refresh.props.onClick();
  assert.equal(requests.length, 3, "Refresh bypasses an older pending read");
  requests[2].resolve({ wallet: "wallet", cashUsd: 30 });
  await tick();
  requests[1].resolve({ wallet: "wallet", cashUsd: 20 });
  await tick();
  assert.equal(store.getState().portfolio.cashUsd, 30);
  assert.deepEqual(vaultReads, ["wallet", "wallet", "wallet"]);
});

test("visibility requires non-zero intersection and a foreground document", () => {
  let callback, cleanup, value;
  const listeners = new Map();
  const document = { hidden: false, addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: (event) => listeners.delete(event) };
  const hook = load("../hooks/use-element-visible.ts", { react: {
    useState: () => [false, (next) => { value = next; }],
    useEffect: (fn) => { cleanup = fn(); },
  } }, { document, IntersectionObserver: class {
    constructor(fn) { callback = fn; } observe() {} disconnect() {}
  } }).useElementVisible;
  assert.equal(hook({ current: {} }), false);
  callback([{ isIntersecting: true, intersectionRect: { width: 0, height: 20 } }]);
  assert.equal(value, false);
  callback([{ isIntersecting: true, intersectionRect: { width: 20, height: 20 } }]);
  assert.equal(value, true);
  document.hidden = true;
  listeners.get("visibilitychange")();
  assert.equal(value, false);
  cleanup();
  assert.equal(listeners.size, 0);
});

test("telemetry rejects identifiers and non-finite data; dynamic routes contain no identifiers", () => {
  const metric = { name: "LCP", value: 1234, route: "stock", device: "phone", browser: "safari" };
  assert.deepEqual(parsePerformanceBatch([metric]), [metric]);
  for (const bad of [{ ...metric, wallet: "private" }, { ...metric, route: "/app/stocks/private" }, { ...metric, value: Infinity }, { ...metric, name: "anything" }]) {
    assert.equal(parsePerformanceBatch([bad]), undefined);
  }
  assert.equal(parsePerformanceBatch(Array(9).fill(metric)), undefined);
  assert.equal(routeBucket("/app/stocks/private-id"), "stock");
  assert.equal(resourceBucket("/api/portfolio/private-wallet/history"), "history");
  assert.equal(resourceBucket("/api/stocks/private-id/chart"), "chart");
});

test("public GETs have a read deadline and avoid JSON preflights; mutations keep their original signal", async () => {
  const calls = [], timings = [];
  const api = load("../services/api-client.ts", {
    "../lib/performance-client": { recordPerformanceMetric: (m) => timings.push(m) },
    "../lib/performance-schema": { resourceBucket },
  }, { URL, process: { env: { NEXT_PUBLIC_OREN_API_URL: "https://api.example.test/api" } },
    fetch: async (...args) => { calls.push(args); return { ok: true, json: async () => ({}) }; } });
  const signal = new AbortController().signal;
  await api.apiRequest("/stocks", { signal });
  assert.equal(calls[0][1].headers["Content-Type"], undefined);
  assert.notEqual(calls[0][1].signal, signal);
  await api.apiRequest("/execution/approvals", { method: "POST", body: { intent: "test" }, signal });
  assert.equal(calls[1][1].signal, signal);
  assert.equal(calls[1][1].headers["Content-Type"], "application/json");
  assert.equal(timings.length, 1);
});

test("performance collector enforces payload, origin and log budgets", async () => {
  const logs = [];
  const { POST } = load("../app/api/telemetry/performance/route.ts", {
    "@/lib/performance-schema": { parsePerformanceBatch },
  }, { Request, Response, URL, TextDecoder, Uint8Array, console: { info: (event) => logs.push(JSON.parse(event)) } });
  const metric = { name: "INP", value: 123, route: "markets", device: "phone", browser: "chromium" };
  const request = (body, headers = {}) => new Request("https://oren.test/api/telemetry/performance", {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers },
  });
  assert.equal((await POST(request([metric]))).status, 204);
  assert.deepEqual(logs[0], { event: "oren.performance", metrics: [metric] });
  assert.equal((await POST(request([{ ...metric, wallet: "private" }]))).status, 400);
  assert.equal((await POST(request([metric], { origin: "https://foreign.test" }))).status, 403);
  assert.equal((await POST(request([metric], { origin: "http://oren.test" }))).status, 403);
  assert.equal((await POST(request([metric], { origin: "https://public.test", host: "public.test", "x-forwarded-proto": "https" }))).status, 204);
  assert.equal((await POST(request("x".repeat(5000)))).status, 413);
  assert.equal((await POST(request([metric], { "content-type": "text/plain" }))).status, 415);
  assert.equal(logs.length, 2);
  for (let i = 0; i < 120; i++) await POST(request([metric]));
  assert.equal((await POST(request([metric]))).status, 429);
  assert(logs.length <= 120);
});

test("telemetry sampling honors privacy preferences and sends only bucketed values without cookies", async () => {
  const sent = [];
  function client(navigator) {
    return load("../lib/performance-client.ts", { "./performance-schema": { routeBucket } }, {
      process: { env: { NEXT_PUBLIC_PERFORMANCE_SAMPLE_RATE: "1" } },
      window: { location: { pathname: "/app/stocks/private-asset" }, innerWidth: 390 }, navigator,
      fetch: async (...args) => { sent.push(args); }, setTimeout: () => 1, clearTimeout() {},
    });
  }
  const blocked = client({ doNotTrack: "1", userAgent: "Safari/1" });
  blocked.recordPerformanceMetric({ name: "LCP", value: 1000 });
  blocked.flushPerformanceMetrics();
  assert.equal(sent.length, 0);
  const allowed = client({ userAgent: "Safari/1" });
  allowed.recordPerformanceMetric({ name: "LCP", value: 1000.12345 });
  allowed.flushPerformanceMetrics();
  assert.equal(sent[0][0], "/api/telemetry/performance");
  assert.equal(sent[0][1].credentials, "omit");
  assert.equal(sent[0][1].body.includes("private-asset"), false);
  assert.deepEqual(JSON.parse(sent[0][1].body), [{ name: "LCP", value: 1000.123, route: "stock", device: "phone", browser: "safari" }]);
});
