import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createContext, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const messages = JSON.parse(readFileSync(new URL("../i18n/messages/en.json", import.meta.url), "utf8"));
const transpile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

test("startup recovery is server-rendered with a native link and disappears after hydration", () => {
  let hydrated = false;
  const exports = {};
  vm.runInNewContext(transpile("../components/startup-recovery.tsx"), {
    exports,
    require(id) {
      if (id === "react") return { useSyncExternalStore: (_subscribe, client, server) => hydrated ? client() : server() };
      return require(id);
    },
  });
  const html = renderToStaticMarkup(createElement(exports.StartupRecovery));
  assert.match(html, /<a[^>]*href=""/);
  assert.ok(html.includes(messages.auth.reload));
  assert.match(html, /startup-recovery_0s_15s_forwards/);
  hydrated = true;
  assert.equal(renderToStaticMarkup(createElement(exports.StartupRecovery)), "");
});

test("the app wallet context shares session values without loading wallet-adapter runtime", () => {
  const exports = {};
  vm.runInNewContext(transpile("../components/auth/wallet-context.tsx"), {
    exports,
    require(id) {
      assert.notEqual(id, "@solana/wallet-adapter-react");
      return require(id);
    },
  });
  const session = { connected: true, publicKey: "owned-wallet" };
  let seen;
  function Probe() { seen = exports.useWallet(); return null; }
  renderToStaticMarkup(createElement(exports.WalletContext.Provider, { value: session }, createElement(Probe)));
  assert.equal(seen, session);
  assert.throws(() => renderToStaticMarkup(createElement(Probe)), /outside AppProviders/);
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function chunkError() {
  const error = new Error("Loading chunk 884 failed.");
  error.name = "ChunkLoadError";
  return error;
}

function loadChunkModule(window, env = {}) {
  const exports = {};
  vm.runInNewContext(transpile("../lib/chunk-reload.ts"), {
    exports,
    window,
    Date,
    process: { env: { NEXT_PUBLIC_COMMIT_SHA: "deploy-sha", ...env } },
  });
  return exports;
}

function browserWindow(storage = memoryStorage()) {
  const listeners = new Map();
  let reloads = 0;
  return {
    reloads: () => reloads,
    sessionStorage: storage,
    location: { reload() { reloads += 1; } },
    addEventListener(type, fn) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    removeEventListener() {},
    dispatchEvent(event) {
      for (const fn of listeners.get(event.type) ?? []) fn(event);
    },
    setTimeout(fn, ms) {
      const id = this.timers.length + 1;
      this.timers.push({ id, fn, at: this.now + ms });
      return id;
    },
    clearTimeout(id) {
      const timer = this.timers.find((item) => item.id === id);
      if (timer) timer.cleared = true;
    },
    timers: [],
    now: 1_700_000_000_000,
  };
}

test("a chunk load error reloads once, then asks for a manual reload", () => {
  const storage = memoryStorage();
  const firstWindow = browserWindow(storage);
  const first = loadChunkModule(firstWindow);
  let gaveUp = 0;
  first.installChunkLoadRecovery(() => { gaveUp += 1; });
  firstWindow.dispatchEvent({ type: "error", error: new Error("Failed to fetch"), message: "Failed to fetch", filename: "" });
  firstWindow.dispatchEvent({
    type: "error",
    error: new Error("script"),
    message: "Loading chunk 9 failed.",
    filename: "/_next/static/chunks/old.js",
  });
  assert.equal(firstWindow.reloads(), 0);

  firstWindow.dispatchEvent({ type: "error", error: chunkError(), message: "Loading chunk 884 failed.", filename: "/_next/static/chunks/old.js" });
  assert.equal(firstWindow.reloads(), 1);
  assert.equal(gaveUp, 0);
  firstWindow.dispatchEvent({ type: "error", error: chunkError(), message: "Loading chunk 884 failed.", filename: "" });
  assert.equal(firstWindow.reloads(), 1);

  const secondWindow = browserWindow(storage);
  const second = loadChunkModule(secondWindow);
  second.installChunkLoadRecovery(() => { gaveUp += 1; });
  const rejection = { type: "unhandledrejection", reason: chunkError(), preventDefault() { rejection.defaultPrevented = true; } };
  secondWindow.dispatchEvent(rejection);
  assert.equal(secondWindow.reloads(), 0);
  assert.equal(gaveUp, 1);
  assert.equal(rejection.defaultPrevented, true);
});

function mountPrivy({ fail }) {
  const slots = [];
  const records = [];
  let cursor = 0;
  const pending = [];
  let seen;
  const AuthContext = createContext(null);
  const window = browserWindow();
  const clock = { now: () => window.now };
  const bridge = {};
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => {
        slots[index] = typeof value === "function" ? value(slots[index]) : value;
      }];
    },
    useEffect(effect, deps) { pending.push({ effect, deps }); },
    useContext: (context) => context.value,
    createElement,
  };
  AuthContext.Provider = function Provider({ value, children }) {
    AuthContext.value = value;
    return children;
  };

  const exports = {};
  vm.runInNewContext(transpile("../app/providers.tsx"), {
    exports,
    window,
    Date: clock,
    process: { env: { NEXT_PUBLIC_PRIVY_APP_ID: "offline-app" } },
    require(id) {
      if (id === "react") return hooks;
      if (id === "react/jsx-runtime") return require("react/jsx-runtime");
      if (id === "next/dynamic") return { default: (load) => { bridge.load = load; return (props) => { bridge.publish = props.onSession; return null; }; } };
      if (id === "@/components/auth/wallet-context") return { WalletContext: createContext({}) };
      if (id === "@/components/auth/auth-context") return { AuthContext };
      if (id === "@/components/auth/wallet-modal-context") return { WalletModalContext: createContext({}) };
      if (id === "@/components/auth/privy-auth") {
        if (fail) throw chunkError();
        return { PrivyAuth() { return null; } };
      }
      if (id === "@/lib/performance-client") return { recordPerformanceMetric() {} };
      if (id === "@/lib/chunk-reload") {
        const loaded = {};
        vm.runInNewContext(transpile("../lib/chunk-reload.ts"), {
          exports: loaded,
          window,
          Date: clock,
          process: { env: { NEXT_PUBLIC_COMMIT_SHA: "deploy-sha" } },
        });
        return loaded;
      }
      if (id === "@/i18n/i18n") return require(id);
      return require(id);
    },
  });

  function render() {
    cursor = 0;
    pending.length = 0;
    return renderToStaticMarkup(createElement(exports.AppProviders, null, createElement(function Probe() {
      seen = AuthContext.value;
      return "shell";
    })));
  }

  function flush() {
    const effects = pending.splice(0);
    effects.forEach((entry, index) => {
      const prev = records[index];
      const same = prev?.deps && entry.deps && prev.deps.length === entry.deps.length && entry.deps.every((dep, i) => Object.is(dep, prev.deps[i]));
      if (same) return;
      prev?.cleanup?.();
      records[index] = { deps: entry.deps, cleanup: entry.effect() };
    });
    records.length = effects.length;
  }

  function settle() {
    let html = render();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const snapshot = JSON.stringify(slots);
      flush();
      if (JSON.stringify(slots) === snapshot) return html;
      html = render();
    }
    return html;
  }

  return {
    stillMs: exports.PRIVY_STILL_LOADING_MS,
    timeoutMs: exports.PRIVY_READY_TIMEOUT_MS,
    settle,
    auth: () => seen,
    reloads: () => window.reloads(),
    async load() { seen.open(); settle(); await bridge.load(); },
    publish(auth) { bridge.publish({ auth, wallet: {}, modal: {} }); },
    advance(ms) {
      window.now += ms;
      for (const timer of window.timers) {
        if (!timer.cleared && !timer.fired && timer.at <= window.now) {
          timer.fired = true;
          timer.fn();
        }
      }
    },
    remount() {
      for (const record of records) record?.cleanup?.();
      records.length = 0;
      slots.length = 0;
    },
  };
}

