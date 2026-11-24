import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { compile } from "tailwindcss";
import ts from "typescript";
import { THEME_CHANGE_EVENT, THEME_STORAGE_KEY, themeBootScript } from "../components/theme/theme-script.ts";

test("theme selection persists explicit choices and resumes system changes without storage", () => {
  const documentElement = { dataset: {} };
  const window = new EventTarget();
  const media = Object.assign(new EventTarget(), { matches: true });
  let saved = null;
  let blocked = false;
  const localStorage = {
    getItem: () => saved,
    setItem(key, value) { assert.equal(key, THEME_STORAGE_KEY); if (blocked) throw new Error("blocked"); saved = value; },
    removeItem(key) { assert.equal(key, THEME_STORAGE_KEY); saved = null; },
  };
  const environment = { document: { documentElement }, window, matchMedia: () => media, localStorage, Event };
  runInNewContext(themeBootScript, environment);
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("../components/theme/theme.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { ...environment, exports, require: (id) => id === "react" ? {} : { THEME_STORAGE_KEY, THEME_CHANGE_EVENT, DARK_QUERY: "(prefers-color-scheme: dark)" } });
  exports.setThemePreference("light");
  assert.equal(saved, "light");
  assert.equal(documentElement.dataset.theme, "light");
  media.dispatchEvent(new Event("change"));
  assert.equal(documentElement.dataset.theme, "light");
  exports.setThemePreference("system");
  assert.equal(saved, null);
  assert.equal(documentElement.dataset.theme, "dark");
  media.matches = false;
  media.dispatchEvent(new Event("change"));
  assert.equal(documentElement.dataset.theme, "light");
  blocked = true;
  exports.setThemePreference("dark");
  assert.equal(documentElement.dataset.theme, "dark");
});

test("the boot script applies saved and system themes and syncs other tabs", () => {
  const documentElement = { dataset: {} };
  const window = new EventTarget();
  const media = Object.assign(new EventTarget(), { matches: true });
  let storedPreference = "light";
  let updates = 0;
  window.addEventListener(THEME_CHANGE_EVENT, () => updates++);
  runInNewContext(themeBootScript, {
    document: { documentElement },
    window,
    matchMedia: () => media,
    localStorage: { getItem: () => storedPreference },
    Event,
  });

  assert.deepEqual(documentElement.dataset, { themePreference: "light", theme: "light" });
  media.dispatchEvent(new Event("change"));
  assert.equal(updates, 1);

  storedPreference = null;
  window.dispatchEvent(Object.assign(new Event("storage"), { key: THEME_STORAGE_KEY }));
  assert.deepEqual(documentElement.dataset, { themePreference: "system", theme: "dark" });
  media.matches = false;
  media.dispatchEvent(new Event("change"));
  assert.equal(documentElement.dataset.theme, "light");

  storedPreference = "dark";
  window.dispatchEvent(Object.assign(new Event("storage"), { key: "unrelated" }));
  assert.equal(documentElement.dataset.theme, "light");
  window.dispatchEvent(Object.assign(new Event("storage"), { key: THEME_STORAGE_KEY }));
  assert.deepEqual(documentElement.dataset, { themePreference: "dark", theme: "dark" });
  storedPreference = null;
  window.dispatchEvent(Object.assign(new Event("storage"), { key: null }));
  assert.deepEqual(documentElement.dataset, { themePreference: "system", theme: "light" });
});

test("the boot script follows the OS when browser storage is unavailable", () => {
  const documentElement = { dataset: {} };
  runInNewContext(themeBootScript, {
    document: { documentElement },
    window: new EventTarget(),
    matchMedia: () => Object.assign(new EventTarget(), { matches: true }),
    localStorage: { getItem() { throw new Error("Storage unavailable"); } },
    Event,
  });
  assert.deepEqual(documentElement.dataset, { themePreference: "system", theme: "dark" });
});

test("Tailwind compiles product-scoped semantic colors and opacity modifiers", async () => {
  const require = createRequire(import.meta.url);
  const entry = fileURLToPath(new URL("../app/globals.css", import.meta.url));
  const stylesheet = await compile(readFileSync(entry, "utf8"), {
    base: dirname(entry),
    async loadStylesheet(id, base) {
      const path = id === "tailwindcss" ? require.resolve("tailwindcss/index.css") : resolve(base, id);
      return { path, base: dirname(path), content: readFileSync(path, "utf8") };
    },
  });
  const css = stylesheet.build(["bg-primary", "text-primary-foreground", "bg-warning-surface/80", "text-error"]);
  assert.match(css, /:root\[data-theme="dark"\]:has\(\[data-oren-product\]\)\s*\{[^}]*color-scheme:\s*dark/);
  assert.match(css, /\.bg-primary\s*\{[^}]*background-color:\s*var\(--primary\)/);
  assert.match(css, /\.text-primary-foreground\s*\{[^}]*color:\s*var\(--primary-foreground\)/);
  assert.match(css, /color-mix\(in oklab, var\(--warning-surface\) 80%, transparent\)/);
  assert.match(css, /\.text-error\s*\{[^}]*color:\s*var\(--error\)/);
});
