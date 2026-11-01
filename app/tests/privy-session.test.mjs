import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { resolveEmbeddedSolanaAccount, resolveSolanaWallet } from '../services/wallet-selection.ts';

const require = createRequire(import.meta.url);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
// Execute the real session component with a minimal hook scheduler and controllable SDK.
function session(createWallet) {
  const slots = [], effects = [];
  let cursor = 0, loginComplete, modal, walletContext;
  const signerCalls = [];
  const sdk = { ready: true, authenticated: true, user: { id: 'alice', linkedAccounts: [] }, logout: async () => {}, linkWallet() {}, getAccessToken: async () => 'token' };
  const walletSdk = { ready: true, wallets: [] };
  const effect = (fn, deps) => {
    const i = cursor++;
    if (!slots[i] || deps.some((dep, j) => !Object.is(dep, slots[i].deps[j]))) {
      effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
    }
  };
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (next) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(fn) { return fn; }, useEffect: effect, useLayoutEffect: effect,
  };
  let resets = 0;
  const state = { reset() {}, resetAll() { resets++; }, clearCopy() {}, initialize() {}, setWalletState() {} };
  const store = { getState: () => state };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../components/auth/privy-session.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    exports, URL, window: { location: { href: 'https://oren.finance/app' }, localStorage: { getItem: () => null } },
    require(id) {
      if (id === 'react') return react;
      if (id === '@privy-io/react-auth') return {
        useAuthorizationSignature: () => ({ generateAuthorizationSignature: async () => ({ signature: 'request-signature' }) }),
        usePrivy: () => sdk,
        useLogin: ({ onComplete }) => { loginComplete = onComplete; return { login() {} }; },
        useSigners: () => ({
          async addSigners(input) { signerCalls.push({ method: 'add', ...input }); },
          async removeSigners(input) { signerCalls.push({ method: 'remove', ...input }); },
        }),
      };
      if (id === '@privy-io/react-auth/solana') return { useWallets: () => walletSdk, useCreateWallet: () => ({ createWallet }), useSignMessage: () => ({}), useSignTransaction: () => ({}) };
      if (id === 'next/navigation') return { usePathname: () => '/app' };
      if (id === '@/store') return Object.fromEntries(['useAgentStore','useExecutionStore','usePortfolioStore','useSocialStore','useVaultStore','useWalletStore'].map(k => [k, store]));
      if (id === '@/services/wallet-session') return { invalidateWalletSession() {}, walletSessionIsCurrent: () => () => true };
      if (id === '@/services/approval-service') return { getApprovalAuthorizationRequest: async () => ({}) };
      if (id === '@/services/privy-signer') return { createPrivySigner: () => ({}) };
      if (id === '@/services/wallet-selection') return { resolveEmbeddedSolanaAccount, resolveSolanaWallet };
      if (id === './auth-context') return { AuthContext: { Provider: 'auth' } };
      if (id === './email-login') return { EmailLogin: 'email-login' };
      if (id === '@solana/wallet-adapter-react') return { WalletContext: { Provider: 'wallet' } };
      if (id === './wallet-modal-context') return { WalletModalContext: { Provider: 'wallet-modal' } };
      return require(id);
    },
  });
  function render() {
    cursor = 0;
    const tree = exports.PrivySession({ children: null });
    walletContext = tree.props.children.props.value;
    modal = tree.props.children.props.children.props.value;
    while (effects.length) effects.shift()();
    return tree.props.value;
  }
  return { sdk, walletSdk, render, wallet: () => walletContext, signerCalls, resetCount: () => resets, requestConnection: () => modal.setVisible(true), isLoginOpen: () => modal.visible, completeLogin: data => loginComplete(data) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('proof signer consent and removal require the active authenticated wallet', async () => {
  const app = session(async () => {});
  const address = '11111111111111111111111111111111';
  app.sdk.user.linkedAccounts = [{ type: 'wallet', chainType: 'solana', walletClientType: 'privy', address }];
  const auth = app.render();
  await assert.rejects(auth.addWalletSigners('other-wallet', [{ signerId: 'signer', policyIds: ['policy'] }]), /exact wallet/);
  await assert.rejects(auth.removeWalletSigners('other-wallet'), /exact wallet/);
  assert.deepEqual(app.signerCalls, []);
  await auth.addWalletSigners(address, [{ signerId: 'signer', policyIds: ['policy'] }]);
  await auth.removeWalletSigners(address);
  assert.deepEqual(app.signerCalls, [
    { method: 'add', address, signers: [{ signerId: 'signer', policyIds: ['policy'] }] },
    { method: 'remove', address },
  ]);
});

test('an already loaded owned wallet stays available while SDK discovery refreshes', async () => {
  const app = session(async () => { throw new Error('must not recreate an existing wallet'); });
  const address = '11111111111111111111111111111111';
  app.sdk.user.linkedAccounts = [{ type: 'wallet', chainType: 'solana', walletClientType: 'privy', address }];
  app.walletSdk.wallets = [{ address, standardWallet: { name: 'Privy' } }];
  assert.equal(app.render().address, address);
  const loadedResets = app.resetCount();
  app.walletSdk.ready = false;
  const auth = app.render();
  assert.equal(auth.address, address);
  assert.equal(auth.ready, true);
  assert.equal(app.wallet().connected, true);
  assert.equal(app.wallet().connecting, false);
  assert.equal(app.wallet().signTransaction, undefined);
  await assert.rejects(app.wallet().sendTransaction(), /Review and confirm/);
  assert.equal(app.resetCount(), loadedResets);
  app.sdk.user = { id: 'bob', linkedAccounts: [] };
  assert.equal(app.render().address, undefined);
  assert.equal(app.wallet().connected, false);
});

test('a trade connect request during Privy wallet restoration never links another wallet', () => {
  let links = 0, creations = 0;
  const app = session(async () => { creations++; });
  app.sdk.linkWallet = () => { links++; };
  app.sdk.user.linkedAccounts = [{ type: 'wallet', chainType: 'solana', walletClientType: 'privy', address: '11111111111111111111111111111111' }];
  app.walletSdk.ready = false;
  app.render(); app.requestConnection();
  const auth = app.render();
  assert.equal(links, 0);
  assert.equal(creations, 0);
  assert.equal(auth.depositOpen, false);
  assert.equal(app.isLoginOpen(), false);
  app.walletSdk.ready = true;
  app.walletSdk.wallets = [{ address: '11111111111111111111111111111111', standardWallet: { name: 'Privy' } }];
  const restored = app.render();
  assert.equal(restored.address, '11111111111111111111111111111111');
  app.requestConnection();
  assert.equal(links, 0);
  assert.equal(creations, 0);
});

test('a signed-out trade connect request opens sign-in without linking a wallet', () => {
  let links = 0;
  const app = session(async () => {});
  app.sdk.linkWallet = () => { links++; };
  app.sdk.user = null; app.sdk.authenticated = false;
  app.render(); app.requestConnection();
  assert.equal(app.render().authenticated, false);
  assert.equal(app.isLoginOpen(), true);
  assert.equal(links, 0);
});

test('email sign-in automatically creates one wallet despite rerenders and simultaneous retry', async () => {
  const pending = deferred(); let calls = 0;
  const app = session(() => { calls++; return pending.promise; });
  app.render();
  assert.equal(calls, 1);
  const auth = app.render();
  assert.equal(auth.authenticated, true);
  assert.equal(auth.walletPreparing, true);
  await auth.createWallet();
  app.render();
  assert.equal(calls, 1);
  pending.resolve({}); await settle();
  app.render(); app.render();
  assert.equal(calls, 1);
});

test('failed automatic setup stops retrying until an explicit recovery request', async () => {
  let calls = 0;
  const app = session(async () => { calls++; throw new Error('network'); });
  app.render(); await settle();
  const auth = app.render();
  assert.match(auth.error, /retry/i);
  app.render(); await settle(); assert.equal(calls, 1);
  await auth.createWallet(); assert.equal(calls, 2);
});

test('existing embedded wallets and unrestored sessions do not create another wallet', () => {
  let calls = 0;
  const app = session(async () => { calls++; });
  app.sdk.user.linkedAccounts = [{ type: 'wallet', chainType: 'solana', walletClientType: 'privy', address: '11111111111111111111111111111111' }];
  app.render(); assert.equal(calls, 0);
  app.sdk.user = { id: 'bob', linkedAccounts: [] }; app.walletSdk.ready = false; app.sdk.ready = false;
  app.render(); assert.equal(calls, 0);
  app.sdk.ready = true; app.render(); assert.equal(calls, 1);
});

test('server trading restores the authenticated embedded address without browser wallet discovery', () => {
  let creations = 0;
  const app = session(async () => { creations++; });
  const address = '11111111111111111111111111111111';
  app.sdk.user.linkedAccounts = [{ type: 'wallet', chainType: 'solana', walletClientType: 'privy', address }];
  app.walletSdk.ready = false;
  const restored = app.render();
  assert.equal(restored.ready, true);
  assert.equal(restored.address, address);
  assert.equal(restored.walletPreparing, false);
  assert.equal(app.wallet().publicKey.toBase58(), address);
  assert.equal(app.wallet().connected, true);
  const resetCount = app.resetCount();
  app.walletSdk.ready = true;
  app.walletSdk.wallets = [{ address, standardWallet: { name: 'Privy' } }];
  assert.equal(app.render().address, address);
  assert.equal(app.resetCount(), resetCount);
  assert.equal(creations, 0);
  app.sdk.user = { id: 'bob', linkedAccounts: [] }; app.sdk.ready = false;
  assert.equal(app.render().address, undefined);
  assert.equal(app.wallet().connected, false);
});

test('signed-out sessions are ready without browser discovery and ignore stale wallet objects', () => {
  const app = session(async () => { throw new Error('must not create while signed out'); });
  app.sdk.authenticated = false; app.sdk.user = null; app.walletSdk.ready = false;
  app.walletSdk.wallets = [{ address: '11111111111111111111111111111111', standardWallet: { name: 'Privy' } }];
  const auth = app.render();
  assert.equal(auth.ready, true);
  assert.equal(auth.address, undefined);
  assert.equal(auth.authenticated, false);
});

test('an external wallet cannot block automatic embedded setup or become the server trade account', () => {
  let creations = 0;
  const app = session(async () => { creations++; });
  app.sdk.user.linkedAccounts = [{ type: 'wallet', chainType: 'solana', walletClientType: 'phantom', address: '11111111111111111111111111111111' }];
  app.walletSdk.ready = false;
  assert.equal(app.render().address, undefined);
  assert.equal(creations, 1);
});

test('late setup failure from a previous user cannot overwrite the next account', async () => {
  const old = deferred(), next = deferred(); let calls = 0;
  const app = session(() => ++calls === 1 ? old.promise : next.promise);
  app.render();
  app.sdk.user = { id: 'bob', linkedAccounts: [] }; app.render();
  assert.equal(calls, 2);
  old.reject(new Error('old failure')); await settle();
  const auth = app.render(); assert.equal(auth.error, undefined); assert.equal(auth.busy, true);
  next.resolve({}); await settle(); assert.equal(app.render().busy, false);
});

test('new signup opens deposit in place and closing it preserves the app route', () => {
  const app = session(async () => {});
  app.render(); app.completeLogin({ isNewUser: true, wasAlreadyAuthenticated: false });
  assert.equal(app.render().depositOpen, true);
  app.render().closeDeposit(); assert.equal(app.render().depositOpen, false);
  app.render().openDeposit(); assert.equal(app.render().depositOpen, true);
});

test('signed-out sessions render safely and cannot create wallets', () => {
  let calls = 0;
  const app = session(async () => { calls++; });
  app.sdk.user = null; app.sdk.authenticated = false;
  const auth = app.render();
  assert.equal(auth.authenticated, false);
  assert.equal(auth.error, undefined);
  assert.equal(calls, 0);
});

test('sign-out remains available while wallet setup is pending', async () => {
  const pending = deferred();
  const app = session(() => pending.promise);
  let loggedOut = false;
  app.sdk.logout = async () => { loggedOut = true; };
  app.render(); await app.render().signOut();
  assert.equal(loggedOut, true);
  app.sdk.authenticated = false; app.sdk.user = null; app.render();
  pending.reject(new Error('late failure')); await settle();
  assert.equal(app.render().error, undefined);
});
