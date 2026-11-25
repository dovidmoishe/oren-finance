import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createContext, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const en = JSON.parse(readFileSync(new URL("../i18n/messages/en.json", import.meta.url), "utf8"));
const transpile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const tick = () => new Promise((resolve) => setImmediate(resolve));

function storage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    has: (key) => values.has(key),
  };
}

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) ?? []), fn]); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== fn)); },
    dispatchEvent(event) { for (const fn of listeners.get(event.type) ?? []) fn(event); return true; },
    count: (type) => (listeners.get(type) ?? []).length,
  };
}

/** A browser with a cookie jar that keeps name=value pairs, like document.cookie. */
function browser({ cookie = "", local = {}, navigator = {}, https = true } = {}) {
  const jar = new Map(cookie.split(";").map((part) => part.trim()).filter(Boolean).map((part) => part.split("=")));
  const written = [];
  const document = {
    documentElement: { dataset: {} },
    get cookie() { return [...jar].map(([name, value]) => `${name}=${value}`).join("; "); },
    set cookie(value) {
      written.push(value);
      const [pair] = value.split(";");
      const [name, ...rest] = pair.split("=");
      jar.set(name.trim(), rest.join("="));
    },
  };
  const window = { ...eventTarget(), localStorage: storage(local), location: { protocol: https ? "https:" : "http:" } };
  return { document, window, navigator, written };
}

function loadConsent(env) {
  const exports = {};
  vm.runInNewContext(transpile("../lib/consent.ts"), {
    exports, document: env.document, window: env.window, navigator: env.navigator, Event: class { constructor(type) { this.type = type; } },
  });
  return exports;
}

test("consent reads only its own versioned cookie, and privacy signals refuse without asking", () => {
  const consent = loadConsent(browser());
  assert.equal(consent.consentFromCookie("a=1; oren-consent=1.granted; b=2"), "granted");
  assert.equal(consent.consentFromCookie("oren-consent=1.denied"), "denied");
  for (const cookie of ["", "oren-consent=yes", "oren-consent=0.granted", "x-oren-consent=1.granted"]) {
    assert.equal(consent.consentFromCookie(cookie), undefined, cookie);
  }
  assert.equal(consent.hasPrivacySignal({ globalPrivacyControl: true }), true);
  assert.equal(consent.hasPrivacySignal({ doNotTrack: "1" }), true);
  assert.equal(consent.hasPrivacySignal({ doNotTrack: "0" }), false);
  assert.equal(loadConsent(browser({ navigator: { globalPrivacyControl: true } })).currentConsent(), "denied");
  assert.equal(loadConsent(browser({ cookie: "oren-consent=1.granted", navigator: { globalPrivacyControl: true } })).currentConsent(), "granted");
});

test("the head script marks the page pending before paint only when nothing is decided", () => {
  const { consentBootScript } = loadConsent(browser());
  const run = (env) => {
    vm.runInNewContext(consentBootScript, { document: env.document, navigator: env.navigator });
    return env.document.documentElement.dataset.consent;
  };
  assert.equal(run(browser()), "pending");
  assert.equal(run(browser({ cookie: "oren-consent=yes" })), "pending");
  assert.equal(run(browser({ cookie: "oren-consent=1.granted" })), undefined);
  assert.equal(run(browser({ cookie: "theme=dark; oren-consent=1.denied" })), undefined);
  assert.equal(run(browser({ navigator: { globalPrivacyControl: true } })), undefined);
  assert.equal(run(browser({ navigator: { doNotTrack: "1" } })), undefined);
});

