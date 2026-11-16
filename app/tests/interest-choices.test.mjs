import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
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
function choices(props) {
  let expanded;
  const { SectorChoices } = compile('../components/settings/preference-fields.tsx', {
    '@/services/preferences-service': preferences,
    react: {
      useId: () => 'interest-test',
      useState(initial) {
        expanded ??= initial();
        return [expanded, next => { expanded = typeof next === 'function' ? next(expanded) : next; }];
      },
    },
  });
  return () => SectorChoices(props);
}

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
  const tree = choices({ value: ['artificialIntelligence'], availableInterests: preferences.interestIds, onChange: value => { next = value; } })();
  const options = buttons(tree).filter(button => 'aria-pressed' in button.props);
  const html = renderToStaticMarkup(tree);
  assert.equal(options.length, 19);
  assert.ok(html.indexOf('Information Technology') < html.indexOf('Artificial intelligence'));
  assert.equal(options[0].props['aria-pressed'], false);
  options[0].props.onClick();
  assert.deepEqual([...next], ['artificialIntelligence', 'informationTechnology']);
  options[1].props.onClick();
  assert.deepEqual([...next], []);
});

test('older APIs keep standard sectors usable and disable unsupported themes', () => {
  const tree = choices({ value: [], onChange: () => {} })();
  const options = buttons(tree).filter(button => 'aria-pressed' in button.props);
  assert.equal(options.filter(choice => choice.props.disabled).length, 8);
  assert.equal(options.filter(choice => !choice.props.disabled).length, 11);
  assert.ok(renderToStaticMarkup(tree).includes('Theme preferences are coming soon'));
  const enabled = renderToStaticMarkup(choices({ value: [], availableInterests: preferences.interestIds, onChange: () => {} })());
  assert.ok(!enabled.includes('Theme preferences are coming soon'));
});

test('theme disclosure is separate from selection and hides closed controls from keyboard navigation', () => {
  const changes = [];
  const render = choices({ value: [], availableInterests: preferences.interestIds, onChange: value => changes.push(value) });
  const disclosure = tree => buttons(tree).find(button => button.props['aria-controls'] === 'interest-test-informationTechnology');
  const initial = render();
  assert.equal(disclosure(initial).props['aria-expanded'], false);
  assert.match(renderToStaticMarkup(initial), /id="interest-test-informationTechnology"[^>]*aria-hidden="true"[^>]*inert=""/);
  disclosure(initial).props.onClick();
  const opened = render();
  assert.equal(disclosure(opened).props['aria-expanded'], true);
  assert.match(renderToStaticMarkup(opened), /id="interest-test-informationTechnology"[^>]*aria-hidden="false"/);
  assert.equal(changes.length, 0);
  disclosure(opened).props.onClick();
  assert.equal(disclosure(render()).props['aria-expanded'], false);
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
