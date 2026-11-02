import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function load(calls) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../services/agent-service.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    fetch: async (_url, options) => {
      calls.push(options);
      return { ok: true, body: { getReader: () => ({ read: async () => ({ done: true }) }) } };
    },
    TextDecoder,
    URL,
    require(id) {
      if (id === './api-client') return { apiRequest: async (_path, options) => { calls.push(options); return { messages: [] }; }, buildApiUrl: (path) => new URL(path, 'https://api.example.test'), ApiError: Error };
      if (id === './agent-sse') return { parseAgentSseChunk: () => ({ buffer: '', events: [] }) };
      if (id === './market-service') return { mapStockDetail: (x) => x, mapStockSummary: (x) => x };
      if (id === './portfolio-service') return { mapPortfolio: (x) => x };
      throw new Error(`unexpected import ${id}`);
    },
  });
  return exports;
}

test('agent streaming and history carry the verified bearer token', async () => {
  const calls = [];
  const agent = load(calls);
  agent.setAgentTokenProvider(async () => 'privy-token');
  await agent.streamAgentMessage({ walletAddress: 'owned', message: 'Research NVDA' }, () => {});
  await agent.getAgentThreadMessages('thread-id', 'owned');
  assert.equal(calls.length, 2);
  for (const call of calls) assert.equal(call.headers.Authorization, 'Bearer privy-token');
});