test("refusing analytics saves the choice, hides the notice and deletes analytics state", () => {
  const env = browser({ local: { "oren.growth.v1": "{\"visitorId\":\"v\"}", "oren-theme": "dark" } });
  env.document.documentElement.dataset.consent = "pending";
  const consent = loadConsent(env);
  let notified = 0;
  consent.subscribeConsent(() => { notified += 1; });
  assert.equal(consent.currentConsent(), undefined);
  consent.setConsent("denied");
  assert.match(env.written[0], /^oren-consent=1\.denied; Path=\/; Max-Age=\d+; SameSite=Lax; Secure$/);
  assert.equal(Number(env.written[0].match(/Max-Age=(\d+)/)[1]) <= 60 * 60 * 24 * 183, true);
  assert.equal(env.document.documentElement.dataset.consent, undefined);
  assert.equal(env.window.localStorage.has("oren.growth.v1"), false);
  assert.equal(env.window.localStorage.has("oren-theme"), true);
  assert.equal(consent.analyticsAllowed(), false);
  assert.equal(notified, 1);

  consent.setConsent("granted");
  assert.equal(consent.analyticsAllowed(), true);
  assert.equal(notified, 2);
  let opened = 0;
  env.window.addEventListener(consent.CONSENT_OPEN_EVENT, () => { opened += 1; });
  consent.openConsentSettings();
  assert.equal(env.document.documentElement.dataset.consent, "pending");
  assert.equal(opened, 1);
});

test("local development over http stores the choice without the Secure attribute", () => {
  const env = browser({ https: false });
  loadConsent(env).setConsent("granted");
  assert.doesNotMatch(env.written[0], /Secure/);
});

