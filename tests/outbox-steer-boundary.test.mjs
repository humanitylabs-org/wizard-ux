import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

const source = readFileSync(process.env.OUTBOX_TEST_SOURCE || new URL('../web/outbox.js', import.meta.url), 'utf8');
const runId = 'wizardq_finished', sessionId = 'wizard_existing';
const rejection = { error: { code: 'run_not_accepting_steer', message: `Run is not currently accepting steer input: ${runId}` } };

// Exercise the entire production outbox against an HTTP boundary, not extracted
// functions or source assertions. A minimal IDB implements transaction completion
// and structured-clone persistence, including reloads of dispatch journals.
function client(origin, rows = new Map()) {
  const timers = new Set();
  const indexedDB = { open() {
    const r = {};
    queueMicrotask(() => {
      r.result = { close() {}, objectStoreNames: { contains: () => true }, transaction() {
        const tx = { objectStore() { return {
          getAll() { const q = { result: [...rows.values()].map(x => structuredClone(x)) }; return q; },
          put(value) { rows.set(value.id, structuredClone(value)); return {}; },
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
  };
  ctx.window = ctx; vm.runInNewContext(source, ctx);
  return { api: ctx.WosOutbox, rows, close: () => { for (const t of timers) clearTimeout(t); } };
}
async function settled(api, id) {
  for (let i = 0; i < 300; i++) {
    const it = api.get(id);
    if (['sent', 'failed', 'unconfirmed', 'waiting'].includes(it?.state)) return it;
    await new Promise(r => setTimeout(r, 5));
  }
  throw new Error('Outbox did not settle');
}
async function fixture(t, options = {}) {
  const calls = [], admitted = new Map(); let loseAdmission = !!options.loseAdmission;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    calls.push({ path: req.url, method: req.method, body, key: req.headers['idempotency-key'] });
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.url.includes('/steer')) {
      if (options.ambiguous === 'network') { req.socket.destroy(); return; }
      if (options.ambiguous === 'json') { res.writeHead(200); res.end('not json'); return; }
      if (options.accepted) return json(200, { accepted: true, run_id: runId });
      return json(options.steerStatus || 409, options.rejection || rejection);
    }
    if (req.method === 'GET') {
      if (options.beforeRead) await options.beforeRead();
      return json(options.readStatus || 200, { run_id: options.otherRun || runId, session_id: options.otherSession || sessionId, status: options.runStatus || 'completed' });
    }
    if (req.url === '/wizard/hermes/v1/runs') {
      const key = req.headers['idempotency-key'];
      if (admitted.has(key)) assert.equal(admitted.get(key), body, 'idempotent replay is byte-identical');
      admitted.set(key, body);
      if (loseAdmission) { loseAdmission = false; req.socket.destroy(); return; }
      return json(202, { run_id: 'wizardq_continuation', status: 'running' });
    }
    json(500, { error: 'unexpected request' });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const c = client(`http://127.0.0.1:${server.address().port}`);
  t.after(async () => { c.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const enqueue = () => c.api.enqueue({ kind: 'reply', sessionId, steerRunId: runId,
    text: 'Follow up in this same thread', model: 'test-model', provider: 'test-provider', instructions: 'Keep original instructions', files: [{ id: 'drop_attachment' }] });
  return { ...c, calls, admitted, enqueue, origin: `http://127.0.0.1:${server.address().port}` };
}

for (const status of ['completed', 'failed', 'cancelled', 'interrupted', 'expired']) {
  test(`definite steer rejection after ${status} continues the same session exactly once`, async t => {
    const f = await fixture(t, { runStatus: status }); const enqueued = await f.enqueue();
    const it = await settled(f.api, enqueued.id);
    assert.equal(it.state, 'sent', it.error);
    assert.equal(it.steered, false);
    assert.equal(f.admitted.size, 1);
    const call = f.calls.find(x => x.path === '/wizard/hermes/v1/runs');
    assert.equal(call.key, it.id);
    assert.deepEqual(JSON.parse(call.body), { input: it.text, model: 'test-model', provider: 'test-provider', require_model_lock: true, wizard_file_ids: ['drop_attachment'], session_id: sessionId, instructions: 'Keep original instructions' });
    f.api.retry(it.id); await f.api.pump(); assert.equal(f.calls.filter(x => x.method === 'POST').length, 2);
  });
}
test('lost continuation receipt retries its frozen admission, never the rejected steer', async t => {
  const f = await fixture(t, { loseAdmission: true }); const it = await f.enqueue();
  assert.equal((await settled(f.api, it.id)).state, 'waiting');
  assert.equal(f.api.retry(it.id), true);
  assert.equal((await settled(f.api, it.id)).state, 'sent');
  assert.equal(f.calls.filter(x => x.path.includes('/steer')).length, 1);
  assert.equal(f.admitted.size, 1);
});
test('reload after lost continuation receipt replays admission, not steering', async t => {
  const f = await fixture(t, { loseAdmission: true }); const it = await f.enqueue();
  assert.equal((await settled(f.api, it.id)).state, 'waiting'); f.close();
  const restored = client(f.origin, f.rows); t.after(restored.close);
  await restored.api.load(); assert.equal(restored.api.retry(it.id), true);
  assert.equal((await settled(restored.api, it.id)).state, 'sent');
  assert.equal(f.calls.filter(x => x.path.includes('/steer')).length, 1);
  assert.equal(f.admitted.size, 1);
});
test('Retry cannot race the terminal-status read into duplicate delivery', async t => {
  let release, entered;
  const gate = new Promise(r => { release = r; });
  const reading = new Promise(r => { entered = r; });
  const f = await fixture(t, { beforeRead: async () => { entered(); await gate; } });
  const it = await f.enqueue();
  await Promise.race([reading, new Promise((_, reject) => setTimeout(() => reject(new Error('No terminal-status read after rejection')), 1000))]);
  try {
    assert.equal(f.api.get(it.id).state, 'sending');
    assert.equal(f.api.retry(it.id), false); assert.equal(f.api.retryAll(), 0);
  } finally { release(); }
  assert.equal((await settled(f.api, it.id)).state, 'sent');
  assert.equal(f.calls.filter(x => x.path.includes('/steer')).length, 1);
  assert.equal(f.admitted.size, 1);
});
for (const options of [
  { ambiguous: 'network' }, { ambiguous: 'json' }, { steerStatus: 500 }, { steerStatus: 408 },
]) test(`ambiguous steer never falls back or retries: ${JSON.stringify(options)}`, async t => {
  const f = await fixture(t, options); const it = await f.enqueue();
  assert.equal((await settled(f.api, it.id)).state, 'unconfirmed');
  assert.equal(f.api.retry(it.id), false); assert.equal(f.admitted.size, 0);
  const restored = client('http://unused', f.rows); t.after(restored.close);
  await restored.api.load(); assert.equal(restored.api.get(it.id).state, 'unconfirmed');
  assert.equal(restored.api.retry(it.id), false);
});
for (const options of [
  { accepted: true }, { runStatus: 'running' }, { runStatus: 'queued' }, { runStatus: 'stopping' },
  { readStatus: 503 }, { otherRun: 'another-run' }, { otherSession: 'another-session' },
  { rejection: { error: { code: 'model_lock_mismatch', message: 'Route changed' } } },
  { rejection: { error: 'untyped conflict' } }, { steerStatus: 403 },
]) test(`no fallback without definite rejection AND matching terminal run: ${JSON.stringify(options)}`, async t => {
  const f = await fixture(t, options); const it = await f.enqueue();
  const result = await settled(f.api, it.id);
  assert.equal(result.state, options.accepted ? 'sent' : 'failed');
  assert.equal(f.admitted.size, 0);
});

test('a failed old-client item recovers on Retry after the run finishes', async t => {
  const f = await fixture(t, { runStatus: 'running' }); const item = await f.enqueue();
  assert.equal((await settled(f.api, item.id)).state, 'failed');
  // Restore a historical rejected item. Older clients kept only the rejection
  // text, so Retry must obtain a fresh typed rejection rather than infer one.
  const record = f.rows.get(item.id); record.error = rejection.error.message;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.includes('/steer')) { res.statusCode = 409; res.end(JSON.stringify(rejection)); }
    else if (req.method === 'GET') res.end(JSON.stringify({ run_id: runId, session_id: sessionId, status: 'completed' }));
    else res.end(JSON.stringify({ run_id: 'continued' }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const restored = client(`http://127.0.0.1:${server.address().port}`, f.rows);
  t.after(async () => { restored.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  await restored.api.load(); assert.equal(restored.api.retry(item.id), true);
  assert.equal((await settled(restored.api, item.id)).state, 'sent');
});
