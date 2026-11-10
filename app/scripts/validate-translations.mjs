// Checks every language file against English: same keys (TypeScript also
// enforces this), the same {placeholders}, and plural forms with `other`.
import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";

const dir = new URL("../i18n/messages/", import.meta.url);

function loadModule(file) {
  const source = readFileSync(new URL(file, dir), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const loaded = { exports: {} };
  const require = (id) => {
    if (id === "./en") return loadModule("en.ts");
    throw new Error(`Unexpected import ${id} in ${file}`);
  };
  new Function("module", "exports", "require", output)(loaded, loaded.exports, require);
  return loaded.exports;
}

const load = (file) => loadModule(file).default;

function leaves(value, prefix = "") {
  if (typeof value === "string") return [[prefix, value]];
  if (value && typeof value === "object" && "other" in value) {
    return Object.entries(value).map(([form, text]) => [`${prefix}#${form}`, text]);
  }
  return Object.entries(value).flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key));
}

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(",");
const base = (key) => key.split("#")[0];

const en = load("en.ts");
const englishLeaves = leaves(en);
const englishByKey = new Map(englishLeaves.map(([key, text]) => [base(key), placeholders(text)]));
const englishPluralKeys = new Set(englishLeaves.filter(([key]) => key.includes("#")).map(([key]) => base(key)));
let problems = 0;

for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts") && name !== "en.ts")) {
  const messages = load(file);
  const seen = new Set();
  for (const [key, text] of leaves(messages)) {
    const name = base(key);
    seen.add(name);
    if (!englishByKey.has(name)) {
      console.error(`${file}: unknown key ${name}`);
      problems++;
      continue;
    }
    if (!text.trim()) {
      console.error(`${file}: empty text for ${key}`);
      problems++;
    }
    const expected = englishByKey.get(name);
    const actual = placeholders(text);
    // Plural forms may drop {count} where the language says "one" in words.
    const pluralOk = englishPluralKeys.has(name) && actual === expected.split(",").filter((p) => p !== "count").join(",");
    if (actual !== expected && !pluralOk) {
      console.error(`${file}: ${key} has {${actual}} but English has {${expected}}`);
      problems++;
    }
  }
  for (const name of englishByKey.keys()) {
    if (!seen.has(name)) {
      console.error(`${file}: missing ${name}`);
      problems++;
    }
  }
}

if (problems) {
  console.error(`${problems} translation problem(s).`);
  process.exit(1);
}
console.log("Translations match English keys and placeholders.");
