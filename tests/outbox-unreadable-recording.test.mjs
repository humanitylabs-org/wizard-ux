import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

// Robert, 24 Oct 2026: one Mac Safari voice take showed "Wizard reachable · retrying" at the top and in the corner
// for good. Wizard received no upload or transcription request: the browser could no longer read the recording it had
// restored from device storage, and every failed local read was retried as if it were a network blip.
const source = readFileSync(new URL('../web/outbox.js', import.meta.url), 'utf8');
const sessionId = 'wizard_voice_thread';
const unreadable = () => ({ size: 4, type: 'audio/mp4', arrayBuffer: () => Promise.reject(Object.assign(new Error('The operation couldn’t be completed'), { name: 'NotReadableError' })) });

function client(origin, rows, transcribe) {
  const timers = new Set();
  const indexedDB = { open() {
    const r = {};
    queueMicrotask(() => {
      r.result = { close() {}, objectStoreNames: { contains: () => true }, transaction() {
        const tx = { objectStore() { return {
          // A real browser hands back a Blob whose bytes are gone; the fake store keeps a marker for it.
          getAll() { return { result: [...rows.values()].map(x => { const v = structuredClone(x); if (v.brokenAudio) { v.audio = unreadable(); delete v.brokenAudio; } return v; }) }; },
          put(value) { const v = { ...value }; if (v.audio && !(v.audio instanceof Blob)) { v.audio = null; v.brokenAudio = true; } rows.set(v.id, structuredClone(v)); return {}; },
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
  return { api: ctx.WosOutbox, close: () => { for (const t of timers) clearTimeout(t); } };
}
async function until(fn) {
  for (let i = 0; i < 400; i++) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 5)); }
  throw new Error('condition not reached');
}
async function fixture(t, { saved = Uint8Array.from([1, 2, 3, 4]), upload = 200 } = {}) {
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    calls.push({ method: req.method, path: req.url, key: req.headers['idempotency-key'], body: Buffer.concat(chunks).toString() });
    const json = (s, v) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (req.url === '/wizard/files/wf_saved/content') { res.writeHead(200, { 'Content-Type': 'audio/mp4' }); return res.end(Buffer.from(saved)); }
    if (req.url === '/wizard/files/upload') return upload === 200 ? json(200, { file: { id: 'wf_new', filename: 'wizard-voice.m4a', mime: 'audio/mp4', bytes: 4 } }) : json(upload, { error: 'unavailable' });
    if (req.url === '/wizard/hermes/v1/runs') return json(202, { run_id: 'wizardq_sent', status: 'running' });
    json(500, { error: 'unexpected' });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  return { origin: `http://127.0.0.1:${server.address().port}`, calls };
}
// The stuck take as Safari left it: queued for automatic retry, already tried a few times, bytes unreadable.
function stuckRow(extra = {}) {
  const id = 'wos-' + randomUUID();
  return [id, { id, kind: 'reply', sessionId, model: 'm', provider: 'p', intent: 'message', deliveryRequested: true, state: 'waiting',
    attempts: 3, nextAt: 0, error: 'Couldn’t reach Wizard', errorStatus: 0, createdAt: Date.now() - 60000, updatedAt: Date.now() - 1000,
    audioType: 'audio/mp4', brokenAudio: true, text: '', typed: '', files: [], ...extra }];
}

test('an unreadable recording that never reached Wizard stops retrying and can only be deleted', async t => {
  const f = await fixture(t);
  const rows = new Map([stuckRow()]); const [id] = [...rows.keys()];
  let stt = 0;
  const page = client(f.origin, rows, async () => { stt++; return { text: 'never' }; }); t.after(page.close);
  await page.api.load();
  const it = await until(() => page.api.get(id)?.state === 'failed' && page.api.get(id));
  assert.match(it.error, /can’t be read on this device and never reached Wizard/);
  assert.equal(it.audioUnreadable, true);
  assert.equal(page.api.canRetry(id), false);
  assert.equal(page.api.retry(id), false);
  assert.equal(page.api.unsent().some(x => x.state === 'waiting'), false); // nothing left to hold a retrying banner up
  await new Promise(r => setTimeout(r, 50));
  assert.equal(stt, 0);
  assert.deepEqual(f.calls, []); // Wizard was never asked for anything it could not answer
  assert.equal(await page.api.remove(id), true);
});

test('an unreadable recording Wizard already saved waits for Retry, then sends from Wizard’s copy once', async t => {
  const f = await fixture(t);
  const audioFile = { id: 'wf_saved', name: 'wizard-voice.m4a', mime: 'audio/mp4', bytes: 4 };
  const rows = new Map([stuckRow({ audioFile, files: [audioFile] })]); const [id] = [...rows.keys()];
  const heard = [];
  const page = client(f.origin, rows, async blob => { heard.push(blob.size); return { text: 'the take that stuck' }; }); t.after(page.close);
  await page.api.load();
  const failed = await until(() => page.api.get(id)?.state === 'failed' && page.api.get(id));
  assert.match(failed.error, /Wizard has a saved copy\. Retry to send it/);
  await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(f.calls, []); // no automatic resend of an old take
  assert.equal(page.api.canRetry(id), true);

  assert.equal(page.api.retry(id), true);
  const sent = await until(() => page.api.get(id)?.state === 'sent' && page.api.get(id));
  assert.equal(sent.text, 'the take that stuck');
  assert.deepEqual(heard, [4]);
  assert.deepEqual(f.calls.map(c => c.path), ['/wizard/files/wf_saved/content', '/wizard/hermes/v1/runs']);
  const run = f.calls.at(-1);
  assert.equal(run.key, id);
  assert.deepEqual(JSON.parse(run.body).wizard_file_ids, ['wf_saved']);
});

test('a saved copy whose size does not match is refused instead of sent', async t => {
  const f = await fixture(t, { saved: Uint8Array.from([1, 2]) });
  const audioFile = { id: 'wf_saved', name: 'wizard-voice.m4a', mime: 'audio/mp4', bytes: 4 };
  const rows = new Map([stuckRow({ audioFile, files: [audioFile] })]); const [id] = [...rows.keys()];
  const page = client(f.origin, rows, async () => ({ text: 'wrong' })); t.after(page.close);
  await page.api.load();
  await until(() => page.api.get(id)?.state === 'failed');
  page.api.retry(id);
  await until(() => page.api.get(id)?.state === 'failed' && /doesn’t match/.test(page.api.get(id).error));
  assert.equal(f.calls.filter(c => c.path === '/wizard/hermes/v1/runs').length, 0);
});

test('a readable recording still retries automatically when Wizard is briefly unavailable', async t => {
  const f = await fixture(t, { upload: 503 });
  const id = 'wos-' + randomUUID();
  const rows = new Map([[id, { id, kind: 'reply', sessionId, model: 'm', provider: 'p', intent: 'message', deliveryRequested: true, state: 'queued',
    attempts: 0, nextAt: 0, createdAt: Date.now(), updatedAt: Date.now(), audioType: 'audio/mp4', audio: new Blob(['aaaa'], { type: 'audio/mp4' }), text: '', typed: '', files: [] }]]);
  const page = client(f.origin, rows, async () => ({ text: 'hello' })); t.after(page.close);
  await page.api.load();
  const it = await until(() => page.api.get(id)?.state === 'waiting' && page.api.get(id));
  assert.equal(it.audioUnreadable, undefined);
  assert.equal(page.api.canRetry(id), true);
  assert.equal(f.calls[0].path, '/wizard/files/upload');
  assert.equal(f.calls[0].body, 'aaaa');
});

test('a slow local read stays retryable instead of being marked unreadable', () => {
  // Codex P2 on #439: a 15 s read timeout is not proof the bytes are gone.
  assert.match(source, /slow = true; reject\(new Error\('read timed out'\)\)/);
  assert.match(source, /if \(slow\) throw new HttpError\(0, 'Reading the recording took too long · original kept'\);/);
  assert.ok(source.indexOf('if (slow) throw') < source.indexOf("never reached Wizard · nothing to retry"), 'checked before the permanent unreadable state');
});
