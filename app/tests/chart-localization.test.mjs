import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('chart translations preserve Unicode and contain no encoding replacement marks', () => {
  const anchors = { de: ['open', 'Eröffnung'], fr: ['close', 'Clôture'], vi: ['time', 'Thời gian'], uk: ['open', 'Відкриття'], 'pt-BR': ['price', 'Preço'], 'zh-CN': ['open', '开盘'], 'zh-TW': ['open', '開盤'] };
  for (const locale of ['en', 'de', 'fr', 'id', 'vi', 'uk', 'pt-BR', 'zh-CN', 'zh-TW']) {
    const { chart } = JSON.parse(readFileSync(new URL(`../i18n/messages/${locale}.json`, import.meta.url), 'utf8'));
    for (const [key, value] of Object.entries(chart)) {
      assert.ok(!/[?\uFFFD]/u.test(value), `${locale}.chart.${key} contains a damaged character`);
    }
    if (anchors[locale]) {
      const [key, expected] = anchors[locale];
      assert.equal(chart[key], expected, `${locale}.chart.${key} must retain its native spelling`);
    }
  }
});
