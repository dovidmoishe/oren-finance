import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../../lib/seo.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

/** lib/seo.ts with the given build environment. It has no runtime imports. */
export function loadSeo(env = {}) {
  const exports = {};
  vm.runInNewContext(compiled, { exports, URL, process: { env } });
  return exports;
}

/** Values from the vm realm have their own prototypes; compare them as plain data. */
export const plain = (value) => JSON.parse(JSON.stringify(value));
