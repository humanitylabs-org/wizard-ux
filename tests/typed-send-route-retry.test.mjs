import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Synthetic browser custody, not inference. The real affected thread's content-free metadata
// is model=gpt-6.1-sol, provider=null; the chip can resolve that while a saved row cannot.
const read = f => readFileSync(new URL('../web/' + f, import.meta.url), 'utf8');
function fixture() {
  const rows = new Map(), calls = [], timers = new Set();
  const session = { id: 'synthetic-model-only', model: 'gpt-6.1-sol', provider: '' };
  let rejecting = false;
  const indexedDB = { open() {
    const r = {};
    queueMicrotask(() => {
      r.result = { close() {}, objectStoreNames: { contains: () => true }, transaction() {
        const tx = { objectStore: () => ({
          getAll: () => ({ result: [...rows.values()].map(value => structuredClone(value)) }),
          put: value => { rows.set(value.id, structuredClone(value)); return {}; },
          delete: id => { rows.delete(id); return {}; }
        }) }; setImmediate(() => tx.oncomplete?.()); return tx;
      } }; r.onsuccess();
    }); return r;
  } };
  const c = { console, Blob, AbortController, AbortSignal, indexedDB, crypto: { randomUUID },
    document: { documentElement: { dataset: {} }, body: null, addEventListener() {} },
    localStorage: { getItem: () => null, removeItem() {}, setItem() {} },
    addEventListener() {}, clearTimeout,
    setTimeout(fn, ms) { const t = setTimeout(fn, ms); t.unref(); timers.add(t); return t; },
    WizLive: { session: id => id === session.id ? session : null, agentOf: () => '' },
    async fetch(url, init = {}) {
      calls.push({ url, method: init.method || 'GET', body: init.body, key: init.headers?.['Idempotency-Key'] });
      if (!url.endsWith('/v1/runs')) throw Error('Unexpected network: ' + url);
      return { ok: !rejecting, status: rejecting ? 400 : 202, json: async () => rejecting ? { error: 'Synthetic pre-admission rejection' } : { run_id: 'synthetic-run', status: 'queued' } };
    }
  }; c.window = c; vm.createContext(c);
  vm.runInContext(read('core/chat-models.js'), c);
  const m = c.WosModels; m.ready = true; m.at = Date.now();
  m.options = [
    { value: 'gpt-6.1-sol', provider: 'openai-codex', isGlobalDefault: true },
    { value: 'unique-model', provider: 'unique-provider' },
    { value: 'ambiguous-model', provider: 'provider-a' },
    { value: 'ambiguous-model', provider: 'provider-b' },
    { value: 'other-model', provider: 'other-provider' },
  ];
  vm.runInContext(read('outbox.js'), c);
  return { c, session, rows, calls, reject: v => { rejecting = v; }, close: () => timers.forEach(clearTimeout) };
}
const pause = () => new Promise(r => setTimeout(r, 10));
async function settled(f, id) {
  for (let i = 0; i < 100; i++) { const it = f.c.WosOutbox.get(id); if (['sent', 'failed'].includes(it?.state)) return it; await pause(); }
  throw Error('Synthetic send did not settle');
}
async function failedRow(f, extra = {}) {
  await f.c.WosOutbox.load();
  const it = { id: 'wos-' + randomUUID(), kind: 'reply', sessionId: f.session.id, text: 'Synthetic typed reply',
    state: 'failed', error: 'No confirmed model route · choose a model before retrying',
    model: f.session.model, provider: '', createdAt: Date.now(), attempts: 1, durable: true, ...extra };
  f.c.WosOutbox._items.set(it.id, it); return it;
}

