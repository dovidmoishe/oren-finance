// Component tests compile one file at a time with a stubbed React, so they
// can't load the real translation store. This serves `@/i18n/i18n` and
// `@/i18n/t` with the English messages, rendered synchronously.
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../../i18n/messages/en.ts', import.meta.url), 'utf8');
const compiled = { exports: {} };
new Function('module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(compiled, compiled.exports);
const en = compiled.exports.default;
const rules = new Intl.PluralRules('en');

function t(key, values) {
  let value = en;
  for (const part of key.split('.')) value = value?.[part];
  if (value && typeof value === 'object') value = value[rules.select(Number(values?.count ?? 0))] ?? value.other;
  if (typeof value !== 'string') return key;
  return values ? value.replace(/\{(\w+)\}/g, (match, name) => (name in values ? String(values[name]) : match)) : value;
}

export const englishI18n = { useI18n: () => ({ locale: 'en', t }), useT: () => t, setLocale: async () => {} };
export const englishT = { T: ({ k, values }) => t(k, values) };

const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === "@/i18n/i18n") return englishI18n;
  if (request === "@/i18n/t") return englishT;
  return load.call(this, request, ...rest);
};
