import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../web/outbox.js', import.meta.url), 'utf8');
const chats = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
function client(rows = new Map(), broken = false) {
  const calls = [], timers = new Set();
  const indexedDB = { open() {
    const r = {};
    queueMicrotask(() => {
      r.result = { close() {}, objectStoreNames: { contains: () => true }, transaction() {
        if (broken) throw new Error('storage unavailable');
        const tx = { objectStore() { return {
          getAll() { return { result: [...rows.values()].map(x => structuredClone(x)) }; },
          put(value) { rows.set(value.id, structuredClone(value)); return {}; }, delete(id) { rows.delete(id); return {}; }
        }; } }; setImmediate(() => tx.oncomplete?.()); return tx;
      } }; r.onsuccess();
    }); return r;
  } };
  const c = { console, Blob, AbortController, AbortSignal, indexedDB,
    document: { documentElement: { dataset: {} }, body: null, addEventListener() {} },
    localStorage: { getItem: () => null, removeItem() {}, setItem() { if (broken) throw new Error('quota'); } },
    addEventListener() {}, clearTimeout,
    setTimeout(fn, ms) { const t = setTimeout(fn, ms); t.unref(); timers.add(t); return t; },
    fetch: async (...args) => { calls.push(args); throw new Error('network forbidden'); },
    WosModels: { snapshot: (_, route) => route, resolveRoute: async route => route },
  }; c.window = c; vm.runInNewContext(source, c);
  return { api: c.WosOutbox, calls, close() { for (const t of timers) clearTimeout(t); } };
}
const item = (id, extra = {}) => ({ id, kind: 'reply', state: 'failed', sessionId: 'test-thread', text: 'Switch', error: 'No confirmed model route', createdAt: Date.now(), ...extra });
const tick = () => new Promise(r => setTimeout(r, 25));
for (const kind of ['main', 'host-profile', 'container', 'restricted']) {
  test(`${kind}: Dismiss persists only the selected failure; no admission/stop and original retained`, async t => {
    const rows = new Map(), p = client(rows); t.after(p.close); await tick();
    const failed = item('failed', { agent: kind === 'main' ? '' : 'test-' + kind, audio: new Blob(['original']) });
    const accepted = item('accepted', { state: 'sent', runId: 'active-run' });
    const other = item('other');
    for (const it of [failed, accepted, other]) p.api._items.set(it.id, it);
    assert.equal(await p.api.dismissFailed('failed'), true);
    assert.equal(p.api.forThread('test-thread').some(x => x.id === 'failed'), false);
    assert.equal(p.api.canRetry('failed'), false);
    assert.equal(p.api.retry('failed'), false);
    assert.equal(accepted.runId, 'active-run'); assert.equal(accepted.state, 'sent');
    assert.equal(other.state, 'failed'); assert.equal(p.api.canRetry(other), true);
    assert.equal(p.api.unsent().find(x => x.id === 'failed').audio.size, 8);
    assert.equal(rows.get('failed').threadHidden, true);
    p.close(); const reloaded = client(rows); t.after(reloaded.close); await tick();
    assert.equal(reloaded.api.get('failed').state, 'held');
    assert.equal(reloaded.api.forThread('test-thread').length, 0);
    assert.equal(reloaded.api.retryAll(), 0);
    assert.equal(p.calls.length + reloaded.calls.length, 0);
  });
}
test('stale button cannot dismiss accepted, queued, unconfirmed or active work', async t => {
  const p = client(); t.after(p.close); await tick();
  for (const state of ['sent', 'queued', 'sending', 'waiting', 'unconfirmed', 'processing']) {
    const it = item(state, { state }); p.api._items.set(it.id, it);
    assert.equal(await p.api.dismissFailed(it.id), false); assert.equal(it.state, state);
  }
  const steer = item('steer', { steerDispatch: 'started' }); p.api._items.set(steer.id, steer);
  assert.equal(await p.api.dismissFailed('steer'), false);
  assert.equal(await p.api.dismissFailed('missing'), false); assert.equal(p.calls.length, 0);
});
test('failed persistence keeps the bubble and permits retry, never claiming dismissal', async t => {
  const p = client(new Map(), true); t.after(p.close); await tick();
  const it = item('failed'); p.api._items.set(it.id, it);
  assert.equal(await p.api.dismissFailed(it.id), false);
  assert.equal(it.state, 'failed'); assert.equal(it.cancelled, undefined); assert.equal(it.threadHidden, undefined);
  assert.equal(p.api.forThread('test-thread').length, 1); assert.equal(p.api.canRetry(it), true);
});
test('thread bubble and single-message pill expose Dismiss; click uses item API, never run Stop', () => {
  const bubble = chats.split('\n').find(x => x.includes("if (p.state === 'failed')"));
  assert.match(bubble, /data-obdismissfailed/); assert.match(bubble, /data-obretry/); assert.match(bubble, /data-obedit/);
  assert.match(chats, /if \(one\?\.state === 'failed'\) btns \+= .*data-obdismissfailed/);
  const handler = chats.slice(chats.indexOf('    const failedDismiss ='), chats.indexOf('    // Errors-section voice rows'));
  assert.match(handler, /OUTBOX\.dismissFailed\(failedDismiss\.dataset\.obdismissfailed\)/);
  assert.doesNotMatch(handler, /LIVE\.stop|cancelSend|OUTBOX\.retry/);
});
