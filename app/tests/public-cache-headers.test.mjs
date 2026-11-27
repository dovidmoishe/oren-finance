import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { getPathMatch } = require("next/dist/shared/lib/router/utils/path-match");
const exports = {};
const code = ts.transpileModule(readFileSync(new URL("../next.config.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(code, {
  exports, URL, process: { env: { NODE_ENV: "production" } },
  require: (id) => id === "next-intl/plugin" ? { default: () => (config) => config } : require(id),
});
const rules = await exports.default.headers();
function header(path, name) {
  return rules.filter((rule) => getPathMatch(rule.source)(path))
    .flatMap((rule) => rule.headers).filter((entry) => entry.key === name).at(-1)?.value;
}

test("versioned public videos and posters have a year-long immutable policy", () => {
  for (const path of ["/videos/oren-morning-brief-v8-poster.png", "/videos/oren-morning-brief-v8.mp4", "/videos/nested/film-v2.mp4"]) {
    assert.equal(header(path, "Cache-Control"), "public, max-age=31536000, immutable");
    assert.ok(header(path, "Content-Security-Policy"));
  }
});

test("unhashed root images, landing assets and changelog screenshots revalidate after an hour", () => {
  const root = readdirSync(new URL("../public/", import.meta.url)).filter((file) => /\.(svg|png|webp)$/.test(file));
  const screenshots = readdirSync(new URL("../public/changelog/", import.meta.url)).filter((file) => file.endsWith(".webp"));
  for (const path of [...root.map((file) => `/${file}`), ...screenshots.map((file) => `/changelog/${file}`), "/landing/trading-steps/pick-stocks-v2.webp"]) {
    assert.equal(header(path, "Cache-Control"), "public, max-age=3600, must-revalidate", path);
    assert.ok(header(path, "Content-Security-Policy"));
  }
});

test("Next's path matcher leaves HTML, API rewrites and hashed static files untouched", () => {
  for (const path of ["/", "/changelog", "/changelog/stock-charts-upgrade", "/changelog/transfer-stablecoins-and-stocks", "/app/markets", "/api/stocks/charts", "/api/stocks/nvidia/analysis", "/_next/static/chunks/app-123.js"]) {
    assert.equal(header(path, "Cache-Control"), undefined, path);
    assert.ok(header(path, "Content-Security-Policy"));
  }
});
