import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

// Miguel, 28 Oct 2026: "when I send there is no way to stop the agent for a while; the Stop button shows up late."
// Stop must show the moment a send is pending, and before the run exists it withdraws the send: no run is created.
const outboxSrc = readFileSync(new URL('../web/outbox.js', import.meta.url), 'utf8');
const liveSrc = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
const chatsSrc = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');

function client(origin, transcribe = async () => ({ text: 'hello there' })) {
  const rows = new Map(), timers = new Set();
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
  ctx.window = ctx; vm.runInNewContext(outboxSrc, ctx);
  return { api: ctx.WosOutbox, rows, close: () => { for (const t of timers) clearTimeout(t); } };
}
async function until(fn) {
  for (let i = 0; i < 400; i++) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 5)); }
  throw new Error('condition not reached');
}
async function fixture(t, { holdRuns = false, holdUpload = false } = {}) {
  const calls = []; let release;
  const held = new Promise(r => { release = r; });
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    calls.push({ path: req.url, key: req.headers['idempotency-key'] });
    const json = (s, v) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (req.url === '/wizard/files/upload' && holdUpload) await held;
    if (req.url === '/wizard/files/upload') return json(200, { file: { id: 'drop_voice', filename: 'v.aac', mime: 'audio/aac', bytes: 4 } });
    if (req.url === '/wizard/hermes/v1/runs') { if (holdRuns) await held; return json(202, { run_id: 'run_admitted', status: 'running' }); }
    json(500, { error: 'unexpected' });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { release(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  return { origin: `http://127.0.0.1:${server.address().port}`, calls, release };
}
const runs = f => f.calls.filter(c => c.path === '/wizard/hermes/v1/runs').length;
const voice = () => new Blob(['aaaa'], { type: 'audio/aac' });

test('Stop during server transcription withdraws the voice send: no run is created and the recording is kept', async t => {
  const f = await fixture(t);
  let hear; const heard = new Promise(r => { hear = r; });
  const page = client(f.origin, () => heard); t.after(page.close);
  const it = await page.api.enqueue({ kind: 'reply', sessionId: 'wizard_t', model: 'm', provider: 'p', audio: voice() });
  await until(() => page.api.get(it.id)?.state === 'sending' && f.calls.some(c => c.path === '/wizard/files/upload'));
  const outcome = page.api.cancel(it.id);
  hear({ text: 'please do the thing' }); // transcription returns after the Stop
  const r = await outcome;
  assert.equal(r.outcome, 'cancelled');
  const kept = page.api.get(it.id);
  assert.equal(kept.state, 'held'); assert.equal(kept.cancelled, true); assert.equal(kept.threadHidden, true);
  assert.equal(kept.audio.size, 4, 'original recording kept');
  await new Promise(r => setTimeout(r, 60));
  assert.equal(runs(f), 0, 'no run was admitted');
  assert.equal(page.api.canRetry(kept), false, 'never retried automatically');
  assert.equal(page.api.forThread('wizard_t').length, 0, 'the withdrawn send leaves the thread');
  assert.equal(page.api.recordings().length, 0, 'no recovery card pops over the composer after a deliberate Stop');
  assert.equal(page.api.unsent().length, 1, 'the recording stays listed under Unsent');
});

test('Stop answers at once while a long voice upload is still running, and the upload never becomes a run', async t => {
  const f = await fixture(t, { holdUpload: true });
  const page = client(f.origin); t.after(page.close);
  const it = await page.api.enqueue({ kind: 'reply', sessionId: 'wizard_t', model: 'm', provider: 'p', audio: voice() });
  await until(() => f.calls.some(c => c.path === '/wizard/files/upload'));
  const t0 = Date.now();
  const r = await page.api.cancel(it.id);
  assert.equal(r.outcome, 'cancelled'); assert.ok(Date.now() - t0 < 500, 'no wait for the upload');
  f.release(); // the upload finishes after the Stop
  await until(() => page.api.get(it.id)?.audioFile?.id);
  await new Promise(r => setTimeout(r, 60));
  assert.equal(page.api.get(it.id).state, 'held', 'still a kept recording');
  assert.equal(runs(f), 0);
});

test('Stop on a send still waiting to go (offline / queued) withdraws it at once', async t => {
  const f = await fixture(t);
  const page = client('http://127.0.0.1:9'); t.after(page.close); // unreachable: the item waits for a retry
  const it = await page.api.enqueue({ kind: 'reply', sessionId: 'wizard_t', model: 'm', provider: 'p', text: 'hi' });
  await until(() => page.api.get(it.id)?.state === 'waiting');
  const r = await page.api.cancel(it.id);
  assert.equal(r.outcome, 'cancelled');
  assert.equal(page.api.get(it.id).state, 'held');
  assert.equal(page.api.retryAll(), 0);
  assert.equal(runs(f), 0);
});

test('Stop after the run POST left the phone hands back the real run id from the receipt', async t => {
  const f = await fixture(t, { holdRuns: true });
  const page = client(f.origin); t.after(page.close);
  const it = await page.api.enqueue({ kind: 'reply', sessionId: 'wizard_t', model: 'm', provider: 'p', text: 'go' });
  await until(() => runs(f) === 1);
  const outcome = page.api.cancel(it.id);
  f.release();
  const r = await outcome;
  assert.equal(r.outcome, 'started'); assert.equal(r.runId, 'run_admitted');
  assert.equal(page.api.get(it.id).state, 'sent');
});

test('a take stopped while the phone is still transcribing it is never enqueued for delivery', async t => {
  const f = await fixture(t);
  const page = client(f.origin); t.after(page.close);
  const staged = await page.api.stage({ kind: 'reply', sessionId: 'wizard_t', model: 'm', provider: 'p', audio: voice(), intent: 'auto', source: 'orb' });
  assert.equal(staged.state, 'processing');
  assert.equal((await page.api.cancel(staged.id)).outcome, 'cancelled');
  const later = await page.api.enqueue({ kind: 'reply', sessionId: 'wizard_t', custodyId: staged.id, text: 'transcript', audio: voice() });
  assert.equal(later.id, staged.id); assert.equal(later.state, 'held');
  await new Promise(r => setTimeout(r, 60));
  assert.equal(f.calls.length, 0, 'nothing reached Wizard');
});

test('composer shows Stop for a pending send without a run id; every Stop goes through cancelSend with the run id', () => {
  const line = chatsSrc.match(/const canStop = [^\n]+/)[0];
  assert.doesNotMatch(line, /working && !!s\?\.runId/, 'Stop no longer waits for the run id');
  assert.match(line, /s\.pend !== undefined/);
  const click = chatsSrc.slice(chatsSrc.indexOf("if (e.target.closest('[data-chstop]'))")).slice(0, 700);
  assert.match(click, /stopPendingSend\(w, w\.thread, s\.runId \|\| ''\)/);
  assert.match(click, /LIVE\.stop\(s\.runId\)/, 'fallback: the plain run stop is kept');
});

// The real cancelSend block from live.js, in a vm with a stub outbox and L.stop. One synthetic thread per agent kind.
const KINDS = ['main', 'host-profile', 'container', 'restricted'];
function liveCtx() {
  const body = liveSrc.slice(liveSrc.indexOf('  const STOPPABLE = '), liveSrc.indexOf('  const resync = () =>'));
  assert.ok(body.includes('L.cancelSend') && body.includes('function applyStopMarks'), 'cancelSend block found');
  const ctx = { PEND: new Map(), TAPS: new Map(), RELEASED: new Set(), CANCELLING: new Set(), Date, Promise, setTimeout,
    stopped: [], cancelled: [], items: new Map() };
  ctx.resync = () => {};
  ctx.L = { stop: async id => { ctx.stopped.push(id); }, emit() {} };
  ctx.window = { WosOutbox: { _items: ctx.items, cancel: async id => {
    ctx.cancelled.push(id); const it = ctx.items.get(id);
    if (it.admitted) { it.state = 'sent'; return { outcome: 'started', runId: it.admitted, item: it }; }
    it.state = 'held'; it.cancelled = true; return { outcome: 'cancelled', item: it };
  } } };
  vm.runInNewContext(body + '\nthis.applyStopMarks = applyStopMarks;', ctx); return ctx;
}
const item = (id, sid, agent, extra = {}) => ({ id, sessionId: sid, agent, kind: 'reply', state: 'sending', createdAt: Date.now() - 1000, ...extra });

test('main and routed threads: Stop withdraws only its own thread\'s pending send and stops only its own run', async () => {
  for (const kind of KINDS) {
    const c = liveCtx(), agent = kind === 'main' ? '' : `qa-${kind}`;
    for (const k of KINDS) {
      const a = k === 'main' ? '' : `qa-${k}`;
      c.items.set(`send-${k}`, item(`send-${k}`, `thread-${k}`, a));
      c.items.set(`late-${k}`, item(`late-${k}`, `thread-${k}`, a, { admitted: `run-${k}` }));
    }
    const r = await c.L.cancelSend(`thread-${kind}`);
    assert.equal(r.outcome, 'stopped', kind);
    assert.deepEqual([...c.cancelled].sort(), [`late-${kind}`, `send-${kind}`], `${kind}: only its own sends`);
    assert.deepEqual([...c.stopped], [`run-${kind}`], `${kind}: only its own admitted run`);
    assert.equal(c.items.get(`send-${kind}`).agent, agent);
    for (const k of KINDS.filter(k => k !== kind)) assert.equal(c.items.get(`send-${k}`).state, 'sending', `${kind} left ${k} alone`);
  }
});

test('Stop on a live run also withdraws a reply queued to steer it (main and routed)', async () => {
  for (const kind of KINDS) {
    const c = liveCtx();
    c.items.set('steer', item('steer', `thread-${kind}`, kind === 'main' ? '' : `qa-${kind}`, { steerRunId: `live-${kind}`, state: 'queued' }));
    const r = await c.L.cancelSend(`thread-${kind}`, `live-${kind}`);
    assert.equal(r.outcome, 'stopped');
    assert.deepEqual([...c.stopped], [`live-${kind}`]);
    assert.deepEqual([...c.cancelled], ['steer'], `${kind}: the queued steer never reaches the agent`);
    assert.equal(r.items.length, 1);
  }
});

test('a take still on the phone when Stop is tapped is withdrawn when it arrives, even after the tap hold expires', async () => {
  const c = liveCtx();
  c.TAPS.set('t1', { at: Date.now() - 2000 }); c.PEND.set('t1', { key: 'tap:1', runId: '', state: 'sending' });
  const r = await c.L.cancelSend('t1');
  assert.equal(r.outcome, 'cancelled'); assert.equal(c.TAPS.size, 0);
  // 90 s later (past TAP_MAX) the slow transcription hands the take over; a message typed after the Stop is untouched
  c.items.set('take', item('take', 't1', '', { state: 'queued', createdAt: Date.now() - 5000 }));
  c.items.set('fresh', item('fresh', 't1', '', { state: 'queued', createdAt: Date.now() + 60000 }));
  c.applyStopMarks(c.window.WosOutbox);
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual([...c.cancelled], ['take']);
});

test('a steer in flight when Stop is tapped and then rejected never becomes a new turn', async t => {
  const calls = []; let releaseSteer;
  const steerHeld = new Promise(r => { releaseSteer = r; });
  const server = createServer(async (req, res) => {
    for await (const _ of req) {}
    calls.push(req.url);
    const json = (s, v) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (req.url === '/wizard/hermes/v1/runs/live/steer') { await steerHeld; return json(409, { error: { code: 'run_not_accepting_steer', message: 'stopped' } }); }
    if (req.url === '/wizard/hermes/v1/runs/live') return json(200, { run_id: 'live', session_id: 'wizard_t', status: 'cancelled' });
    if (req.url === '/wizard/hermes/v1/runs') return json(202, { run_id: 'must_not_exist' });
    json(500, { error: 'unexpected' });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { releaseSteer(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const page = client(`http://127.0.0.1:${server.address().port}`); t.after(page.close);
  const it = await page.api.enqueue({ kind: 'reply', sessionId: 'wizard_t', model: 'm', provider: 'p', text: 'also do this', steerRunId: 'live' });
  await until(() => calls.includes('/wizard/hermes/v1/runs/live/steer'));
  const outcome = page.api.cancel(it.id);
  releaseSteer();
  assert.equal((await outcome).outcome, 'cancelled');
  await new Promise(r => setTimeout(r, 60));
  assert.equal(calls.filter(u => u === '/wizard/hermes/v1/runs').length, 0, 'no new turn admitted');
  assert.equal(page.api.get(it.id).state, 'held');
});
