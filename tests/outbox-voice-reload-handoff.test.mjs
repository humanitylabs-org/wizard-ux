import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

// James, 22 Oct 2026: Reload waited 5-10 s behind a six-minute voice note's upload + transcription. A tap take whose
// destination is fixed is handed to the outbox; a reload mid-send must finish that SAME send on the new page, once.
const source = readFileSync(new URL('../web/outbox.js', import.meta.url), 'utf8');
const sessionId = 'wizard_philosopher';

function client(origin, rows = new Map(), transcribe = async () => ({ text: 'six minutes of philosophy' })) {
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
  const ctx = { console, Blob, AbortController, AbortSignal, indexedDB, crypto: { randomUUID },
    document: { documentElement: { dataset: {} }, body: null, addEventListener() {} },
    localStorage: { getItem: () => null, removeItem() {}, setItem() {} },
    addEventListener() {}, clearTimeout,
    setTimeout(fn, ms) { const t = setTimeout(fn, ms); t.unref(); timers.add(t); return t; },
    fetch: (path, init) => fetch(origin + path, init),
    WosModels: { snapshot: (_, route) => route, resolveRoute: async route => route },
    WizConfig: { transcribe, voicePrompt: () => '' },
  };
  ctx.window = ctx; vm.runInNewContext(source, ctx);
  return { api: ctx.WosOutbox, rows, close: () => { for (const t of timers) clearTimeout(t); } };
}
async function until(fn) {
  for (let i = 0; i < 400; i++) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 5)); }
  throw new Error('condition not reached');
}
async function fixture(t) {
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    calls.push({ path: req.url, key: req.headers['idempotency-key'], body: Buffer.concat(chunks).toString() });
    const json = (s, v) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (req.url === '/wizard/files/upload') return json(200, { file: { id: 'drop_voice', filename: 'wizard-voice.aac', mime: 'audio/aac', bytes: 4 } });
    if (req.url === '/wizard/hermes/v1/runs') return json(202, { run_id: 'wizardq_new', status: 'running' });
    json(500, { error: 'unexpected' });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  return { origin, calls };
}
const stageTake = (api, extra = {}) => api.stage({ kind: 'reply', sessionId, model: 'm', provider: 'p', audio: new Blob(['aaaa'], { type: 'audio/aac' }),
  intent: 'auto', instructions: 'voice, aimed at this thread', source: 'orb', ...extra });

test('a handed-off voice take survives a reload mid-transcription and is sent exactly once', async t => {
  const f = await fixture(t);
  const page1 = client(f.origin, new Map(), () => new Promise(() => {})); // transcription still running at reload
  const it = await stageTake(page1.api);
  assert.equal(it.state, 'processing');
  assert.equal(await page1.api.handOff(it.id), true);
  assert.equal(page1.api.handedOff(it.id), true);
  page1.close(); // reload

  const page2 = client(f.origin, page1.rows); t.after(page2.close);
  await page2.api.load();
  const sent = await until(() => page2.api.get(it.id)?.state === 'sent' && page2.api.get(it.id));
  assert.equal(sent.text, 'six minutes of philosophy');
  const runs = f.calls.filter(c => c.path === '/wizard/hermes/v1/runs');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].key, it.id);
  const body = JSON.parse(runs[0].body);
  assert.equal(body.session_id, sessionId);
  assert.deepEqual(body.wizard_file_ids, ['drop_voice']);
});

test('a transcript the old page already heard is reused, not transcribed again', async t => {
  const f = await fixture(t);
  const page1 = client(f.origin);
  const it = await stageTake(page1.api);
  await page1.api.handOff(it.id);
  await page1.api.keepTranscript(it.id, 'already heard');
  page1.close();
  let stt = 0;
  const page2 = client(f.origin, page1.rows, async () => { stt++; return { text: 'again' }; }); t.after(page2.close);
  await page2.api.load();
  const sent = await until(() => page2.api.get(it.id)?.state === 'sent' && page2.api.get(it.id));
  assert.equal(sent.text, 'already heard');
  assert.equal(stt, 0);
});

test('an explicit retry after a timeout drops the stale 408, so a reload mid-retry finishes the send', async t => {
  const f = await fixture(t);
  const page1 = client(f.origin, new Map(), () => new Promise(() => {})); // the retried transcription is still running
  const it = await stageTake(page1.api);
  await page1.api.handOff(it.id);
  const row = page1.rows.get(it.id);
  Object.assign(row, { state: 'failed', deliveryRequested: true, attempts: 1, errorStatus: 408, error: 'Transcription timed out · original recording kept. Retry when ready.',
    audioFile: { id: 'drop_voice', name: 'voice.aac', mime: 'audio/aac', bytes: 4 } });
  page1.rows.set(it.id, row); await page1.api.load();
  page1.api.get(it.id) && Object.assign(page1.api.get(it.id), structuredClone(row));
  assert.equal(page1.api.retry(it.id), true);
  const sending = await until(() => page1.rows.get(it.id)?.state === 'sending' && page1.rows.get(it.id));
  assert.equal(sending.errorStatus, 0); assert.equal(sending.error, '');
  page1.close(); // reload while the retry is transcribing

  const page2 = client(f.origin, page1.rows); t.after(page2.close);
  await page2.api.load();
  const sent = await until(() => page2.api.get(it.id)?.state === 'sent' && page2.api.get(it.id));
  assert.equal(sent.text, 'six minutes of philosophy');
});

test('a recovered timed-out transcription releases Working and keeps its original recording', async t => {
  const f = await fixture(t);
  const page1 = client(f.origin); t.after(page1.close);
  const it = await stageTake(page1.api);
  await page1.api.handOff(it.id);
  const row = page1.rows.get(it.id);
  Object.assign(row, {
    state: 'sending', deliveryRequested: true, attempts: 2, errorStatus: 408, error: 'HTTP 408',
    lastAttemptAt: Date.now() - 1000, audioFile: { id: 'drop_voice', name: 'voice.aac', mime: 'audio/aac', bytes: 4 },
  });
  page1.rows.set(it.id, row); page1.close();

  const page2 = client(f.origin, page1.rows, async () => { throw new Error('must not auto retry'); }); t.after(page2.close);
  await page2.api.load();
  const recovered = page2.api.get(it.id);
  assert.equal(recovered.state, 'failed');
  assert.match(recovered.error, /Transcription timed out/);
  assert.equal(recovered.audio.size, 4);
  await new Promise(r => setTimeout(r, 50));
  assert.equal(f.calls.filter(c => c.path === '/wizard/hermes/v1/runs').length, 0);
});

test('held commands and takes never handed off keep the old interrupted-and-kept behaviour', async t => {
  const f = await fixture(t);
  const page1 = client(f.origin);
  const cmd = await stageTake(page1.api, { intent: 'command' });
  assert.equal(await page1.api.handOff(cmd.id), false);
  const plain = await stageTake(page1.api);
  page1.close();
  const page2 = client(f.origin, page1.rows); t.after(page2.close);
  await page2.api.load();
  assert.equal(page2.api.get(cmd.id).state, 'held');
  assert.equal(page2.api.get(plain.id).state, 'failed');
  await new Promise(r => setTimeout(r, 50));
  assert.equal(f.calls.filter(c => c.path === '/wizard/hermes/v1/runs').length, 0);
});

test('a take with no confirmed model route is never handed off', async t => {
  const f = await fixture(t);
  const page1 = client(f.origin); t.after(page1.close);
  const it = await stageTake(page1.api, { model: '', provider: '' });
  assert.equal(await page1.api.handOff(it.id), false);
  assert.equal(page1.api.handedOff(it.id), false);
});