function performanceClient(state) {
  const sent = [];
  const listeners = new Set();
  const consent = {
    analyticsAllowed: () => state.consent === "granted",
    currentConsent: () => state.consent,
    subscribeConsent: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
  const exports = {};
  vm.runInNewContext(transpile("../lib/performance-client.ts"), {
    exports, process: { env: { NEXT_PUBLIC_PERFORMANCE_SAMPLE_RATE: "1" } }, Math, Number, JSON,
    window: { location: { pathname: "/app" }, innerWidth: 390 }, navigator: { userAgent: "Chrome/140" },
    fetch: async (...args) => { sent.push(JSON.parse(args[1].body)); }, setTimeout: () => 1, clearTimeout() {},
    require(id) {
      if (id === "./consent") return consent;
      if (id === "./performance-schema") return { routeBucket: () => "portfolio" };
      return require(id);
    },
  });
  return { ...exports, sent, decide(choice) { state.consent = choice; for (const fn of listeners) fn(); } };
}

test("performance timings wait in memory until analytics is accepted, and refusal drops them", () => {
  const undecided = performanceClient({ consent: undefined });
  undecided.recordPerformanceMetric({ name: "LCP", value: 1200 });
  undecided.recordPerformanceMetric({ name: "FCP", value: 800 });
  undecided.flushPerformanceMetrics();
  assert.equal(undecided.sent.length, 0);
  undecided.decide("granted");
  assert.deepEqual(undecided.sent.flat().map((metric) => metric.name), ["LCP", "FCP"]);

  const refused = performanceClient({ consent: undefined });
  refused.recordPerformanceMetric({ name: "LCP", value: 1200 });
  refused.decide("denied");
  refused.decide("granted");
  assert.equal(refused.sent.length, 0);

  const denied = performanceClient({ consent: "denied" });
  denied.recordPerformanceMetric({ name: "LCP", value: 1200 });
  denied.flushPerformanceMetrics();
  assert.equal(denied.sent.length, 0);

  const capped = performanceClient({ consent: undefined });
  for (let index = 0; index < 60; index += 1) capped.recordPerformanceMetric({ name: "LCP", value: index });
  capped.decide("granted");
  assert.equal(capped.sent.flat().length, 24);
});

function growthCollector(consentState) {
  const posts = [];
  const local = storage({ "oren.growth.v1": JSON.stringify({ visitorId: "v1", sessionId: "s1", sessionSeenAt: Date.now(), first: { source: "x" } }) });
  const exports = {};
  vm.runInNewContext(transpile("../components/growth/growth-collector.tsx"), {
    exports, localStorage: local, crypto: { randomUUID: () => "uuid" }, URLSearchParams, URL, JSON, Date, TextEncoder, btoa,
    window: { location: { search: "", host: "oren.finance", pathname: "/" } },
    document: { referrer: "", addEventListener() {}, removeEventListener() {} },
    navigator: { userAgent: "test" },
    fetch: async (url, init) => { posts.push(JSON.parse(init.body)); },
    require(id) {
      if (id === "react") return { useEffect: (effect) => effect() };
      if (id === "next/navigation") return { usePathname: () => "/" };
      if (id === "@/services/api-client") return { buildApiUrl: (path) => path };
      if (id === "@/lib/consent") return { analyticsAllowed: () => consentState === "granted" };
      if (id === "@/lib/use-consent") return { useConsent: () => consentState };
      if (id === "@/lib/growth-client.mjs") return {
        nextSession: (state, now) => ({ sessionId: state.sessionId ?? "new", sessionSeenAt: now }),
        nextAttribution: (state) => state, readUtms: () => null, attributionHeader: () => "header", referrerOrigin: () => undefined,
      };
      return require(id);
    },
  });
  return { ...exports, posts, local };
}

test("visit analytics send and store nothing until the visitor accepts", () => {
  for (const state of ["unknown", "undecided", "denied"]) {
    const growth = growthCollector(state);
    growth.GrowthCollector();
    growth.trackSetup("copy_instructions", "setup");
    assert.equal(growth.posts.length, 0, state);
    assert.deepEqual({ ...growth.consentAttributionHeader() }, {}, state);
  }
  const accepted = growthCollector("granted");
  accepted.GrowthCollector();
  assert.equal(accepted.posts.length, 1);
  assert.equal(accepted.posts[0].event, "pageview");
  assert.deepEqual({ ...accepted.consentAttributionHeader() }, { "X-Oren-Attribution": "header" });
});

test("a Privy session is detected from its tokens or cookies, and only Privy's", () => {
  const exports = {};
  vm.runInNewContext(transpile("../components/auth/privy-session-hint.ts"), { exports });
  const { hasPrivySession, isPrivyTokenKey } = exports;
  assert.equal(hasPrivySession({ cookie: "", local: storage({ "privy:caid": "x", "oren-theme": "dark", "privy:connections": "[]" }) }), false);
  assert.equal(hasPrivySession({ cookie: "", local: storage({ "privy:refresh_token": "\"r\"" }) }), true);
  assert.equal(hasPrivySession({ cookie: "", local: storage({ "privy:token": "\"t\"" }) }), true);
  assert.equal(hasPrivySession({ cookie: "", local: storage({ "privy:app-1:token": "\"t\"" }) }), true);
  assert.equal(hasPrivySession({ cookie: "", local: storage(), session: storage({ "privy:refresh_token": "\"r\"" }) }), true);
  assert.equal(hasPrivySession({ cookie: "NEXT_LOCALE=en; privy-session=t", local: storage() }), true);
  assert.equal(hasPrivySession({ cookie: "NEXT_LOCALE=en; xprivy-session=t", local: storage() }), false);
  assert.equal(isPrivyTokenKey("privy:refresh_token"), true);
  assert.equal(isPrivyTokenKey(null), true);
  assert.equal(isPrivyTokenKey("privy:caid"), false);
  const blocked = {};
  vm.runInNewContext(transpile("../components/auth/privy-session-hint.ts"), {
    exports: blocked, document: { cookie: "" },
    window: { get localStorage() { throw new Error("SecurityError"); } },
  });
  assert.equal(blocked.browserHasPrivySession(), true);
});

/** Mounts AppProviders with effects, timers and storage, and records Privy activity. */
function mountProviders({ local = {}, cookie = "", pathname = "/app", search = "" } = {}) {
  let currentPath = pathname;
  const slots = [];
  const records = [];
  const pending = [];
  let cursor = 0;
  let seen;
  let now = 1_700_000_000_000;
  const timers = [];
  const privy = { imports: 0, mounted: 0, preconnects: [] };
  const AuthContext = createContext(null);
  AuthContext.Provider = function Provider({ value, children }) { AuthContext.value = value; return children; };
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useEffect(effect, deps) { pending.push({ effect, deps }); },
    useSyncExternalStore(subscribe, getSnapshot) {
      if (!subscribed) { subscribed = true; subscribe(() => {}); }
      return getSnapshot();
    },
    useContext: (context) => context.value,
    createElement,
  };
  let subscribed = false;
  const window = {
    ...eventTarget(),
    localStorage: storage(local),
    sessionStorage: storage(),
    location: { reload() {}, search },
    requestAnimationFrame(fn) { fn(); return 0; },
    cancelAnimationFrame() {},
    setTimeout(fn, ms) { timers.push({ fn, at: now + ms }); return timers.length; },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].cleared = true; },
  };
  const document = { cookie };
  const exports = {};
  vm.runInNewContext(transpile("../app/providers.tsx"), {
    exports, window, document, URLSearchParams, Date: { now: () => now },
    process: { env: { NEXT_PUBLIC_PRIVY_APP_ID: "offline-app" } },
    require(id) {
      if (id === "react") return hooks;
      if (id === "react/jsx-runtime") return require("react/jsx-runtime");
      if (id === "react-dom") return { preconnect: (href) => privy.preconnects.push(href) };
      if (id === "next/navigation") return { usePathname: () => currentPath };
      if (id === "next/dynamic") return { default: (load) => { privy.load = load; return (props) => { privy.mounted += 1; privy.publish = props.onSession; return null; }; } };
      if (id === "@/components/auth/privy-auth") { privy.imports += 1; return { PrivyAuth() { return null; } }; }
      if (id === "@/components/auth/privy-session-hint") {
        const loaded = {};
        vm.runInNewContext(transpile("../components/auth/privy-session-hint.ts"), { exports: loaded, window, document });
        return loaded;
      }
      if (id === "@/components/auth/wallet-context") return { WalletContext: createContext({}) };
      if (id === "@/components/auth/auth-context") return { AuthContext };
      if (id === "@/components/auth/wallet-modal-context") return { WalletModalContext: createContext({}) };
      if (id === "@/lib/performance-client") return { recordPerformanceMetric() {} };
      if (id === "@/lib/chunk-reload") return { reloadOnceForChunkFailure: () => false };
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
  function settle() {
    let html = render();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const snapshot = JSON.stringify(slots, (_key, value) => (typeof value === "object" && value?.auth ? "[session]" : value));
      const effects = pending.splice(0);
      effects.forEach((entry, index) => {
        const prev = records[index];
        const same = prev?.deps && entry.deps && prev.deps.length === entry.deps.length && entry.deps.every((dep, i) => Object.is(dep, prev.deps[i]));
        if (same) return;
        prev?.cleanup?.();
        records[index] = { deps: entry.deps, cleanup: entry.effect() };
      });
      records.length = effects.length;
      html = render();
      if (JSON.stringify(slots, (_key, value) => (typeof value === "object" && value?.auth ? "[session]" : value)) === snapshot) return html;
    }
    return html;
  }
  return {
    privy, window, settle,
    auth: () => seen,
    advance(ms) {
      now += ms;
      for (const timer of timers) if (!timer.cleared && !timer.fired && timer.at <= now) { timer.fired = true; timer.fn(); }
    },
    publish(auth) { privy.publish({ auth, wallet: { connected: Boolean(auth.authenticated) }, modal: { visible: false, setVisible() {} } }); },
    /** A client-side navigation: the pathname and query change without a reload. */
    navigate(path, query = "") {
      currentPath = path;
      window.location.search = query;
    },
    /** Whether the latest render still renders Privy. */
    privyMounted() {
      privy.mounted = 0;
      settle();
      return privy.mounted > 0;
    },
  };
}

test("a browser without a Privy session sees Sign in at once and never downloads Privy", async () => {
  const page = mountProviders({ local: { "privy:caid": "analytics-id", "oren-theme": "light" } });
  const html = page.settle();
  await tick();
  assert.equal(page.auth().ready, true);
  assert.equal(page.auth().authenticated, false);
  assert.equal(page.auth().busy, false);
  assert.equal(page.privy.mounted, 0);
  assert.equal(page.privy.imports, 0);
  assert.deepEqual(page.privy.preconnects, []);
  assert.doesNotMatch(html, /still loading|longer than usual/);
  page.advance(60_000);
  assert.doesNotMatch(page.settle(), /still loading|longer than usual/);
  assert.equal(page.auth().restoreTimedOut, undefined);
});

test("signing in from that state loads Privy on demand, shows progress, then opens Privy's dialog", async () => {
  const page = mountProviders();
  page.settle();
  page.auth().prefetch();
  await tick();
  assert.equal(page.privy.imports, 1);
  assert.equal(page.privy.mounted, 0);

  page.auth().open();
  const waiting = page.settle();
  assert.equal(page.privy.mounted > 0, true);
  assert.match(waiting, /role="status"/);
  assert.ok(waiting.includes(en.auth.title));
  assert.equal(page.auth().busy, true);
  assert.equal(page.auth().ready, true);

  let opened = 0;
  page.publish({ ready: false, authenticated: false, configured: true, open() { opened += 1; }, openDeposit() {} });
  const loaded = page.settle();
  assert.equal(opened, 1);
  assert.doesNotMatch(loaded, new RegExp(en.auth.title));
  assert.equal(page.auth().ready, true);
  assert.equal(page.auth().authenticated, false);

  page.publish({ ready: true, authenticated: true, configured: true, address: "wallet", open() {}, openDeposit() {} });
  page.settle();
  assert.equal(page.auth().authenticated, true);
  assert.equal(page.auth().address, "wallet");
});

test("a saved Privy session starts downloading at once and restores without an idle wait", async () => {
  const page = mountProviders({ local: { "privy:token": "\"t\"", "privy:refresh_token": "\"r\"" } });
  await tick();
  assert.equal(page.privy.imports, 1, "download starts before the first render");
  assert.deepEqual(page.privy.preconnects, ["https://auth.privy.io"]);
  page.settle();
  assert.equal(page.privy.mounted > 0, true);
  assert.equal(page.auth().ready, false);
  page.publish({ ready: true, authenticated: true, configured: true, address: "wallet", open() {}, openDeposit() {} });
  page.settle();
  assert.equal(page.auth().authenticated, true);
});

test("signing in from another tab restores here too", () => {
  const page = mountProviders();
  page.settle();
  assert.equal(page.privy.mounted, 0);
  page.window.localStorage.setItem("privy:token", "\"t\"");
  page.window.dispatchEvent({ type: "storage", key: "privy:token" });
  page.settle();
  assert.equal(page.privy.mounted > 0, true);
});

test("signing out of a restored session keeps Privy mounted, so Sign in opens again", () => {
  const page = mountProviders({ local: { "privy:token": "\"t\"", "privy:refresh_token": "\"r\"" } });
  page.settle();
  page.publish({ ready: true, authenticated: true, configured: true, address: "wallet", open() {}, openDeposit() {} });
  page.settle();
  // Privy's logout removes its tokens in this tab, where no storage event fires.
  page.window.localStorage.removeItem("privy:token");
  page.window.localStorage.removeItem("privy:refresh_token");
  let opened = 0;
  page.publish({ ready: true, authenticated: false, configured: true, open() { opened += 1; }, openDeposit() {} });
  assert.equal(page.privyMounted(), true, "the session that published the logout stays mounted");
  assert.equal(page.auth().authenticated, false);
  page.auth().open();
  assert.equal(opened, 1);
  // Signing out in another tab: Privy stays to report it here.
  page.window.dispatchEvent({ type: "storage", key: "privy:token" });
  assert.equal(page.privyMounted(), true);
});

test("an Add money link loads Privy for a signed-out visitor and leaves the link to Privy", async () => {
  const page = mountProviders({ search: "?deposit=1" });
  await tick();
  assert.equal(page.privy.imports, 1, "the download starts before the first render");
  assert.deepEqual(page.privy.preconnects, ["https://auth.privy.io"]);
  page.settle();
  assert.equal(page.privy.mounted > 0, true);
  // Sign in stays usable while Privy loads.
  assert.equal(page.auth().ready, true);
  assert.equal(page.auth().authenticated, false);
  let deposits = 0;
  page.publish({ ready: true, authenticated: false, configured: true, open() {}, openDeposit() { deposits += 1; } });
  page.settle();
  // PrivySession opens Add money from the link itself; nothing is replayed on top.
  assert.equal(deposits, 0);
  assert.equal(page.privyMounted(), true);
});

test("an Add money link reached by client-side navigation also loads Privy", () => {
  const page = mountProviders({ pathname: "/" });
  page.settle();
  assert.equal(page.privy.mounted, 0);
  page.navigate("/app", "?deposit=1");
  page.settle();
  assert.equal(page.privy.mounted > 0, true);
});

test("the root layout ships only the text rendered outside the app", () => {
  const exports = {};
  vm.runInNewContext(transpile("../i18n/root-messages.ts"), { exports, require: (id) => (id === "./messages/en.json" ? { default: en, ...en } : require(id)) });
  const messages = exports.rootMessages;
  assert.equal(messages.common.chunkFailed, en.common.chunkFailed);
  assert.equal(messages.auth.reload, en.auth.reload);
  assert.deepEqual(messages.cookies, en.cookies);
  assert.ok(JSON.stringify(messages).length < 2_000, "root catalog stays small");
  assert.ok(JSON.stringify(en).length > 40_000);
  // Every key the root-level components use must be in that subset.
  for (const file of ["../components/chunk-load-recovery.tsx", "../components/consent/cookie-consent.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const [, key] of source.matchAll(/\bt\("([a-zA-Z.]+)"\)/g)) {
      const value = key.split(".").reduce((node, part) => node?.[part], messages);
      assert.equal(typeof value, "string", `${file} uses ${key}`);
    }
  }
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /messages=\{rootMessages\}/);
  assert.doesNotMatch(layout, /messages\/en\.json/);
});

