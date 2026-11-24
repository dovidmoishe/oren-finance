import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);

function historyStore(getPortfolioHistory) {
  const exports = {};
  const source = readFileSync(new URL("../store/portfolio-store.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, {
    exports, Error,
    require(id) {
      if (id === "@/services/portfolio-service") return { getPortfolioHistory };
      if (id === "@/services/wallet-session") return { sessionSetter: (set) => set };
      return require(id);
    },
  });
  return exports.usePortfolioStore;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("rapid chart range changes retain the newest response even when older data arrives last", async () => {
  const week = deferred();
  const day = deferred();
  const requests = [];
  const store = historyStore((wallet, range) => {
    requests.push([wallet, range]);
    return range === "1W" ? week.promise : day.promise;
  });
  const first = store.getState().loadHistory("wallet", "1W");
  const second = store.getState().loadHistory("wallet", "1D");
  assert.equal(store.getState().isHistoryLoading, true);
  const dayPoints = [{ timestamp: "2026-11-18T10:00:00Z", totalValueUsd: 1234 }];
  day.resolve(dayPoints);
  await second;
  assert.equal(store.getState().history, dayPoints);
  assert.equal(store.getState().isHistoryLoading, false);
  week.resolve([{ timestamp: "2026-11-12T10:00:00Z", totalValueUsd: 999 }]);
  await first;
  assert.equal(store.getState().history, dayPoints);
  assert.deepEqual(requests, [["wallet", "1W"], ["wallet", "1D"]]);
});

test("history failures reach the chart and a retry clears the error", async () => {
  let fail = true;
  const store = historyStore(async () => {
    if (fail) throw new Error("History unavailable");
    return [];
  });
  await store.getState().loadHistory("wallet", "1D");
  assert.equal(store.getState().historyError, "History unavailable");
  assert.equal(store.getState().isHistoryLoading, false);
  assert.equal(store.getState().error, undefined);
  fail = false;
  await store.getState().loadHistory("wallet", "1D");
  assert.equal(store.getState().historyError, undefined);
});

test("reset prevents a pending chart request from restoring previous wallet history", async () => {
  const pending = deferred();
  const store = historyStore(() => pending.promise);
  const request = store.getState().loadHistory("old-wallet", "1W");
  store.getState().reset();
  pending.resolve([{ timestamp: "2026-11-18T10:00:00Z", totalValueUsd: 1234 }]);
  await request;
  assert.equal(store.getState().history.length, 0);
  assert.equal(store.getState().isHistoryLoading, false);
});

test("returning to a fresh chart reuses points and remembers its range", async () => {
  let requests = 0;
  const points = [{ timestamp: "2026-11-18T10:00:00Z", totalValueUsd: 12 }];
  const store = historyStore(async () => { requests++; return points; });
  store.getState().selectRange("1M");
  await store.getState().loadHistory("wallet", "1M", false);
  await store.getState().loadHistory("wallet", "1M", false);
  assert.equal(requests, 1);
  assert.equal(store.getState().history, points);
  assert.equal(store.getState().selectedRange, "1M");
  assert.equal(store.getState().isHistoryLoading, false);
  await store.getState().loadHistory("wallet", "1M");
  assert.equal(requests, 2, "explicit refresh bypasses freshness");
});

test("stale refresh retains the chart, including when refresh fails", async () => {
  const pending = deferred();
  let requests = 0;
  const points = [{ timestamp: "2026-11-18T10:00:00Z", totalValueUsd: 12 }];
  const store = historyStore(() => ++requests === 1 ? Promise.resolve(points) : pending.promise);
  await store.getState().loadHistory("wallet", "1W");
  store.setState({ historyCache: { "wallet:1W": { points, updatedAt: 0 } } });
  const refresh = store.getState().loadHistory("wallet", "1W", false);
  assert.equal(store.getState().history, points);
  assert.equal(store.getState().isHistoryLoading, false);
  pending.reject(new Error("offline"));
  await refresh;
  assert.equal(store.getState().history, points);
  assert.equal(store.getState().historyError, "offline");
});

test("history caches distinguish wallet/range and reset removes private points", async () => {
  const store = historyStore(async (wallet, range) => [{ timestamp: range, totalValueUsd: wallet === "a" ? 1 : 2 }]);
  await store.getState().loadHistory("a", "1W", false);
  await store.getState().loadHistory("a", "1D", false);
  await store.getState().loadHistory("b", "1W", false);
  assert.equal(store.getState().history[0].totalValueUsd, 2);
  await store.getState().loadHistory("a", "1W", false);
  assert.equal(store.getState().history[0].timestamp, "1W");
  assert.equal(store.getState().history[0].totalValueUsd, 1);
  store.getState().reset();
  assert.equal(Object.keys(store.getState().historyCache).length, 0);
  assert.equal(store.getState().historyKey, undefined);
});

test("cached empty history stays resolved on return", async () => {
  let requests = 0;
  const store = historyStore(async () => { requests++; return []; });
  await store.getState().loadHistory("wallet", "1W", false);
  await store.getState().loadHistory("wallet", "1W", false);
  assert.equal(requests, 1);
  assert.equal(store.getState().isHistoryLoading, false);
});

test("post-trade refresh keeps the selected chart range and bypasses navigation cache", async () => {
  const calls = [];
  const state = {
    selectedRange: "3M",
    loadPortfolio: async () => {},
    loadActivity: async () => {},
    loadHistory: async (...args) => { calls.push(args); },
  };
  const exports = {};
  const source = readFileSync(new URL("../hooks/use-portfolio-refresh.ts", import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports,
    require(id) {
      if (id === "react") return { useCallback: (fn) => fn };
      if (["@/store/portfolio-store", "@/store/wallet-store"].includes(id)) return { useWalletStore: (select) => select({ address: "wallet" }), usePortfolioStore: (select) => select(state) };
      return require(id);
    },
  });
  await exports.usePortfolioRefresh()();
  await exports.usePortfolioRefresh("1D")(false);
  assert.deepEqual(calls, [["wallet", "3M", true], ["wallet", "1D", false]]);
});
