// James, 6 Nov 2026: "This message failed. This shouldn't have failed. Please allow it to go through. We don't need
// to limit the number of attachments ... don't impose arbitrary limits on the user." A voice note plus more than eight
// screenshots failed on the device with "Too many attachments including the recording · originals kept".
// No surface caps the NUMBER of files per message; a message that failed only on that old cap is re-admitted once on
// load (same item, same Idempotency-Key) and every other failure kind is left alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const source = process.env.OUTBOX_TEST_SOURCE ? readFileSync(process.env.OUTBOX_TEST_SOURCE, 'utf8') : read('web/outbox.js');
const COUNT_ERROR = 'Too many attachments including the recording · originals kept';
const created = Date.parse('2026-11-06T05:30:00Z');
const files = [...Array.from({ length: 20 }, (_, n) => ({ id: `up_${String(n + 1).padStart(32, '0')}`, name: `shot-${n}.png`, mime: 'image/png', bytes: 10 })),
  { id: 'up_voice00000000000000000000000000', name: 'wizard-voice-1.webm', mime: 'audio/webm', bytes: 4 }];
const row = (extra = {}) => ({ id: 'wos-count-capped', kind: 'new', intent: 'message', deliveryRequested: false,
  sessionId: 'wizard_1793900000000_aaaaaaaaaaaa', model: 'synthetic-model', provider: 'synthetic-provider',
  createdAt: created, updatedAt: created + 1000, state: 'failed', nextAt: 0, attempts: 1, errorStatus: 409, error: COUNT_ERROR,
  text: 'Jonathan tried installing Wizard in alongside mode — synthetic fixture', files: files.map(f => ({ ...f })),
  audio: new Blob(['aaaa'], { type: 'audio/webm' }), audioType: 'audio/webm', audioFile: { ...files[20] }, ...extra });