test("the cookie notice is server-rendered hidden, shown by the head script, with equal choices", () => {
  const exports = {};
  const choices = [];
  let opened = 0;
  vm.runInNewContext(transpile("../components/consent/cookie-consent.tsx"), {
    exports, process: { env: {} },
    require(id) {
      if (id === "react") return { useEffect() {}, useRef: () => ({ current: null }) };
      if (id === "next/navigation") return { usePathname: () => "/" };
      if (id === "@/lib/consent") return { CONSENT_OPEN_EVENT: "oren-consent-open", setConsent: (choice) => choices.push(choice), openConsentSettings: () => { opened += 1; } };
      if (id === "@/i18n/locales") return { isPersonalizedPath: (path) => path.startsWith("/app") };
      if (id === "@/components/ui/utils") return { cn: (...parts) => parts.filter(Boolean).join(" ") };
      return require(id);
    },
  });
  const html = renderToStaticMarkup(createElement(exports.CookieConsent));
  assert.match(html, /<section aria-label="Cookie preferences"/);
  assert.match(html, /class="[^"]*\bfixed\b[^"]*\bhidden\b[^"]*\[html\[data-consent=pending\]_&amp;\]:flex/);
  assert.ok(html.includes(en.cookies.body.replace("’", "’")));
  const buttons = [...html.matchAll(/<button class="([^"]+)"[^>]*>([^<]+)<\/button>/g)];
  assert.deepEqual(buttons.map(([, , label]) => label), [en.cookies.reject, en.cookies.accept]);
  assert.equal(buttons[0][1], buttons[1][1], "reject and accept look the same");
  assert.doesNotMatch(html, /lg:start-1\/2/);
  // In the app the sidebar keeps Settings bottom-left, so the notice centers over the content.
  assert.match(renderToStaticMarkup(createElement(exports.CookieConsent, { placement: "app" })), /lg:start-1\/2 lg:-translate-x-1\/2/);
  const tree = exports.CookieConsent({});
  const found = [];
  (function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "button") found.push(node);
    [node.props?.children].flat(Infinity).forEach(walk);
  })(tree);
  found[0].props.onClick();
  found[1].props.onClick();
  assert.deepEqual(choices, ["denied", "granted"]);
  assert.equal(renderToStaticMarkup(createElement(exports.CookieConsentGate)).length > 0, true);
  const settings = exports.CookieSettingsButton({ children: "Cookie settings" });
  settings.props.onClick();
  assert.equal(opened, 1);
});

