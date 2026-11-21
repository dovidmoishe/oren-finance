import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import ts from "typescript";

const nodeRequire = createRequire(new URL("../package.json", import.meta.url));

function transpile(path) {
  return ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function loadStore(getAgentThreadMessages, streamAgentMessage = async () => {}) {
  const storage = new Map();
  const walletSession = {};
  vm.runInNewContext(transpile("../services/wallet-session.ts"), {
    exports: walletSession,
  });
  const exports = {};
  vm.runInNewContext(transpile("../store/agent-store.ts"), {
    exports,
    crypto: webcrypto,
    AbortController,
    window: {
      localStorage: {
        getItem: (key) => (storage.has(key) ? storage.get(key) : null),
        setItem: (key, value) => storage.set(key, value),
      },
      matchMedia: () => ({ matches: false }),
    },
    require(id) {
      if (id === "zustand") return nodeRequire("zustand");
      if (id === "@/services/wallet-session") return walletSession;
      if (id === "@/services") {
        return {
          ApiError,
          getAgentThreadMessages,
          streamAgentMessage,
        };
      }
      throw new Error(`unexpected import ${id}`);
    },
  });
  return { useAgentStore: exports.useAgentStore, storage };
}

function seedRecent(storage, wallet, threadId) {
  storage.set(
    "oren-agent-recents-v1",
    JSON.stringify({
      [wallet]: [
        { id: threadId, title: "NVDA", updatedAt: "2026-11-08T00:00:00.000Z" },
      ],
    }),
  );
}

test('Ask Oren before panel initialization does not restore the previous chat over the new prompt', async () => {
  let reads = 0;
  const requests = [];
  const { useAgentStore: store, storage } = loadStore(async () => { reads++; return { messages: [] }; }, async request => { requests.push(request); });
  seedRecent(storage, 'wallet', 'previous');
  store.getState().newChat('wallet');
  await store.getState().sendMessage('Explain this article', 'wallet', { page: 'explore' });
  await store.getState().initialize('wallet');
  assert.equal(reads, 0);
  assert.equal(requests[0].threadId, undefined);
  assert.equal(store.getState().messages[0].content, 'Explain this article');
  assert.equal(store.getState().recentThreads[0].id, 'previous');
});

test('a fresh news conversation omits the previous thread and ignores its late history', async () => {
  let restore;
  const requests = [];
  const { useAgentStore: store } = loadStore(() => new Promise(resolve => { restore = resolve; }), async request => { requests.push(request); });
  await store.getState().initialize('wallet');
  store.setState({ threadId: 'old-thread', messages: [{ id: 'old', role: 'user', content: 'Previous conversation' }] });
  const history = store.getState().loadThread('old-thread');
  store.getState().newChat();
  await store.getState().sendMessage('Explain this article', 'wallet', { page: 'explore' });
  assert.equal(requests[0].threadId, undefined);
  assert.equal(store.getState().isLoadingHistory, false);
  restore({ messages: [{ id: 'old', role: 'user', content: 'Stale history' }] });
  await history;
  assert.equal(store.getState().threadId, undefined);
  assert.equal(store.getState().messages[0].content, 'Explain this article');
  assert.equal(store.getState().messages.some(message => message.id === 'old'), false);
});

test('a history error after New chat cannot clear the new conversation or its error state', async () => {
  let reject;
  const { useAgentStore: store } = loadStore(() => new Promise((_resolve, no) => { reject = no; }));
  await store.getState().initialize('wallet');
  const history = store.getState().loadThread('old-thread');
  store.getState().newChat();
  store.setState({ messages: [{ id: 'new', role: 'user', content: 'New conversation' }], error: 'Current error' });
  reject(new ApiError('threadId not found', 404));
  await history;
  assert.equal(store.getState().messages[0].id, 'new');
  assert.equal(store.getState().error, 'Current error');
  assert.equal(store.getState().isLoadingHistory, false);
});

test('rapid history selections keep the newest thread when older results arrive last', async () => {
  const pending = new Map();
  const { useAgentStore: store } = loadStore(id => new Promise(resolve => { pending.set(id, resolve); }));
  await store.getState().initialize('wallet');
  const old = store.getState().loadThread('old');
  const latest = store.getState().loadThread('latest');
  pending.get('latest')({ messages: [{ id: 'latest', role: 'user', content: 'Latest' }] });
  await latest;
  pending.get('old')({ messages: [{ id: 'old', role: 'user', content: 'Old' }] });
  await old;
  assert.equal(store.getState().threadId, 'latest');
  assert.equal(store.getState().messages[0].id, 'latest');
});

test("a 401 while restoring history keeps the saved thread shortcut", async () => {
  const wallet = "wallet-1";
  const threadId = "thread-1";
  const { useAgentStore, storage } = loadStore(async () => {
    throw new ApiError("Authentication required", 401);
  });
  seedRecent(storage, wallet, threadId);

  await useAgentStore.getState().initialize(wallet);

  const saved = JSON.parse(storage.get("oren-agent-recents-v1"));
  assert.deepEqual(
    saved[wallet].map((item) => item.id),
    [threadId],
  );
  assert.deepEqual(
    Array.from(useAgentStore.getState().recentThreads, (item) => item.id),
    [threadId],
  );
  assert.ok(useAgentStore.getState().error);
});

test("a transport failure while restoring history keeps the saved thread shortcut", async () => {
  const wallet = "wallet-1";
  const threadId = "thread-1";
  const { useAgentStore, storage } = loadStore(async () => {
    throw new Error("network down");
  });
  seedRecent(storage, wallet, threadId);

  await useAgentStore.getState().initialize(wallet);

  const saved = JSON.parse(storage.get("oren-agent-recents-v1"));
  assert.deepEqual(
    saved[wallet].map((item) => item.id),
    [threadId],
  );
});

test("a missing thread still drops the saved shortcut", async () => {
  const wallet = "wallet-1";
  const threadId = "thread-gone";
  const { useAgentStore, storage } = loadStore(async () => {
    throw new ApiError("threadId not found", 400);
  });
  seedRecent(storage, wallet, threadId);

  await useAgentStore.getState().initialize(wallet);

  const saved = JSON.parse(storage.get("oren-agent-recents-v1"));
  assert.deepEqual(saved[wallet], []);
});
