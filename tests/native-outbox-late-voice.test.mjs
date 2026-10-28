import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(process.env.OUTBOX_TEST_SOURCE || new URL('../web/outbox.js', import.meta.url), 'utf8');
const chats = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../web/core/settings.js', import.meta.url), 'utf8');
const native = readFileSync(new URL('../android/app/src/main/java/ai/wizards/os/everywhere/EverywhereOutbox.java', import.meta.url), 'utf8');
const recorded = Date.parse('2026-10-22T08:33:00Z');

// Bridge contract fixture, not an Android execution claim. The JVM tests exercise native transitions.
async function page(t, extra = {}) {
  const rows = new Map(), disk = new Map(), calls = [], timers = new Set();
  const item = { id: 'wos-ev-original', sessionId: 'wizard_original', createdAt: recorded,
    state: 'held', text: 'words recorded days ago', hasAudio: true, lateHeld: true, lateSendApproved: false, ...extra };
  rows.set(item.id, item);
  const N = {
    unsent: () => JSON.stringify([...rows.values()]),
    retryUnsent(id) {
      const it = rows.get(id); calls.push(['send', id]);
      if (!it || it.state !== 'held' || it.lateSendApproved) return false;
      it.state = 'sending'; it.lateSendApproved = true; return true;
    },
    deleteUnsent(id) { calls.push(['discard', id]); return rows.delete(id); },
  };
  const indexedDB = { open() {
    const r = {}; queueMicrotask(() => {
      r.result = { close() {}, objectStoreNames: { contains: () => true }, transaction() {
        const tx = { objectStore: () => ({ getAll: () => ({ result: [...disk.values()] }),
          put(it) { disk.set(it.id, structuredClone(it)); }, delete(id) { disk.delete(id); } }) };
        setImmediate(() => tx.oncomplete?.()); return tx;
      } }; r.onsuccess();
    }); return r;
  } };
  const ctx = { console, Blob, AbortController, AbortSignal, indexedDB, WizardOSNative: N,
    document: { documentElement: { dataset: {} }, body: null, addEventListener() {} },
    localStorage: { getItem: () => null, removeItem() {}, setItem() { throw Error('native row persisted in web storage'); } },
    addEventListener() {}, clearTimeout, setTimeout(fn, ms) { const timer = setTimeout(fn, ms); timer.unref(); timers.add(timer); return timer; },
    fetch() { assert.fail('native item must never enter web transport'); },
  };
  ctx.window = ctx; vm.runInNewContext(source, ctx); await ctx.WosOutbox.load();
  t.after(() => { for (const timer of timers) clearTimeout(timer); });
  return { api: ctx.WosOutbox, ctx, N, rows, item, disk, calls };
}

function pendingHtml(ctx, item) {
  const code = chats.slice(chats.indexOf('  function pendingState(p, s) {'), chats.indexOf('  function pendingHtml('));
  return vm.runInNewContext(code + '\npendingState(item)', { OUTBOX: ctx.api, item, esc: s => s, H: {}, window: {}, reach: () => ({}) });
}

test('native late hold reuses the thread and list Send/Discard UI without creating a web queue', async t => {
  const f = await page(t), it = f.api.unsent()[0];
  assert.equal(it.id, 'native-outbox:wos-ev-original'); assert.equal(f.api.get(it.id).nativeOutboxId, f.item.id);
  assert.equal(f.api.forThread('wizard_original').length, 1); assert.equal(f.api.forThread('other-thread').length, 0);
  const select = chats.match(/const outNew = (.+);\n/)[1];
  assert.equal(vm.runInNewContext(select, { OUTBOX: f.api, AGID: '' }).length, 1);
  assert.equal(vm.runInNewContext(select, { OUTBOX: f.api, AGID: 'another-agent' }).length, 0);
  const html = pendingHtml(f, it);
  assert.match(html, /Recorded 22 Oct/); assert.match(html, />Send<\/button>/); assert.match(html, />Discard<\/button>/);
  await f.api.pump(); assert.equal(f.disk.size, 0); assert.equal(f.api._items.size, 0); assert.equal(f.calls.length, 0);
});

