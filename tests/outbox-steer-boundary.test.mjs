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
    WosAgents: { isOther: a => !!a, get: () => ({ permissions: {} }) },
  };
  ctx.window = ctx; vm.runInNewContext(source, ctx);
  return { api: ctx.WosOutbox, rows, close: () => { for (const t of timers) clearTimeout(t); } };
}
async function settled(api, id, minAttempts = 0) {
  for (let i = 0; i < 300; i++) {
    const it = api.get(id);
    if (['sent', 'failed', 'unconfirmed', 'waiting'].includes(it?.state) && (it.attempts || 0) >= minAttempts) return it;
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
    if (req.url.split('?')[0] === '/wizard/hermes/v1/runs') {
      if (options.admitStatus) return json(options.admitStatus, { error: 'QA request rejected' });
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
  const enqueue = () => c.api.enqueue({ kind: 'reply', sessionId, steerRunId: runId, ...(options.agent ? { agent: options.agent } : {}),
    text: 'Follow up in this same thread', model: 'test-model', provider: 'test-provider', instructions: 'Keep original instructions', files: [{ id: 'drop_attachment' }] });
  return { ...c, calls, admitted, options, enqueue, origin: `http://127.0.0.1:${server.address().port}` };
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
// Hermes forgets a finished run after a while; its steer then answers 404 run_not_found (owner's Tea music
// thread, 20 Oct 2026). The run read still proves it terminal here, so the message continues the thread.
const forgotten = { steerStatus: 404, rejection: { error: { code: 'run_not_found', message: `Run not found: ${runId}` } } };
test('a steer to a run Hermes already forgot continues the same session exactly once', async t => {
  const f = await fixture(t, forgotten); const it = await settled(f.api, (await f.enqueue()).id);
  assert.equal(it.state, 'sent', it.error);
  assert.equal(f.admitted.size, 1);
  assert.equal(JSON.parse(f.calls.find(x => x.path === '/wizard/hermes/v1/runs').body).session_id, sessionId);
});
test('a forgotten-run steer never falls back while the run still reads as working', async t => {
  const f = await fixture(t, { ...forgotten, runStatus: 'running' }); const it = await f.enqueue();
  assert.equal((await settled(f.api, it.id)).state, 'failed');
  assert.equal(f.admitted.size, 0);
});
// Owner's screenshot, 7 Nov 2026: a message sent while the run was queued/starting showed
// "Not sent · Run is not currently accepting steer input". It must wait, never fail, never double-send.
// (A run that has STARTED but whose agent can't steer is covered below: it becomes a queued same-thread turn.)
for (const runStatus of ['queued', 'starting']) {
  test(`a steer refused while the run is ${runStatus} waits instead of failing, then continues once the run ends`, async t => {
    const f = await fixture(t, { runStatus }); const it = await f.enqueue();
    const waiting = await settled(f.api, it.id);
    assert.equal(waiting.state, 'waiting', waiting.error);
    assert.match(waiting.error, /Queued/);
    assert.equal(f.admitted.size, 0);
    f.options.runStatus = 'completed'; waiting.nextAt = 0; await f.api.pump();
    const sent = await settled(f.api, it.id);
    assert.equal(sent.state, 'sent', sent.error);
    assert.equal(f.admitted.size, 1);
    assert.equal(f.calls.filter(x => x.path.includes('/steer')).length, 2);
  });
}
// Codex review on #1141: Stop while waiting must withdraw; stale wait marker must not outlive the wait; routed threads.
test('Stop while a refused steer waits withdraws the message and never sends it', async t => {
  const f = await fixture(t, { runStatus: 'queued' }); const it = await f.enqueue();
  assert.equal((await settled(f.api, it.id)).state, 'waiting');
  const out = await Promise.race([f.api.cancel(it.id), new Promise(r => setTimeout(() => r('HUNG'), 2000))]);
  assert.equal(out.outcome, 'cancelled'); assert.equal(f.admitted.size, 0);
});
test('the wait marker is cleared once the run ends and the message continues as a normal turn', async t => {
  const f = await fixture(t, { runStatus: 'queued' }); const it = await f.enqueue();
  const waiting = await settled(f.api, it.id); assert.ok(waiting.steerWaitSince);
  f.options.runStatus = 'completed'; waiting.nextAt = 0; await f.api.pump();
  const sent = await settled(f.api, it.id); assert.equal(sent.state, 'sent', sent.error);
  assert.equal(sent.steerWaitSince, undefined);
});
for (const runStatus of ['queued', 'running']) {
  test(`a routed (agent-scoped) thread's refused steer is ${runStatus === 'queued' ? 'kept queued' : 'sent as a follow-up'} on the same agent route`, async t => {
    const f = await fixture(t, { runStatus, agent: 'ops' }); const it = await f.enqueue();
    const done = await settled(f.api, it.id);
    assert.equal(done.state, runStatus === 'queued' ? 'waiting' : 'sent', done.error);
    for (const c of f.calls) assert.match(c.path, /[?&]agent=ops(&|$)/, `unscoped call: ${c.method} ${c.path}`);
    assert.equal(f.admitted.size, runStatus === 'queued' ? 0 : 1);
  });
}
test('a queued-run steer that becomes steerable is delivered as a steer, once', async t => {
  const f = await fixture(t, { runStatus: 'queued' }); const it = await f.enqueue();
  const waiting = await settled(f.api, it.id); assert.equal(waiting.state, 'waiting');
  f.options.accepted = true; waiting.nextAt = 0; await f.api.pump();
  const sent = await settled(f.api, it.id); assert.equal(sent.state, 'sent', sent.error);
  assert.equal(sent.steered, true); assert.equal(f.admitted.size, 0);
});
test('Stop while a rejected steer waits for a queued run withdraws the message instead of hanging', async t => {
  const f = await fixture(t, { runStatus: 'queued' }); const it = await f.enqueue();
  const waiting = await settled(f.api, it.id); assert.equal(waiting.state, 'waiting');
  const out = await Promise.race([f.api.cancel(it.id), new Promise(r => setTimeout(() => r({ outcome: 'HUNG' }), 1000))]);
  assert.notEqual(out.outcome, 'HUNG', 'cancel must settle');
  assert.equal(f.admitted.size, 0);
});
test('a run that never becomes steerable stops waiting and fails visibly', async t => {
  const f = await fixture(t, { runStatus: 'queued' }); const it = await f.enqueue();
  const waiting = await settled(f.api, it.id); assert.equal(waiting.state, 'waiting');
  f.api.get(it.id).steerWaitSince = Date.now() - 16 * 60e3; waiting.nextAt = 0; await f.api.pump();
  assert.equal((await settled(f.api, it.id)).state, 'failed'); assert.equal(f.admitted.size, 0);
});
// Hermes (stock) answers 409 run_not_accepting_steer for a run whose agent has no steer() even while the run reads
// 'running' (claude-sonnet-5-5, 7 Nov 2026). A typed 409 proves non-acceptance; the Agent Service holds a new turn
// for a session whose run is still working, so the follow-up goes out as one frozen, idempotent same-thread turn.
for (const status of ['running', 'launching', 'stopping', 'waiting_for_approval']) {
  test(`a typed 409 steer rejection while the run reads ${status} sends one queued same-thread follow-up`, async t => {
    const f = await fixture(t, { runStatus: status }); const it = await settled(f.api, (await f.enqueue()).id);
    assert.equal(it.state, 'sent', it.error);
    assert.equal(it.error, '');
    assert.equal(it.steered, false);
    assert.equal(it.rejectedSteerRunId, runId);
    assert.equal(f.admitted.size, 1);
    assert.equal(f.calls.filter(x => x.path.includes('/steer')).length, 1, 'the steer is never sent twice');
    const posts = f.calls.filter(x => x.path === '/wizard/hermes/v1/runs');
    assert.equal(posts.length, 1, 'exactly one new-turn POST');
    assert.equal(posts[0].key, it.id);
    assert.deepEqual(JSON.parse(posts[0].body), { input: it.text, model: 'test-model', provider: 'test-provider', require_model_lock: true, wizard_file_ids: ['drop_attachment'], session_id: sessionId, instructions: 'Keep original instructions' });
    assert.equal(it.steerBody, undefined); assert.equal(it.steerRunId, '');
  });
}
test('a lost receipt on the queued follow-up replays the same frozen admission, never the steer', async t => {
  const f = await fixture(t, { runStatus: 'running', loseAdmission: true }); const it = await f.enqueue();
  assert.equal((await settled(f.api, it.id)).state, 'waiting');
  assert.equal(f.api.retry(it.id), true);
  assert.equal((await settled(f.api, it.id)).state, 'sent');
  assert.equal(f.calls.filter(x => x.path.includes('/steer')).length, 1);
  const posts = f.calls.filter(x => x.path === '/wizard/hermes/v1/runs');
  assert.equal(posts.length, 2); assert.equal(posts[0].body, posts[1].body); assert.equal(posts[0].key, posts[1].key);
  assert.equal(f.admitted.size, 1);
});
test('reload after a lost receipt on the queued follow-up replays admission, not steering', async t => {
  const f = await fixture(t, { runStatus: 'running', loseAdmission: true }); const it = await f.enqueue();
  assert.equal((await settled(f.api, it.id)).state, 'waiting'); f.close();
  const restored = client(f.origin, f.rows); t.after(restored.close);
  await restored.api.load(); assert.equal(restored.api.retry(it.id), true);
  assert.equal((await settled(restored.api, it.id)).state, 'sent');
  assert.equal(f.calls.filter(x => x.path.includes('/steer')).length, 1);
  assert.equal(f.admitted.size, 1);
});
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
test('a legacy transient failed record with an ambiguous steer dispatch never revives', async t => {
  const f = await fixture(t, { ambiguous: 'network' }); const it = await f.enqueue();
  assert.equal((await settled(f.api, it.id)).state, 'unconfirmed'); f.close();
  const row = f.rows.get(it.id); row.state = 'failed'; row.error = 'Couldn’t reach Wizard';
  const restored = client(f.origin, f.rows); t.after(restored.close);
  await restored.api.load(); await restored.api.pump();
  assert.equal(restored.api.get(it.id).state, 'unconfirmed');
  assert.equal(restored.api.retry(it.id), false);
  assert.equal(f.calls.filter(x => x.path.includes('/steer')).length, 1);
});
for (const status of [408, 425, 429, 500, 503, 403, 413]) test(`ordinary admission HTTP ${status} retains correct retry policy past the old limit`, async t => {
  const f = await fixture(t, { admitStatus: status });
  const item = await f.api.enqueue({ kind: 'reply', sessionId, text: 'Same original message', model: 'test-model', provider: 'test-provider' });
  const expected = status === 403 || status === 413 ? 'failed' : 'waiting';
  const attempts = expected === 'waiting' ? 8 : 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await settled(f.api, item.id, attempt); assert.equal(result.state, expected);
    assert.equal(result.attempts, attempt);
    if (attempt < attempts) { result.nextAt = 0; await f.api.pump(); }
  }
  assert.equal(f.calls.length, attempts);
  assert.equal(new Set(f.calls.map(c => c.key)).size, 1);
  assert.equal(new Set(f.calls.map(c => c.body)).size, 1);
});
for (const options of [
  { accepted: true }, { runStatus: 'running', ...forgotten }, { runStatus: 'queued', ...forgotten }, { runStatus: 'stopping', ...forgotten },
  { runStatus: 'running', otherRun: 'another-run' }, { runStatus: 'running', otherSession: 'another-session' }, { runStatus: 'running', readStatus: 503 },
  { runStatus: 'running', rejection: { error: { code: 'model_lock_mismatch', message: 'Route changed' } } },
  { runStatus: 'running', rejection: { error: 'untyped conflict' } }, { runStatus: 'running', steerStatus: 403 },
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
  // Old clients failed every steer rejection on a working run. Today a typed run_not_accepting_steer on a working
  // run is sent as a queued follow-up, so the historical failed item is built from a different typed rejection.
  const f = await fixture(t, { runStatus: 'running', rejection: { error: { code: 'model_lock_mismatch', message: 'Route changed' } } });
  const item = await f.enqueue();
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
// 8 Nov 2026: Hermes accepted a reply and never started it; the phone re-steered every 3 s and was refused (409)
// 166 times. Refusals back off (3 s, doubling, at most a minute) and say the agent has not started yet.
test('repeated refusals while a run never starts back off and say the agent has not started', async t => {
  const f = await fixture(t, { runStatus: 'queued' }); const it = await f.enqueue();
  const delays = [], labels = [];
  for (let i = 0; i < 6; i++) {
    const waiting = await settled(f.api, it.id, 0); assert.equal(waiting.state, 'waiting', waiting.error);
    delays.push(Math.round((waiting.nextAt - Date.now()) / 1000)); labels.push(waiting.error);
    waiting.nextAt = 0; await f.api.pump(); await settled(f.api, it.id);
  }
  assert.deepEqual(delays, [3, 6, 12, 24, 48, 60]);
  assert.match(labels[0], /^Queued · /);
  assert.match(labels[5], /hasn’t started the current reply yet/);
  assert.equal(f.calls.filter(x => x.path.includes('/steer')).length, 7);
  assert.equal(f.admitted.size, 0);
});
