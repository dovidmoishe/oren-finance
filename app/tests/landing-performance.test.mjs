import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
test("walkthrough loops through its scenes and pauses offscreen without a full-tree interval", () => {
  const slots = [], effects = [], timers = new Map();
  let cursor = 0, timerId = 0, observer;
  const hooks = {
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; slots[i] ??= value; return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((v, j) => !Object.is(v, slots[i].deps[j]))) effects.push(() => {
      slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() };
    }); },
  };
  const media = { matches: false, addEventListener() {}, removeEventListener() {} };
  const window = { matchMedia: () => media, setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; }, clearTimeout(id) { timers.delete(id); } };
  const timing = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../components/landing/walkthrough-timing.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: timing });
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("../components/landing/product-walkthrough.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, window, document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    IntersectionObserver: class { constructor(fn) { observer = fn; } observe() {} disconnect() {} },
    require(id) {
      if (id === './walkthrough-timing') return timing;
      if (id === '@/services/market-service') return { getLandingSnapshot: () => new Promise(() => {}) };
      if (id === '@/components/ui/utils') return { formatCurrency: String, formatPercent: String, formatRelativeTime: String };
      if (id === "react") return hooks;
      if (id === "react/jsx-runtime") return require(id);
      if (id === "./stock-logos") return { stockLogos: {} };
      if (id === "@/components/brand/oren-logo") return { OrenLogo: () => null };
      if (id === "next/image") return { default: () => null };
      if (id === "lucide-react") return new Proxy({}, { get: () => () => null });
      throw new Error(id);
    },
  });
  const render = () => { cursor = 0; const tree = exports.ProductWalkthrough(); while (effects.length) effects.shift()(); return tree; };
  render();
  observer([{ isIntersecting: true }]);
  let tree = render();
  assert.equal(tree.props["data-step"], 0);
  assert.equal(timers.size, 1);
  const first = [...timers.values()][0];
  assert.ok(first.delay < 1000, 'the first action should start within a second');
  first.fn();
  tree = render();
  assert.equal(tree.props["data-step"], 0);
  assert.ok([...timers.values()][0].delay < 200, 'cursor should follow the highlight promptly');
  const scenes = [0];
  for (let i = 0; i < 30; i++) {
    [...timers.values()][0].fn();
    tree = render();
    const step = tree.props['data-step'];
    if (scenes.at(-1) !== step) scenes.push(step);
    if (scenes.length === 5) break;
  }
  assert.deepEqual(scenes, [0, 1, 2, 3, 0], 'review must lead into another uninterrupted loop');
  assert.equal(tree.props['data-playing'], true);
  observer([{ isIntersecting: false }]);
  tree = render();
  assert.equal(tree.props["data-playing"], false);
  assert.equal(timers.size, 0);
});
