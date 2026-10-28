import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(process.env.OUTBOX_TEST_SOURCE || new URL('../web/outbox.js', import.meta.url), 'utf8');
const chats = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const SIX_HOURS = 6 * 60 * 60 * 1000;
const recorded = Date.parse('2026-10-22T08:33:00Z');
const row = (extra = {}) => ({ id: 'late-voice', kind: 'reply', intent: 'message', deliveryRequested: true,
  sessionId: 'original-thread', agent: 'philosopher', model: 'original-model', provider: 'original-provider',
  createdAt: recorded, updatedAt: recorded, state: 'waiting', nextAt: 0, attempts: 0,
  audio: new Blob(['aaaa'], { type: 'audio/aac' }), audioType: 'audio/aac', ...extra });

function client(origin, rows, clock, transcribe = async () => ({ text: 'words recorded days ago' })) {
  const timers = new Set();
  const indexedDB = { open() {
    const r = {};
    queueMicrotask(() => {
      r.result = { close() {}, objectStoreNames: { contains: () => true }, transaction() {
        const tx = { objectStore() { return {
          getAll() { return { result: [...rows.values()].map(x => structuredClone(x)) }; },
          put(value) { rows.set(value.id, structuredClone(value)); return {}; },
          delete(id) { rows.delete(id); return {}; },
        }; } };
        setImmediate(() => tx.oncomplete?.()); return tx;
      } }; r.onsuccess();
    }); return r;
  } };
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } static now() { return clock.now; } }
  const ctx = { console, Date: ClockDate, Blob, AbortController, AbortSignal, indexedDB, crypto: { randomUUID },
    document: { documentElement: { dataset: {} }, body: null, addEventListener() {} },
    localStorage: { getItem: () => null, removeItem() {}, setItem() {} }, addEventListener() {}, clearTimeout,
    setTimeout(fn, ms) { const t = setTimeout(fn, ms); t.unref(); timers.add(t); return t; },
    fetch: (path, init) => fetch(origin + path, init),
    WosModels: { snapshot: (_, route) => route, resolveRoute: async route => route },
    WizConfig: { transcribe, voicePrompt: () => '' },
  };
  ctx.window = ctx; vm.runInNewContext(source, ctx);
  return { api: ctx.WosOutbox, close: () => { for (const t of timers) clearTimeout(t); } };
}
async function until(fn) {
  for (let i = 0; i < 400; i++) { const value = fn(); if (value) return value; await new Promise(r => setTimeout(r, 5)); }
  throw Error('condition not reached');
}
async function fixture(t, item = row(), now = recorded + 5 * 24 * SIX_HOURS / 6, transcribe) {
  const calls = [], rows = new Map([[item.id, structuredClone(item)]]), clock = { now };
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    calls.push({ path: req.url, key: req.headers['idempotency-key'], body: Buffer.concat(chunks).toString() });
    const value = req.url.startsWith('/wizard/files/upload') ? { file: { id: 'voice-receipt', filename: 'v.aac', mime: 'audio/aac', bytes: 4 } }
      : req.url.startsWith('/wizard/hermes/v1/runs') ? { run_id: 'accepted-run' } : {};
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`, page = client(origin, rows, clock, transcribe && (() => transcribe(clock)));
  t.after(async () => { page.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  await page.api.load(); await page.api.pump();
  return { ...page, origin, rows, clock, calls, runs: () => calls.filter(c => c.path.startsWith('/wizard/hermes/v1/runs')) };
}

test('a voice note recorded days ago asks before sending', async t => {
  const f = await fixture(t);
  const it = await until(() => f.api.get('late-voice')?.state === 'held' && f.api.get('late-voice'));
  assert.equal(f.calls.length, 0, 'not even upload or transcription before consent');
  assert.equal(it.lateHeld, true); assert.equal(it.audio.size, 4);
  assert.equal(f.rows.get(it.id).state, 'held', 'hold is durable');
  assert.match(f.api.lateLabel(it), /^Recorded 22 Oct, \d\d:\d\d · not sent yet$/);
  assert.match(it.error, /Send when ready/);
  assert.equal(f.api.forThread('original-thread').length, 1);
  assert.equal(f.api.forThread('a-different-thread').length, 0);
  assert.equal(f.api.canRetry(it), true);
  assert.equal(f.api.retryAll(), 0, 'bulk Retry never sends a held late message');
  await f.api.pump(); assert.equal(f.calls.length, 0);
});

for (const age of [SIX_HOURS - 1, SIX_HOURS]) test(`a fresh item sends normally at age ${age} ms`, async t => {
  const f = await fixture(t, row(), recorded + age);
  const it = await until(() => f.api.get('late-voice')?.state === 'sent' && f.api.get('late-voice'));
  assert.equal(it.lateHeld, undefined); assert.equal(f.runs().length, 1);
});

test('owner Send on a held late item sends once to its original thread', async t => {
  const f = await fixture(t);
  await until(() => f.api.get('late-voice')?.state === 'held');
  assert.equal(f.api.retry('late-voice'), true);
  assert.equal(f.api.retry('late-voice'), false, 'double tap is claimed synchronously');
  await until(() => f.api.get('late-voice')?.state === 'sent');
  await f.api.pump();
  assert.equal(f.runs().length, 1);
  const send = f.runs()[0], body = JSON.parse(send.body);
  assert.equal(send.key, 'late-voice'); assert.equal(body.session_id, 'original-thread');
  assert.equal(body.agent, 'philosopher'); assert.equal(body.model, 'original-model'); assert.equal(body.provider, 'original-provider');
  assert.equal(body.input, 'words recorded days ago');
  assert.equal(f.rows.get('late-voice').lateSendApproved, true);
});

test('owner Send consent survives reload without a re-hold loop', async t => {
  const f = await fixture(t, row({ lateHeld: true, lateSendApproved: true, state: 'queued' }));
  await until(() => f.api.get('late-voice')?.state === 'sent');
  assert.equal(f.runs().length, 1);
});

test('discard removes a late recording and it cannot return on reload', async t => {
  const f = await fixture(t);
  await until(() => f.api.get('late-voice')?.state === 'held');
  assert.equal(await f.api.remove('late-voice'), true);
  assert.equal(f.api.unsent().length, 0); assert.equal(f.api.forThread('original-thread').length, 0);
  assert.equal(f.api.get('late-voice').audio, undefined);
  assert.equal(f.rows.get('late-voice').compact, true, 'durable tombstone prevents replay');
  f.close(); const reload = client(f.origin, f.rows, f.clock); t.after(reload.close);
  await reload.api.load(); await reload.api.pump();
  assert.equal(reload.api.unsent().length, 0); assert.equal(reload.api.retry('late-voice'), false);
  assert.equal(f.calls.length, 0);
});

test('an item crossing six hours during transcription is held before run admission', async t => {
  const f = await fixture(t, row(), recorded + SIX_HOURS - 1, clock => { clock.now += 2; return { text: 'just transcribed' }; });
  await until(() => f.api.get('late-voice')?.state === 'held');
  assert.equal(f.runs().length, 0); assert.equal(f.api.get('late-voice').text, 'just transcribed');
  assert.equal(f.api.retry('late-voice'), true);
  await until(() => f.api.get('late-voice')?.state === 'sent'); assert.equal(f.runs().length, 1);
});

test('late typed chat messages also require Send, commands and server receipts are untouched', async t => {
  const f = await fixture(t, row({ audio: null, audioType: '', text: 'old typed message' }));
  await until(() => f.api.get('late-voice')?.state === 'held');
  assert.match(f.api.lateLabel(f.api.get('late-voice')), /^Written /); assert.equal(f.calls.length, 0);
  const command = await fixture(t, row({ intent: 'command', deliveryRequested: false, state: 'held', text: 'local command' }));
  assert.equal(command.api.get('late-voice').lateHeld, undefined); assert.equal(command.api.retry('late-voice'), false); assert.equal(command.calls.length, 0);
  const accepted = await fixture(t, row({ state: 'sent', sentAt: recorded + 1, runId: 'already-accepted' }));
  assert.equal(accepted.api.get('late-voice').lateHeld, undefined); assert.equal(accepted.calls.length, 0);
});

test('native web handoff preserves the original recording time', async t => {
  const f = await fixture(t);
  const it = await f.api.enqueue({ nativeId: 'old-native', createdAt: recorded, kind: 'reply', sessionId: 'original-thread', model: 'm', provider: 'p', text: 'native old note' });
  await until(() => it.state === 'held');
  assert.equal(it.createdAt, recorded); assert.equal(f.runs().length, 0);
  const device = readFileSync(new URL('../web/core/device-recording.js', import.meta.url), 'utf8');
  assert.match(device, /createdAt: Number\(t.startedAt\)/);
});

function uiHarness(api) {
  const w = { id: 'test', thread: 'original-thread' }, c = { readNav: 1, trail: ['parent-thread'] }, opened = [], notices = [];
  const H = { win: () => w, toast: (...args) => notices.push(args) };
  const ctx = { OUTBOX: api, H, ch: () => c, LIVE: { session: sid => sid === 'parent-thread' },
    openChat: (_, sid) => { w.thread = sid; opened.push(sid); }, chatsBack: () => { w.thread = null; opened.push('list'); },
    Promise, window: {}, esc: s => s, reach: () => ({}), troubleshoot: '' };
  const back = chats.slice(chats.indexOf('  function threadBack(w) {'), chats.indexOf('  /* Send steps back'));
  const click = chats.slice(chats.indexOf('  function click(e, id) {'), chats.indexOf("    const recovery = e.target.closest('[data-obrecover]');")) + '\n return false; }';
  const pending = chats.slice(chats.indexOf('  function pendingState(p, s) {'), chats.indexOf('  function pendingHtml('));
  vm.runInNewContext(back + click + pending + '\nthis.click = click; this.pendingState = pendingState; this.threadBack = threadBack;', ctx);
  return { ...ctx, w, c, opened, notices };
}

test('late held thread has Send and Discard; one Discard tap returns one screen, Back stays in app', async t => {
  const f = await fixture(t); await until(() => f.api.get('late-voice')?.state === 'held');
  const h = uiHarness(f.api), html = h.pendingState(f.api.get('late-voice'));
  assert.match(html, /Recorded 22 Oct/); assert.match(html, /data-obretry="late-voice">Send/); assert.match(html, /data-obdiscard="late-voice">Discard/);
  const button = { dataset: { obdiscard: 'late-voice' }, disabled: false };
  const event = { target: { closest: selector => selector === '[data-obdiscard]' ? button : null } };
  assert.equal(h.click(event, 'test'), true);
  await until(() => h.w.thread === 'parent-thread');
  assert.equal(f.api.unsent().length, 0); assert.deepEqual(h.opened, ['parent-thread']);
  assert.equal(h.threadBack(h.w), 'thread'); assert.equal(h.w.thread, null); assert.deepEqual(h.opened, ['parent-thread', 'list']);
});

test('a failed discard stays put and a pending discard cannot steal later navigation', async () => {
  let resolve;
  const api = { get: () => ({ id: 'late', state: 'held', lateHeld: true }), remove: () => new Promise(r => { resolve = r; }) };
  const h = uiHarness(api), button = { dataset: { obdiscard: 'late' } };
  const event = { target: { closest: s => s === '[data-obdiscard]' ? button : null } };
  h.click(event, 'test'); resolve(false); await new Promise(r => setImmediate(r));
  assert.equal(h.w.thread, 'original-thread'); assert.equal(button.disabled, false);
  h.click(event, 'test'); h.w.thread = 'another-thread'; h.c.readNav++; resolve(true); await new Promise(r => setImmediate(r));
  assert.equal(h.w.thread, 'another-thread'); assert.deepEqual(h.opened, []);
});
