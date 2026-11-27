import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** Compiles the store with fake services and a manual notice clock. */
function fixture(service) {
  const exports = {};
  const timers = [];
  const code = ts.transpileModule(readFileSync(new URL('../store/release-reminder-store.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const stubs = {
    '@/services/api-client': { ApiError },
    '@/services/reminder-service': service,
  };
  vm.runInNewContext(code, {
    exports,
    require: (id) => stubs[id] ?? require(id),
    setTimeout: (run) => timers.push(run),
    clearTimeout: () => undefined,
  });
  const store = exports.useReleaseReminderStore;
  return { store, state: () => JSON.parse(JSON.stringify(store.getState())), timers };
}

const token = async () => 'session-token';
const listed = (reminders = [], extra = {}) => ({ enabled: true, emailVerified: true, reminders, ...extra });

test('every bell on the page shares one list request per account', async () => {
  const calls = [];
  const { store, state } = fixture({
    listReleaseReminders: async (getAccessToken) => {
      calls.push(await getAccessToken());
      return listed([{ id: 'r1', eventId: 'cpi', remindAt: '2026-12-10T13:15:00.000Z' }]);
    },
  });
  await Promise.all([1, 2, 3].map(() => store.getState().load('owner', token)));
  await store.getState().load('owner', token);
  assert.deepEqual(calls, ['session-token']);
  assert.equal(state().loaded, true);
  assert.equal(state().reminders.cpi.id, 'r1');

  await store.getState().load('someone-else', token);
  assert.equal(calls.length, 2);
  assert.equal(state().owner, 'someone-else');
});

test('a bell turns a reminder on and off, and flips back with a notice when the request fails', async () => {
  const created = [], deleted = [];
  let failNext;
  const { store, state, timers } = fixture({
    listReleaseReminders: async () => listed(),
    createReleaseReminder: async (_token, eventId) => {
      created.push(eventId);
      if (failNext) throw failNext;
      return { id: `reminder-${eventId}`, eventId, remindAt: '2026-12-10T13:15:00.000Z' };
    },
    deleteReleaseReminder: async (_token, id) => {
      deleted.push(id);
      return { canceled: true };
    },
  });
  await store.getState().load('owner', token);

  const pending = store.getState().toggle('owner', 'cpi', token);
  assert.equal(state().busy.cpi, true);
  assert.ok(state().reminders.cpi, 'optimistically on');
  await store.getState().toggle('owner', 'cpi', token);
  await pending;
  assert.deepEqual(created, ['cpi']);
  assert.equal(state().reminders.cpi.id, 'reminder-cpi');
  assert.equal(state().busy.cpi, undefined);

  await store.getState().toggle('owner', 'cpi', token);
  assert.deepEqual(deleted, ['reminder-cpi']);
  assert.equal(state().reminders.cpi, undefined);

  failNext = new ApiError('You can have up to 50 release reminders', 409);
  await store.getState().toggle('owner', 'gdp', token);
  assert.equal(state().reminders.gdp, undefined);
  assert.equal(state().notices.gdp, 'limit');
  failNext = new Error('offline');
  await store.getState().toggle('owner', 'ppi', token);
  assert.equal(state().notices.ppi, 'failed');

  timers.forEach((run) => run());
  assert.deepEqual(state().notices, {});
});

test('an unverified email explains itself without calling the API', async () => {
  let created = 0;
  const { store, state } = fixture({
    listReleaseReminders: async () => listed([], { emailVerified: false }),
    createReleaseReminder: async () => {
      created += 1;
    },
  });
  await store.getState().load('owner', token);
  await store.getState().toggle('owner', 'cpi', token);
  assert.equal(created, 0);
  assert.equal(state().notices.cpi, 'verifyEmail');
  assert.equal(state().reminders.cpi, undefined);
});

test('a failed list stays quiet instead of retrying for every row', async () => {
  let calls = 0;
  const { store, state } = fixture({
    listReleaseReminders: async () => {
      calls += 1;
      throw new Error('offline');
    },
  });
  await store.getState().load('owner', token);
  await store.getState().load('owner', token);
  assert.equal(calls, 1);
  assert.equal(state().loaded, false);
});