test("sidebar motion avoids the full motion bundle and shares one framer-motion copy", () => {
  // `motion/react-m` resolves framer-motion through `motion`; LazyMotion comes from the
  // direct dependency. Two versions would split LazyMotion's context from the `m` icons.
  const app = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const motionPackage = JSON.parse(readFileSync(require.resolve("motion/package.json"), "utf8"));
  assert.equal(app.dependencies["framer-motion"], motionPackage.dependencies["framer-motion"]);
  for (const file of ["../components/shell/navigation-link.tsx", "../components/shell/AnimatedIcons/index.tsx", "../components/shell/app-shell.tsx", "../components/shell/motion-features.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /^import \{[^}]*\} from "motion\/react";/m, `${file} must not load the motion/react barrel at runtime`);
  }
  const shell = readFileSync(new URL("../components/shell/app-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /<LazyMotion features=\{loadMotionFeatures\}>/);
  assert.match(shell, /import\("\.\/motion-features"\)/);
});

/** Runs LocaleSync's effects once in a fresh page with the given cookies and storage. */
function runLocaleSync({ force, pathname, locale = "en", cookie = "", local = {} }) {
  const refreshes = [];
  const effects = [];
  const env = browser({ cookie, local });
  const exports = {};
  vm.runInNewContext(transpile("../i18n/locale-sync.tsx"), {
    exports, document: env.document, localStorage: env.window.localStorage,
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: "Europe/Berlin" }) }) },
    window: { location: { protocol: "https:" }, addEventListener() {}, removeEventListener() {} },
    require(id) {
      if (id === "react") return { useEffect: (effect) => effects.push(effect) };
      if (id === "next-intl") return { useLocale: () => locale };
      if (id === "next/navigation") return { usePathname: () => pathname, useRouter: () => ({ refresh: () => refreshes.push(pathname) }) };
      if (id === "./locales") {
        const loaded = {};
        vm.runInNewContext(transpile("../i18n/locales.ts"), { exports: loaded });
        return loaded;
      }
      return require(id);
    },
  });
  exports.LocaleSync({ force });
  effects.forEach((effect) => effect());
  return { refreshes, written: env.written, storage: env.window.localStorage };
}

