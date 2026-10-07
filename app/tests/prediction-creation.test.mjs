import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8"),
    out = {};
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  new Function("require", "exports", compiled)(
    (name) => mocks[name] ?? require(name),
    out,
  );
  return out;
}
const calls = [];
let confirmationStatus = "chain_pending";
const api = {
  apiRequest: async (path, options) => {
    calls.push({ path, options });
    if (path.endsWith("challenge"))
      return { nonce: "n", message: "Ownership only" };
    if (path.endsWith("session"))
      return {
        token: "t",
        wallet: "owner",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
    if (path.endsWith("/confirm"))
      return { status: confirmationStatus, ...options.body };
    return {};
  },
};
const service = load("../services/prediction-creation-service.ts", {
  "./api-client": api,
});
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k),
};
test("fee conversion preserves six decimals beyond Number precision", () => {
  assert.equal(
    service.decimalUnits("9007199254740993001"),
    "9007199254740.993001",
  );
  assert.equal(service.decimalUnits("1"), "0.000001");
  assert.equal(service.decimalUnits("5000", 9), "0.000005000");
  assert.throws(() => service.decimalUnits("1.1"));
});
test("wallet sessions are volatile, owned, and separate from model request bodies", async () => {
  service.clearCreationSession();
  assert.deepEqual(service.creationSessionHeaders("owner"), {});
  let message;
  await service.verifyCreationWallet("owner", async (bytes) => {
    message = new TextDecoder().decode(bytes);
    return new Uint8Array(64).fill(1);
  });
  assert.equal(message, "Ownership only");
  assert.deepEqual(service.creationSessionHeaders("owner"), {
    "x-oren-creation-session": "t",
  });
  assert.deepEqual(service.creationSessionHeaders("other"), {});
  assert.equal(storage.size, 0);
  service.clearCreationSession();
  assert.deepEqual(service.creationSessionHeaders("owner"), {});
});
test("signed submission recovery survives reload and stays wallet scoped", () => {
  const pending = {
    wallet: "owner",
    draftId: "draft",
    attemptId: "attempt",
    signature: "sig",
  };
  service.persistPendingCreation(pending);
  assert.deepEqual(service.pendingCreation("owner"), pending);
  assert.equal(service.pendingCreation("other"), null);
  service.clearPendingCreation("owner");
  assert.equal(service.pendingCreation("owner"), null);
  assert.equal(service.encodeBase58(new Uint8Array([0, 0, 1])), "112");
});
const draft = {
  id: "draft",
  wallet: "owner",
  version: 3,
  terms: { title: "GDP event" },
  evidence: {
    generatedAt: "2026-10-07T10:00:00Z",
    summary: "Official release cited",
  },
  publicationBlockers: ["Audited deployment unavailable"],
};
const opened = [];
const components = load("../components/predictions/creation-proposal.tsx", {
  "@solana/wallet-adapter-react": {
    useWallet: () => ({ publicKey: { toBase58: () => "owner" } }),
  },
  "@/components/ui": {
    Button: (props) => React.createElement("button", props),
  },
  "@/store": { useAgentStore: (select) => select({ prefillPrompt: () => {} }) },
  "@/store/prediction-creation-store": {
    usePredictionCreationStore: (select) =>
      select({ open: (value) => opened.push(value) }),
  },
  "@/services/prediction-creation-service": service,
  "./prediction-cards": {
    PoweredByPanta: () => React.createElement("p", null, "Powered by Panta"),
  },
});
test("restored creation proposals retain version, timestamp, blockers and attribution", () => {
  const html = renderToStaticMarkup(
    React.createElement(components.CreationProposalCard, { draft }),
  );
  for (const text of [
    "GDP event",
    "Proposal v3",
    "2026-10-07T10:00:00Z",
    "Audited deployment unavailable",
    "Powered by Panta",
    "Review creation proposal",
  ])
    assert.ok(html.includes(text));
  const card = components.CreationProposalCard({ draft });
  card.props.children.at(-1).props.onClick();
  assert.deepEqual(opened, [draft]);
});
test("creation stream artifacts preserve evidence and artwork approval identities", async () => {
  const { parseAgentSseChunk } = await import("../services/agent-sse.ts");
  const artifact = {
      type: "prediction_creation",
      data: {
        ...draft,
        artwork: { contentHash: "hash" },
        quote: { paymentUsdc: "25000000" },
      },
    },
    event = {
      type: "tool_completed",
      artifact,
      toolName: "proposePredictionMarket",
      sequence: 1,
      turnId: "t",
      timestamp: "now",
    };
  assert.deepEqual(
    parseAgentSseChunk("", `data: ${JSON.stringify(event)}\n\n`, true).events,
    [event],
  );
});
function transaction() {
  return {
    message: {
      header: { numRequiredSignatures: 1 },
      staticAccountKeys: [{ toBase58: () => "owner" }],
      serialize: () => new Uint8Array([1, 2, 3]),
    },
    signatures: [new Uint8Array(64).fill(1)],
    serialize: () => new Uint8Array([9]),
  };
}
const prepared = {
  attemptId: "attempt",
  genesisHash: "verified-genesis",
  lastValidBlockHeight: 100,
  expiresAt: new Date(Date.now() + 60000).toISOString(),
};
async function authorize() {
  service.clearPendingCreation("owner");
  service.clearCreationSession();
  calls.length = 0;
  confirmationStatus = "chain_pending";
  await service.verifyCreationWallet("owner", async () =>
    new Uint8Array(64).fill(1),
  );
}
test("wallet rejection and wrong networks never persist or broadcast a payment", async () => {
  await authorize();
  let broadcasts = 0,
    signs = 0;
  const adapter = {
    currentWallet: () => "owner",
    genesis: async () => "verified-genesis",
    height: async () => 1,
    sign: async () => {
      signs++;
      throw new Error("Wallet rejected");
    },
    broadcast: async () => {
      broadcasts++;
      return "sig";
    },
  };
  await assert.rejects(
    () =>
      service.submitCreationTransaction(
        "owner",
        "draft",
        prepared,
        transaction(),
        { ...adapter, genesis: async () => "wrong-network" },
      ),
    /network/,
  );
  assert.equal(signs, 0);
  await assert.rejects(
    () =>
      service.submitCreationTransaction(
        "owner",
        "draft",
        prepared,
        transaction(),
        adapter,
      ),
    /Wallet rejected/,
  );
  assert.equal(broadcasts, 0);
  assert.equal(service.pendingCreation("owner"), null);
});
test("submission persists locally and on the server before broadcast and never repeats an unknown payment", async () => {
  await authorize();
  let broadcasts = 0;
  const signed = transaction();
  const adapter = {
    currentWallet: () => "owner",
    genesis: async () => "verified-genesis",
    height: async () => 1,
    sign: async () => signed,
    broadcast: async () => {
      broadcasts++;
      assert.equal(service.pendingCreation("owner").attemptId, "attempt");
      assert.ok(calls.some((c) => c.path.endsWith("/confirm")));
      throw new Error("RPC connection lost");
    },
  };
  await assert.rejects(
    () =>
      service.submitCreationTransaction(
        "owner",
        "draft",
        prepared,
        transaction(),
        adapter,
      ),
    /outcome unknown/,
  );
  assert.ok(service.pendingCreation("owner").signature);
  await assert.rejects(
    () =>
      service.submitCreationTransaction(
        "owner",
        "draft",
        prepared,
        transaction(),
        adapter,
      ),
    /Recover the saved signature/,
  );
  assert.equal(broadcasts, 1);
  service.clearPendingCreation("owner");
});
test("changed wallets or messages reject submission, and registration recovery never broadcasts again", async () => {
  await authorize();
  let broadcasts = 0;
  const adapter = {
    currentWallet: () => "owner",
    genesis: async () => "verified-genesis",
    height: async () => 1,
    sign: async () => ({
      ...transaction(),
      message: {
        ...transaction().message,
        serialize: () => new Uint8Array([3, 2, 1]),
      },
    }),
    broadcast: async () => {
      broadcasts++;
      return "sig";
    },
  };
  await assert.rejects(
    () =>
      service.submitCreationTransaction(
        "owner",
        "draft",
        prepared,
        transaction(),
        adapter,
      ),
    /changed the approved/,
  );
  assert.equal(service.pendingCreation("owner"), null);
  confirmationStatus = "registration_pending";
  const result = await service.submitCreationTransaction(
    "owner",
    "draft",
    prepared,
    transaction(),
    { ...adapter, sign: async () => transaction() },
  );
  assert.equal(result.status, "registration_pending");
  assert.equal(broadcasts, 0);
  assert.ok(service.pendingCreation("owner"));
  service.clearPendingCreation("owner");
});