function client(origin, rows, clock) {
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
    WizConfig: { transcribe: async () => ({ text: 'unused' }), voicePrompt: () => '' },
  };
  ctx.window = ctx; vm.runInNewContext(source, ctx);
  return { api: ctx.WosOutbox, close: () => { for (const t of timers) clearTimeout(t); } };
}
async function until(fn) {
  for (let i = 0; i < 400; i++) { const value = fn(); if (value) return value; await new Promise(r => setTimeout(r, 5)); }
  throw Error('condition not reached');
}
async function fixture(t, items, rows = new Map(items.map(it => [it.id, structuredClone(it)]))) {
  const calls = [], clock = { now: created + 13 * 3600e3 };
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    calls.push({ path: req.url, key: req.headers['idempotency-key'], body: Buffer.concat(chunks).toString() });
    const value = req.url.startsWith('/wizard/hermes/v1/runs') ? { run_id: 'accepted-run' } : {};
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`, page = client(origin, rows, clock);
  t.after(async () => { page.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  await page.api.load(); await page.api.pump();
  return { ...page, rows, clock, calls, runs: () => calls.filter(c => c.path.startsWith('/wizard/hermes/v1/runs')) };
}

test('a message that failed only on the old count cap goes through on load, once, with all 21 files', async t => {
  const f = await fixture(t, [row()]);
  await until(() => f.api.get('wos-count-capped')?.state === 'sent');
  const runs = f.runs();
  assert.equal(runs.length, 1, 'one admission');
  assert.equal(runs[0].key, 'wos-count-capped', 'same Idempotency-Key as Retry');
  const body = JSON.parse(runs[0].body);
  assert.equal(body.wizard_file_ids.length, 21);
  assert.deepEqual(body.wizard_file_ids, files.map(x => x.id));
  assert.equal(body.session_id, 'wizard_1793900000000_aaaaaaaaaaaa');
  assert.equal(body.model, 'synthetic-model'); assert.equal(body.provider, 'synthetic-provider'); assert.equal(body.require_model_lock, true);
  assert.equal(f.rows.get('wos-count-capped').countCapReadmitted, true, 'durably marked: never automatic again');
  // A second page load of the same store never sends it again.
  const again = await fixture(t, [], f.rows);
  await again.api.pump(); assert.equal(again.runs().length, 0);
});

test('the re-admit marker is persisted before the first attempt', async t => {
  const rows = new Map([['wos-count-capped', structuredClone(row())]]);
  const clock = { now: created + 13 * 3600e3 };
  const page = client('http://127.0.0.1:9', rows, clock); t.after(() => page.close());
  await page.api.load();
  assert.equal(rows.get('wos-count-capped').countCapReadmitted, true);
  assert.equal(rows.get('wos-count-capped').state, 'queued');
});

test('the count re-admit happens only once', async t => {
  const f = await fixture(t, [row({ countCapReadmitted: true })]);
  await f.api.pump();
  assert.equal(f.runs().length, 0);
  assert.equal(f.api.get('wos-count-capped').state, 'failed');
  assert.equal(f.api.canRetry('wos-count-capped'), true, 'Retry stays available');
});

for (const [label, extra] of [
  ['another refusal', { error: 'Wizard refused it (400)', errorStatus: 400 }],
  ['a route mismatch', { error: 'Stored route does not match this message · original message kept' }],
  ['no confirmed model', { error: 'No confirmed model route · choose a model before retrying' }],
  ['a stopped message', { error: COUNT_ERROR, cancelled: true }],
  ['a held command', { error: COUNT_ERROR, intent: 'command' }],
]) test(`other failure kinds are left alone: ${label}`, async t => {
  const f = await fixture(t, [row(extra)]);
  await f.api.pump();
  assert.equal(f.runs().length, 0);
  assert.notEqual(f.api.get('wos-count-capped').state, 'sent');
  assert.equal(f.rows.get('wos-count-capped').countCapReadmitted, undefined);
});

test('Retry on a once-readmitted item sends all files', async t => {
  const f = await fixture(t, [row({ countCapReadmitted: true })]);
  assert.equal(f.api.retry('wos-count-capped'), true);
  await until(() => f.api.get('wos-count-capped')?.state === 'sent');
  assert.equal(JSON.parse(f.runs()[0].body).wizard_file_ids.length, 21);
});

test('the outbox has no attachment count refusal', () => {
  assert.doesNotMatch(read('web/outbox.js'), /fileIds\.length\s*>/);
  assert.doesNotMatch(read('web/outbox.js'), /throw new HttpError\([^)]*Too many attachments/);
});

test('no surface caps files per message', () => {
  for (const p of ['web/core/chats.js', 'web/core/chat-power.js', 'web/core/capture-tools.js', 'web/app.js', 'web/core/share-wizard.js', 'web/core/chat-kit.js'])
    assert.doesNotMatch(read(p), /files per message|MAX_FILES|Use up to \d+ files/, p);
});

test('composer accepts more than ten picks at once', async () => {
  const src = read('web/core/chats.js'), start = src.indexOf('  async function addFiles('), end = src.indexOf('  const UPLOAD_ABORT', start);
  const c = { files: [] }, toasts = [];
  const sandbox = { INC: null, ch: () => c, toast: (...a) => toasts.push(a), refreshCompose() {}, saveDraft() {}, paintUpload() {}, PEND: null, PREVIEW: {},
    UPLOAD_ABORT: new Map(), URL: { createObjectURL: () => 'blob:x' }, AbortController, performance, Math,
    uploadFile: async file => ({ id: 'up_' + file.name, name: file.name, mime: file.type, bytes: file.size }) };
  vm.runInNewContext(src.slice(start, end) + ';this.addFiles=addFiles;', sandbox);
  const picks = Array.from({ length: 21 }, (_, n) => new File(['x'], `p${n}.png`, { type: 'image/png' }));
  await sandbox.addFiles('w1', picks);
  assert.equal(c.files.length, 21); assert.equal(c.files.every(f => !f.uploading && f.id), true); assert.equal(toasts.length, 0);
});

test('drafts and file-chip markers keep every file', () => {
  const kit = read('web/core/chat-kit.js');
  const ctx = { window: {}, localStorage: { s: {}, getItem(k) { return this.s[k] ?? null; }, setItem(k, v) { this.s[k] = v; }, removeItem(k) { delete this.s[k]; } }, document: { addEventListener() {} }, location: new URL('https://wizard.test/') };
  ctx.window = Object.assign(ctx, ctx.window); vm.createContext(ctx);
  try { vm.runInContext(kit, ctx); } catch (_) { /* browser-only tail; drafts/chips are defined above it */ }
  const K = ctx.WosChat || ctx.window.WosChat;
  assert.ok(K?.drafts, 'chat-kit loads in the fixture');
  K.drafts.set('k', 'hello', files);
  assert.equal(K.drafts.get('k').files.length, 21);
  const marker = `[WIZARD_FILE_CHIPS_V1]\n${JSON.stringify(files.map(f => ({ id: f.id, filename: f.name, mime: f.mime, bytes: f.bytes })))}\n[/WIZARD_FILE_CHIPS_V1]`;
  assert.equal(K.chipFiles(marker).length, 21);
  const items = Array.from({ length: 21 }, (_, n) => ({ id: n.toString(16).padStart(32, '0'), name: `a${n}.png`, mime: 'image/png' }));
  assert.equal(K.helm(`<helm_attachments>${JSON.stringify({ items })}</helm_attachments>`).attachments.length, 21);
});