test("marketing pages save locale cookies without refreshing; the app still refreshes", () => {
  assert.deepEqual(runLocaleSync({ force: false, pathname: "/" }).refreshes, []);
  assert.deepEqual(runLocaleSync({ force: true, pathname: "/app" }).refreshes, ["/app"]);
});

test("a browser that never chose a language keeps its own, whatever else Oren saved", () => {
  // The reported case: a German browser's second visit, after the agent panel saved
  // its state. It used to be pinned to English here.
  const second = runLocaleSync({
    force: true, pathname: "/app", locale: "de", cookie: "NEXT_TIMEZONE=Europe%2FBerlin",
    local: { "oren-agent-panel-v1": "{}", "oren.growth.v1": "{}", "oren-theme": "dark", "oren.active-wallet.v1": "{}" },
  });
  assert.equal(second.written.some((value) => value.startsWith("NEXT_LOCALE=")), false);
  assert.equal(second.storage.has("oren-locale"), false);
  assert.deepEqual(second.refreshes, []);
});

test("a saved language choice still restores its missing cookie", () => {
  const restored = runLocaleSync({
    force: true, pathname: "/app", locale: "de", cookie: "NEXT_TIMEZONE=Europe%2FBerlin", local: { "oren-locale": "fr" },
  });
  assert.equal(restored.written.some((value) => value.startsWith("NEXT_LOCALE=fr;")), true);
  assert.deepEqual(restored.refreshes, ["/app"]);
});
