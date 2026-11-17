import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadApi(origin) {
  const exports={};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../services/api-client.ts',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,{exports,URL,process:{env:{NEXT_PUBLIC_OREN_API_URL:origin}},window:{location:{origin:'https://pr-42.preview.example.com'}}});
  return exports;
}
test('preview API URLs stay on the preview origin and preserve API prefix and query',()=>{
  const api=loadApi('/api');
  assert.equal(api.buildApiUrl('/stocks/search',{query:'A & B',page:2}).href,'https://pr-42.preview.example.com/api/stocks/search?query=A+%26+B&page=2');
});
test('production absolute API origins remain unchanged',()=>{
  assert.equal(loadApi('https://api.oren.finance/api').buildApiUrl('/stocks').href,'https://api.oren.finance/api/stocks');
});

function loadConfig(env) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, process: { env }, require(id) {
    assert.equal(id, 'next-intl/plugin');
    return { default: () => config => config };
  } });
  return exports.default;
}

test('local development can proxy API requests through the same origin', async () => {
  const config = loadConfig({ NODE_ENV: 'development', OREN_DEV_API_PROXY_URL: 'https://api.example.test/api/' });
  const rules = await config.rewrites();
  assert.equal(rules.length, 1);
  assert.equal(rules[0].source, '/api/:path*');
  assert.equal(rules[0].destination, 'https://api.example.test/api/:path*');
});

test('API proxy requires an explicit development setting and is disabled in production', async () => {
  for (const env of [{ NODE_ENV: 'development' }, { NODE_ENV: 'production', OREN_DEV_API_PROXY_URL: 'https://api.example.test/api' }]) {
    assert.equal((await loadConfig(env).rewrites()).length, 0);
  }
});
test('independent app and API Docker contexts agree on the public capability contract',()=>{
  assert.equal(readFileSync(new URL('../types/environment.ts',import.meta.url),'utf8'),readFileSync(new URL('../../api/types/environment.ts',import.meta.url),'utf8'));
});
