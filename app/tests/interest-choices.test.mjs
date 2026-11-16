import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
function compile(file, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, Intl, require: id => id in mocks ? mocks[id] : require(id) });
  return exports;
}

const preferences = compile('../services/preferences-service.ts', { './api-client': {} });
const taxonomy = compile('../../api/types/sectors.ts');
const { SectorChoices } = compile('../components/settings/preference-fields.tsx', {
  '@/services/preferences-service': preferences,
});

function buttons(element) {
  if (!element || typeof element !== 'object') return [];
  if (Array.isArray(element)) return element.flatMap(buttons);
  return [...(element.type === 'button' ? [element] : []), ...buttons(element.props?.children)];
}

test('web and api expose the same sector and theme identifiers', () => {
  assert.deepEqual([...preferences.sectorIds].sort(), [...taxonomy.sectorIds].sort());
  assert.deepEqual([...preferences.themeIds].sort(), [...taxonomy.themeIds].sort());
  assert.equal(preferences.sectorIds.length, 11);
  assert.equal(new Set(Object.values(preferences.sectorThemes).flat()).size, 8);
});

test('technology groups related themes while preserving independent selections', () => {
  let next;
  const tree = SectorChoices({ value: ['artificialIntelligence'], availableInterests: preferences.interestIds, onChange: value => { next = value; } });
  const choices = buttons(tree);
  const html = renderToStaticMarkup(tree);
  assert.equal(choices.length, 19);
  assert.ok(html.indexOf('Information Technology') < html.indexOf('Artificial intelligence'));
  assert.ok(html.includes('Related themes'));
  assert.equal(choices[0].props['aria-pressed'], false);
  choices[0].props.onClick();
  assert.deepEqual([...next], ['artificialIntelligence', 'informationTechnology']);
  choices[1].props.onClick();
  assert.deepEqual([...next], []);
});

test('older APIs keep standard sectors usable and disable unsupported themes', () => {
  const tree = SectorChoices({ value: [], onChange: () => {} });
  const choices = buttons(tree);
  assert.equal(choices.filter(choice => choice.props.disabled).length, 8);
  assert.equal(choices.filter(choice => !choice.props.disabled).length, 11);
  assert.ok(renderToStaticMarkup(tree).includes('Theme preferences are coming soon'));
  const enabled = renderToStaticMarkup(createElement(SectorChoices, { value: [], availableInterests: preferences.interestIds, onChange: () => {} }));
  assert.ok(!enabled.includes('Theme preferences are coming soon'));
});

test('recommendations display the matched theme and accept existing sector responses', async () => {
  const { getMarketForYou } = compile('../services/market-service.ts', {
    './api-client': { apiRequest: async () => ({ state: 'ready', items: [
      { id: 'alphabet', ticker: 'GOOGL', name: 'Alphabet', sectorId: 'communicationServices', interestId: 'artificialIntelligence' },
      { id: 'apple', ticker: 'AAPL', name: 'Apple', sectorId: 'informationTechnology' },
    ] }) },
  });
  const result = await getMarketForYou(async () => 'token', new AbortController().signal);
  assert.equal(preferences.interestLabelKey(result.items[0].interestId), 'preferences.themes.artificialIntelligence');
  assert.equal(preferences.interestLabelKey(result.items[1].sectorId), 'preferences.sectors.informationTechnology');
  assert.equal(result.items[0].sectorId, 'communicationServices');
});
