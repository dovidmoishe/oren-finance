import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/providers.tsx', import.meta.url), 'utf8');
for (const rpcOverride of [undefined, 'https://rpc.example.invalid/private-key-must-not-be-used']) {
  test(`authentication stays email-only and does not initialize browser RPC (${rpcOverride ? 'override' : 'default'})`, () => {
    const exports = {};
    let config;
    vm.runInNewContext(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, {
      exports, process: { env: { NEXT_PUBLIC_PRIVY_APP_ID: 'offline-app', NEXT_PUBLIC_SOLANA_RPC_URL: rpcOverride } },
      require(id) {
        if (id === '@privy-io/react-auth') return { PrivyProvider(props) { config = props.config; return props.children; } };
        if (id === '@solana/kit') throw new Error('Browser RPC must not be initialized');
        if (id === '@solana/wallet-adapter-react') return { ConnectionProvider() { throw new Error('Browser RPC must not be initialized'); } };
        if (id === '@solana/wallet-adapter-react-ui') return {};
        if (id === '@/components/auth/privy-session') return { PrivySession: ({ children }) => children };
        return require(id);
      },
    });
    assert.match(renderToStaticMarkup(createElement(exports.AppProviders, null, 'ready')), /ready/);
    assert.deepEqual(Array.from(config.loginMethods), ['email']);
    assert.equal(config.externalWallets, undefined);
    assert.equal(config.solana, undefined);
  });
}