test("a rejected Privy import reloads once and then shows Reload instead of waiting", async () => {
  const source = readFileSync(new URL("../app/providers.tsx", import.meta.url), "utf8");
  assert.match(source, /t\("auth\.restoreSlow"\)/);
  assert.match(source, /t\("auth\.reload"\)/);
  assert.doesNotMatch(source, /preview/i);

  const page = mountPrivy({ fail: true });
  assert.doesNotMatch(page.settle(), /<button/);
  await page.load();
  assert.equal(page.reloads(), 1);
  assert.doesNotMatch(page.settle(), /taking longer than usual/);

  page.advance(10 * 60 * 1000);
  page.remount();
  page.settle();
  page.remount();
  const html = page.settle();
  assert.equal(page.reloads(), 1);
  assert.match(html, new RegExp(`<button[^>]*>${messages.auth.reload}</button>`));
  assert.ok(html.includes(messages.auth.restoreSlow));
  assert.doesNotMatch(html, /preview/i);
  assert.equal(page.auth().ready, true);
  assert.equal(page.auth().authenticated, false);
  assert.equal(page.auth().restoreError, "auth.restoreSlow");
  page.auth().open();
  assert.equal(page.reloads(), 2);
  page.auth().openDeposit();
  assert.equal(page.reloads(), 3);
});

