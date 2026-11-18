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
      if (id === "@/services") return { getPortfolioHistory };
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
