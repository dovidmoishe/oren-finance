import test from 'node:test';
import assert from 'node:assert/strict';
import { isDocsOnlyChange } from './change-scope.mjs';

const files = (...names) => names.map((filename) => ({ filename }));
test('docs sources and their release integration do not need application previews', () => {
  assert.equal(isDocsOnlyChange(files('docs-site/app/layout.tsx', 'infra/docs/deploy.sh', 'Caddyfile', '.github/workflows/preview.yml')), true);
  assert.equal(isDocsOnlyChange(files('.github/workflows/deploy-docs.yml')), true);
  assert.equal(isDocsOnlyChange(files('docs-site/README.md', '.gitignore')), true);
});
test('mixed changes, isolated shared routing and empty changes retain normal preview handling', () => {
  assert.equal(isDocsOnlyChange(files('docs-site/README.md', 'app/app/page.tsx')), false);
  assert.equal(isDocsOnlyChange(files('docs-site/README.md', 'api/src/main.ts')), false);
  assert.equal(isDocsOnlyChange(files('Caddyfile')), false);
  assert.equal(isDocsOnlyChange([]), false);
});
test('moving an application file into docs does not hide its original scope', () => {
  assert.equal(isDocsOnlyChange([{ filename: 'docs-site/component.tsx', previous_filename: 'app/components/trade.tsx' }]), false);
});
