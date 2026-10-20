import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'web/outbox.js'), 'utf8');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function boot(steerResult) {
  const writes = [];
  const timers = new Set();
  const route = { model: 'gpt-5.6-sol', provider: 'openai-codex' };
  const context = {
    console, URL, Blob, crypto: webcrypto, Date, Map, Set, Promise, AbortSignal, AbortController,
    document: {
      documentElement: { dataset: {} }, hidden: false,
      addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
      body: null,
    },
    addEventListener() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    indexedDB: { open() { throw new Error('fixture uses fallback storage'); } },
    setTimeout(fn, ms) { const timer = setTimeout(fn, ms); timer.unref?.(); timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); },
    WosModels: { snapshot: () => route, resolveRoute: async () => route },
    WizLive: { agentOf: () => '', pinAgent() {} },
    async fetch(url, init = {}) {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
      writes.push({ url, method: init.method || 'GET', body, key: init.headers?.['Idempotency-Key'] });
      if (url.endsWith('/steer')) {
        if (steerResult === 'network') throw new TypeError('connection reset');
        return response(steerResult, steerResult === 409
          ? { error: { message: 'Run is not currently accepting steer input: wizard_stale', code: 'run_not_accepting_steer' } }
          : { error: { message: 'Wizard sign-in needed', code: 'auth_required' } });
      }
      if (url.endsWith('/v1/runs')) return response(202, { run_id: 'wizard_fresh' });
      throw new Error(`unexpected request ${url}`);
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'outbox.js' });
  return { outbox: context.WosOutbox, writes, close: () => timers.forEach(clearTimeout) };
}

async function waitFor(outbox, id, states) {
  for (let i = 0; i < 200; i++) {
    const item = outbox.get(id);
    if (states.includes(item?.state)) return item;
    await sleep(5);
  }
  throw new Error(`item ${id} did not reach ${states.join('/')}`);
}

async function createStaleSteer(fixture) {
  const item = await fixture.outbox.enqueue({
    kind: 'reply', sessionId: 'wizard_thread', steerRunId: 'wizard_stale',
    text: 'ensure its the correct link', files: [{ id: 'wizard_file_1', name: 'proof.png' }],
    model: 'gpt-5.6-sol', provider: 'openai-codex',
  });
  await sleep(20);
  const current = fixture.outbox.get(item.id);
  if (!fixture.writes.some(write => write.url.endsWith('/steer'))) throw new Error(`steer was not attempted: ${current?.state} ${current?.error}`);
  return waitFor(fixture.outbox, item.id, ['failed', 'unconfirmed']);
}

test('Retry converts a definitely rejected stale steer into one fresh run with the original message and attachments', async t => {
  const f = boot(409); t.after(f.close);
  const failed = await createStaleSteer(f);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.steerRejectCode, 'run_not_accepting_steer');
  assert.equal(f.writes.filter(write => write.url.endsWith('/steer')).length, 1);
  assert.equal(f.writes.filter(write => write.url.endsWith('/v1/runs')).length, 0);

  // Existing deployed rows have only the exact backend message, not the newly persisted code.
  delete failed.steerRejectCode;
  assert.equal(f.outbox.retry(failed.id), true);
  const sent = await waitFor(f.outbox, failed.id, ['sent']);
  const steers = f.writes.filter(write => write.url.endsWith('/steer'));
  const runs = f.writes.filter(write => write.url.endsWith('/v1/runs'));
  assert.equal(steers.length, 1, 'Retry must not repeat the stale steer');
  assert.equal(runs.length, 1, 'Retry admits exactly one replacement run');
  assert.equal(runs[0].key, failed.id);
  assert.equal(runs[0].body.input, 'ensure its the correct link');
  assert.deepEqual(runs[0].body.wizard_file_ids, ['wizard_file_1']);
  assert.equal(runs[0].body.session_id, 'wizard_thread');
  assert.equal(sent.runId, 'wizard_fresh');
});

test('Retry does not turn auth rejection into a duplicate run', async t => {
  const f = boot(403); t.after(f.close);
  const failed = await createStaleSteer(f);
  assert.equal(failed.state, 'failed');
  assert.equal(f.outbox.retry(failed.id), true);
  await waitFor(f.outbox, failed.id, ['failed']);
  assert.equal(f.writes.filter(write => write.url.endsWith('/steer')).length, 2);
  assert.equal(f.writes.filter(write => write.url.endsWith('/v1/runs')).length, 0);
});

test('ambiguous network steer failure remains unconfirmed and cannot be retried into a duplicate', async t => {
  const f = boot('network'); t.after(f.close);
  const item = await createStaleSteer(f);
  assert.equal(item.state, 'unconfirmed');
  assert.equal(f.outbox.retry(item.id), false);
  assert.equal(f.writes.filter(write => write.url.endsWith('/steer')).length, 1);
  assert.equal(f.writes.filter(write => write.url.endsWith('/v1/runs')).length, 0);
});