test('native owner Send delegates once with original id; bulk Retry and web pump cannot send it', async t => {
  const f = await page(t), id = f.api.unsent()[0].id;
  assert.equal(f.api.retryAll(), 0); assert.equal(f.api.canRetry(id), true);
  assert.equal(f.api.retry(id), true); assert.equal(f.api.retry(id), false);
  assert.deepEqual(f.calls, [['send', f.item.id]]); await f.api.pump();
  assert.equal(f.disk.size, 0); assert.equal(f.api.canRetry(id), false);
  f.rows.clear(); assert.equal(f.api.unsent().length, 0);
});

test('native discard uses native custody and cannot delete a sending recording', async t => {
  const f = await page(t), id = f.api.unsent()[0].id;
  f.item.state = 'sending'; assert.equal(await f.api.remove(id), false); assert.equal(f.rows.size, 1);
  f.item.state = 'held'; assert.equal(await f.api.remove(id), true); assert.equal(f.rows.size, 0);
  assert.deepEqual(f.calls, [['discard', f.item.id]]); assert.equal(f.api.unsent().length, 0);
});

test('a native hold survives a shell reload as a read-only projection, never as a second sender', async t => {
  const f = await page(t); await f.api.pump();
  vm.runInNewContext(source, f.ctx); await f.ctx.WosOutbox.load(); await f.ctx.WosOutbox.pump();
  assert.equal(f.ctx.WosOutbox.unsent().length, 1); assert.equal(f.ctx.WosOutbox._items.size, 0); assert.equal(f.disk.size, 0);
  assert.equal(f.calls.length, 0);
});

test('native already-accepted and non-late command items never project as new chat work', async t => {
  const f = await page(t, { state: 'sent' }); assert.equal(f.api.unsent().length, 0);
  f.item.state = 'held'; f.item.lateHeld = false; assert.equal(f.api.unsent().length, 0);
});

test('Settings shows one native held row with Send/Discard through the same bridge', async t => {
  const f = await page(t), ctx = { ...f.ctx, document: { ...f.ctx.document, querySelector() {} } };
  ctx.window = ctx; vm.runInNewContext(settings, ctx);
  const S = ctx.WosSettings, owner = { outbox: f.api, ago: () => 'days ago', changed() {} };
  const all = S.unsentAll(owner); assert.equal(all.length, 1); assert.equal(all[0].origin, 'everywhere');
  const html = S.unsentRow(all[0], owner); assert.match(html, />Send<\/button>/); assert.match(html, />Discard<\/button>/);
  S.retryAll(owner); assert.equal(f.calls.length, 0);
  S.unsentAction(owner, f.item.id, 'everywhere', 'retry'); assert.deepEqual(f.calls, [['send', f.item.id]]);
});

test('native admission holds before uploads and immediately before run POST; commands stay ahead of the gate', () => {
  const deliver = native.slice(native.indexOf('    private void deliver(Item it)'), native.indexOf('    private boolean holdLate(Item it)'));
  assert.equal((deliver.match(/if \(holdLate\(it\)\) return;/g) || []).length, 2);
  assert.ok(deliver.indexOf('if (it.dictation())') < deliver.indexOf('if (holdLate(it))'));
  assert.ok(deliver.indexOf('UsualsVoice.match') < deliver.indexOf('if (holdLate(it))'));
  assert.ok(deliver.indexOf('if (holdLate(it))') < deliver.indexOf('/wizard/files/upload'));
  assert.match(deliver, /if \(holdLate\(it\)\) return;\s*JSONObject run = request\("POST", "\/wizard\/hermes\/v1\/runs"/);
  const retry = native.slice(native.indexOf('    public void retry('), native.indexOf('    public boolean sendLate('));
  assert.doesNotMatch(retry, /approveLate|lateSendApproved\s*=/);
  assert.match(native, /take\.optLong\("startedAt"\)/, 'recording time comes from custody, not recovery time');
});