test('typed model-only reply already captures the chip route in the shared enqueue owner', async t => {
  const f = fixture(); t.after(f.close);
  const chip = f.c.WosModels.snapshot(f.session.id);
  const it = await f.c.WosOutbox.enqueue({ kind: 'reply', sessionId: f.session.id, text: 'Synthetic fresh typed reply' });
  assert.equal((await settled(f, it.id)).state, 'sent');
  const wire = JSON.parse(f.calls.at(-1).body);
  assert.equal(wire.model, chip.model); assert.equal(wire.provider, chip.provider);
  assert.equal(wire.require_model_lock, true); assert.equal(wire.session_id, f.session.id);
});

test('Retry repairs an unfrozen saved model-only typed reply using the chip owner, preserving identity/text', async t => {
  const f = fixture(); t.after(f.close); const it = await failedRow(f);
  const before = { id: it.id, text: it.text, sessionId: it.sessionId };
  assert.equal(f.c.WosModels.snapshot(it.sessionId).provider, 'openai-codex');
  assert.equal(f.c.WosOutbox.retry(it.id), true);
  assert.equal((await settled(f, it.id)).state, 'sent');
  const wire = JSON.parse(f.calls.at(-1).body);
  assert.equal(wire.model, 'gpt-6.1-sol'); assert.equal(wire.provider, 'openai-codex');
  assert.equal(wire.input, before.text); assert.equal(wire.session_id, before.sessionId);
  assert.equal(f.calls.at(-1).key, before.id); assert.equal(f.calls.length, 1);
});

test('Retry resolves only the saved model, never the newer chip or global default', async t => {
  const f = fixture(); t.after(f.close); const it = await failedRow(f, { model: 'unique-model' });
  f.c.WosModels.selections.set(it.sessionId, { model: 'other-model', provider: 'other-provider', version: 27 });
  assert.equal(f.c.WosOutbox.retry(it.id), true); assert.equal((await settled(f, it.id)).state, 'sent');
  const wire = JSON.parse(f.calls.at(-1).body);
  assert.equal(wire.model, 'unique-model'); assert.equal(wire.provider, 'unique-provider');
});

for (const extra of [
  { model: '' }, { model: 'ambiguous-model' }, { model: 'unlisted-model' },
  { body: JSON.stringify({ session_id: 'synthetic-model-only', input: 'Frozen original' }) },
  { steerBody: '{"input":"Frozen steer original"}' }, { agent: 'private-fixture' },
]) test('unverifiable/frozen/routed saved message stays unsent: ' + JSON.stringify(extra), async t => {
  const f = fixture(); t.after(f.close); const it = await failedRow(f, extra);
  const original = { model: it.model, provider: it.provider, body: it.body, steerBody: it.steerBody };
  f.c.WosOutbox.retry(it.id); await settled(f, it.id);
  assert.equal(it.state, 'failed'); assert.equal(f.calls.length, 0);
  assert.deepEqual({ model: it.model, provider: it.provider, body: it.body, steerBody: it.steerBody }, original);
});

test('pending picker acknowledgement cannot supply the missing provider', async t => {
  const f = fixture(); t.after(f.close); const it = await failedRow(f);
  f.c.WosModels.pending.set(it.sessionId, Promise.resolve());
  f.c.WosOutbox.retry(it.id); await settled(f, it.id);
  assert.equal(it.state, 'failed'); assert.equal(it.provider, ''); assert.equal(f.calls.length, 0);
});

test('once frozen, rejection/retry retains exact route, body bytes and idempotency key', async t => {
  const f = fixture(); t.after(f.close); f.reject(true); const it = await failedRow(f);
  f.c.WosOutbox.retry(it.id); await settled(f, it.id);
  assert.equal(it.state, 'failed'); assert.equal(f.calls.length, 1); const first = f.calls[0];
  f.session.model = 'other-model'; f.session.provider = 'other-provider'; f.reject(false);
  f.c.WosOutbox.retry(it.id); assert.equal((await settled(f, it.id)).state, 'sent');
  assert.equal(f.calls[1].body, first.body); assert.equal(f.calls[1].key, first.key);
});
