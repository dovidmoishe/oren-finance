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

function loadProviders(endpoint) {
  const captured = {};
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports,
    process: { env: { NEXT_PUBLIC_PRIVY_APP_ID: 'offline-app', NEXT_PUBLIC_SOLANA_RPC_URL: endpoint } },
    require(id) {
      if (id === '@privy-io/react-auth') return { PrivyProvider({ config, children }) {
        captured.config = config;
        // The signing screen resolves this client synchronously during render.
        if (!config.solana?.rpcs?.['solana:mainnet']) throw new Error('No RPC configuration found for chain solana:mainnet');
        return children;
      } };
      if (id === '@privy-io/react-auth/solana') return { toSolanaWalletConnectors: () => ({}) };
      if (id === '@solana/kit') return {
        createSolanaRpc: (url) => ({ url, kind: 'rpc' }),
        createSolanaRpcSubscriptions: (url) => ({ url, kind: 'subscriptions' }),
      };
      if (id === '@solana/wallet-adapter-react') return { ConnectionProvider({ endpoint, children }) {
        captured.endpoint = endpoint;
        return children;
      } };
      if (id === '@solana/wallet-adapter-react-ui') return {};
      if (id === '@/components/auth/privy-session') return { PrivySession: ({ children }) => children };
      return require(id);
    },
  });
  const markup = renderToStaticMarkup(createElement(exports.AppProviders, null, 'review remains available'));
  assert.match(markup, /review remains available/);
  return captured;
}

for (const [name, env, expectedHttp, expectedWs] of [
  ['default mainnet', undefined, 'https://api.mainnet-beta.solana.com/', 'wss://api.mainnet-beta.solana.com/'],
  ['configured mainnet', ' https://rpc.example.invalid/mainnet?key=offline ', 'https://rpc.example.invalid/mainnet?key=offline', 'wss://rpc.example.invalid/mainnet?key=offline'],
  ['local endpoint', 'http://127.0.0.1:8899', 'http://127.0.0.1:8899', 'ws://127.0.0.1:8899'],
]) {
  test(`Privy signing review receives the wallet adapter's ${name} RPC configuration`, () => {
    const { config, endpoint } = loadProviders(env);
    const mainnet = config.solana.rpcs['solana:mainnet'];
    assert.equal(endpoint, expectedHttp);
    assert.equal(mainnet.rpc.url, endpoint);
    assert.equal(mainnet.rpcSubscriptions.url, expectedWs);
    assert.equal(config.embeddedWallets.showWalletUIs, true);
    assert.deepEqual(Array.from(config.loginMethods), ['email']);
    assert.equal(config.externalWallets, undefined);
  });
}