test("a chunk failure after any delay does not reload a second time for the same deploy", () => {
  const storage = memoryStorage();
  let now = 1_700_000_000_000;
  const firstWindow = browserWindow(storage);
  const first = loadChunkModule(firstWindow);
  const reloads = [];
  assert.equal(first.reloadOnceForChunkFailure(() => reloads.push(now), storage), true);
  now += 24 * 60 * 60 * 1000;
  firstWindow.now = now;
  assert.equal(first.reloadOnceForChunkFailure(() => reloads.push(now), storage), false);
  const second = loadChunkModule(browserWindow(storage));
  assert.equal(second.reloadOnceForChunkFailure(() => reloads.push(now), storage), false);
  assert.deepEqual(reloads, [1_700_000_000_000]);
});

test("blocked sessionStorage falls through to manual recovery", () => {
  const window = {
    get sessionStorage() {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
    location: { reload() { throw new Error("reload should not run"); } },
  };
  const recovery = loadChunkModule(window);
  assert.equal(recovery.reloadOnceForChunkFailure(), false);
});

test("restore timeout includes the SDK download and does not restart when it loads", async () => {
  const page = mountPrivy({ fail: false });
  page.settle();
  page.advance(page.stillMs - 1);
  assert.doesNotMatch(page.settle(), /still loading|longer than usual/);

  page.advance(1);
  const still = page.settle();
  assert.ok(still.includes(messages.auth.restoreStillLoading));
  assert.doesNotMatch(still, /longer than usual|preview/i);

  await page.load();
  page.settle();

  page.advance(page.timeoutMs - page.stillMs);
  const slow = page.settle();
  assert.ok(slow.includes(messages.auth.restoreSlow));
  assert.match(slow, new RegExp(`<button[^>]*>${messages.auth.reload}</button>`));
  assert.doesNotMatch(slow, /preview/i);
  assert.equal(page.auth().restoreTimedOut, true);
  assert.equal(page.auth().ready, false);
  assert.equal(page.auth().authenticated, false);
  page.auth().open();
  assert.equal(page.reloads(), 0);
});

test("a stalled SDK download offers reload and a late ready session clears recovery", () => {
  const page = mountPrivy({ fail: false });
  page.settle();
  page.advance(page.timeoutMs);
  assert.ok(page.settle().includes(messages.auth.restoreSlow));
  assert.equal(page.auth().restoreTimedOut, true);
  assert.equal(page.auth().ready, false);
  page.auth().open();
  assert.equal(page.reloads(), 1);
  page.publish({ ready: true, authenticated: true, configured: true });
  assert.ok(!page.settle().includes(messages.auth.restoreSlow));
  assert.equal(page.auth().restoreTimedOut, undefined);
  assert.equal(page.auth().authenticated, true);
});

function dashboardRequire(auth) {
  const ui = {
    Button: ({ children }) => createElement("button", { type: "button" }, children),
    Card: ({ children }) => createElement("div", null, children),
    CardContent: ({ children }) => createElement("div", null, children),
    CardHeader: ({ children }) => createElement("div", null, children),
    EmptyState: ({ title, description, action }) => createElement("section", null, createElement("h3", null, title), createElement("p", null, description), action),
    ErrorState: () => null,
    Skeleton: () => null,
    Table: ({ children }) => createElement("table", null, children),
    TableBody: ({ children }) => createElement("tbody", null, children),
    TableCell: ({ children }) => createElement("td", null, children),
    TableHead: ({ children }) => createElement("th", null, children),
    TableHeader: ({ children }) => createElement("thead", null, children),
    TableRow: ({ children }) => createElement("tr", null, children),
    cn: (...parts) => parts.filter(Boolean).join(" "),
    formatCurrency: (value) => String(value ?? ""),
    formatDate: () => "",
    formatMonth: () => "",
    formatNumber: (value) => String(value ?? ""),
    formatPercent: (value) => String(value ?? ""),
    formatRelativeTime: () => "",
    weekdayLabels: () => [],
  };
  const storeState = {
    address: undefined,
    connected: false,
    portfolio: null,
    history: [],
    activity: [],
    isLoading: false,
    error: null,
    calendar: null,
    calendarDay: null,
    isCalendarLoading: false,
    summary: null,
    positions: [],
    programLive: false,
    reset() {},
    loadPortfolio() {},
    loadCalendar() {},
    loadCalendarDay() {},
    loadVaults() {},
  };
  let restoreModule;
  function sandboxRequire(id) {
    if (id === "react" || id === "react/jsx-runtime") return require(id);
    if (id === "@/i18n/i18n") return require(id);
    if (id === "@/components/ui") return ui;
    if (id === "@/components/brand/oren-logo") return { OrenLogo: () => null };
    if (id === "@/hooks/use-anchored-popover") return loadModule("../hooks/use-anchored-popover.ts", sandboxRequire);
    if (id === "@/components/auth/auth-context" || id === "./auth-context") return { useOrenAuth: () => auth };
    if (id === "@/components/auth/restore-actions") {
      restoreModule ??= loadModule("../components/auth/restore-actions.tsx", sandboxRequire);
      return restoreModule;
    }
    if (["@/store", "@/store/portfolio-store", "@/store/wallet-store"].includes(id)) return {
      useWalletStore: (select) => select(storeState),
      usePortfolioStore: (select) => select(storeState),
      useVaultStore: (select) => select(storeState),
    };
    if (id === "@/hooks/use-portfolio-refresh") return { usePortfolioRefresh: () => async () => {} };
    if (id === "./portfolio-skeleton") return { PortfolioSkeleton: () => null };
    if (id === "./portfolio-summary-card") return { PortfolioSummaryCard: () => null };
    if (id === "./portfolio-tables") return { PortfolioTables: () => null };
    if (id === "@/components/portfolio/activity-list") return { ActivityList: () => null };
    if (id === "@/services/environment") return { financialExecutionEnabled: false };
    if (id === "./vault-review-modal") return { VaultReviewModal: () => null };
    if (id === "next/link") return { default: ({ children }) => createElement("a", null, children) };
    if (id === "next/dynamic") return { default: () => () => null };
    if (id === "lucide-react") return new Proxy({}, { get: () => () => null });
    if (id === "@/components/ui/interface-icon") return { InterfaceIcon: () => null };
    throw new Error(`unexpected import ${id}`);
  }
  return sandboxRequire;
}

function renderSignedOut(path, name, auth) {
  const sandboxRequire = dashboardRequire(auth);
  const loaded = loadModule(path, sandboxRequire);
  return renderToStaticMarkup(createElement(loaded[name]));
}

function loadModule(path, sandboxRequire) {
  const exports = {};
  vm.runInNewContext(transpile(path), { exports, require: sandboxRequire, window: { location: { reload() {} } } });
  return exports;
}

test("PortfolioDashboard offers Reload and Sign in when restore failed or timed out", () => {
  const waiting = renderSignedOut("../components/portfolio/portfolio-dashboard.tsx", "PortfolioDashboard", { ready: false, authenticated: false, open() {} });
  assert.match(waiting, /Restoring your account/);
  assert.doesNotMatch(waiting, /<button/);

  for (const auth of [
    { ready: false, authenticated: false, restoreError: "auth.restoreSlow", open() {} },
    { ready: true, authenticated: false, restoreError: "auth.restoreSlow", open() {} },
    { ready: false, authenticated: false, restoreTimedOut: true, open() {} },
  ]) {
    const html = renderSignedOut("../components/portfolio/portfolio-dashboard.tsx", "PortfolioDashboard", auth);
    assert.match(html, new RegExp(`<button[^>]*>${messages.auth.reload}</button>`));
    assert.match(html, new RegExp(`<button[^>]*>${messages.portfolio.signIn}</button>`));
    assert.ok(html.includes(messages.auth.restoreSlow));
    assert.doesNotMatch(html, /Restoring your account/);
  }
});

test("account, vault, and calendar gates offer Reload and Sign in when restore failed", () => {
  const auth = { configured: true, ready: false, authenticated: false, restoreError: "auth.restoreSlow", open() {} };
  const account = renderSignedOut("../components/shell/account-menu.tsx", "AccountMenu", auth);
  const vault = renderSignedOut("../components/vault/vault-dashboard.tsx", "VaultDashboard", auth);
  const calendar = renderSignedOut("../components/calendar/trading-calendar.tsx", "TradingCalendar", auth);
  for (const html of [account, vault, calendar]) {
    assert.match(html, new RegExp(`<button[^>]*>${messages.auth.reload}</button>`));
    assert.match(html, /<button[^>]*>Sign in<\/button>/);
    assert.doesNotMatch(html, /Restoring your account|Loading account/);
  }

  const waiting = { configured: true, ready: false, authenticated: false, open() {} };
  assert.match(renderSignedOut("../components/shell/account-menu.tsx", "AccountMenu", waiting), /Loading account/);
  assert.doesNotMatch(renderSignedOut("../components/shell/account-menu.tsx", "AccountMenu", waiting), /<button/);
  assert.match(renderSignedOut("../components/vault/vault-dashboard.tsx", "VaultDashboard", waiting), /Restoring your account/);
  assert.match(renderSignedOut("../components/calendar/trading-calendar.tsx", "TradingCalendar", waiting), /Restoring your account/);
});

test("a failed page chunk uses generic catalog copy", () => {
  const source = readFileSync(new URL("../components/chunk-load-recovery.tsx", import.meta.url), "utf8");
  assert.match(source, /t\("common\.chunkFailed"\)/);
  assert.doesNotMatch(source, /auth\.restoreSlow/);
  assert.equal(messages.common.chunkFailed, "Part of the page failed to load. Reload to try again.");
  for (const locale of ["de", "fr", "id", "pt-BR", "uk", "vi", "zh-CN", "zh-TW"]) {
    const catalog = JSON.parse(readFileSync(new URL(`../i18n/messages/${locale}.json`, import.meta.url), "utf8"));
    assert.notEqual(catalog.common.chunkFailed, messages.common.chunkFailed, locale);
  }
});

test("deployment id follows the commit already baked into the web image", () => {
  const source = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(source, /deploymentId/);
  assert.match(source, /NEXT_PUBLIC_COMMIT_SHA/);
});
