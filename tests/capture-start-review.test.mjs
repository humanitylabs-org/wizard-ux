// Synthetic ports only: execute the complete production closure, including start, release and recovery.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../web/core/app-capture.js', import.meta.url), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function pump() { for (let i = 0; i < 160; i++) await Promise.resolve(); }
function fixture(permission = 'missing') {
  let now = 0, nextTimer = 0, nextId = 0, held = false;
  const timers = new Map(), saved = new Map(), writes = [], nativeCalls = [], events = [], deletes = [];
  let operationGate = null;
  const persist = (tx, op, value, done) => {
    const id = typeof value === 'string' ? value : value.id;
    events.push({ type: op + '-requested', id });
    const commit = () => { done(); events.push({ type: op + '-committed', id }); };
    if (operationGate?.matches(op, value)) { const gate = operationGate; operationGate = null; tx.gate = gate.promise.then(commit); }
    else commit();
  };
  let slowPut = null, nativeTruth = null, starts = 0, stops = 0, cancels = 0, recovers = 0;
  const setTimeout = (fn, ms = 0) => { const id = ++nextTimer; timers.set(id, { at: now + ms, fn }); return id; };
  const clearTimeout = id => timers.delete(id);
  const db = { transaction() {
    const tx = { objectStore(name) { if (name === 'chunks') return { index() { return { getAll() { const req = {}; queueMicrotask(() => req.onsuccess?.({ target: { result: [] } })); return req; }, openCursor() { const req = {}; queueMicrotask(() => { req.result = null; req.onsuccess?.(); }); return req; } }; } }; assert.equal(name, 'sessions'); return {
      getAll() { events.push({ type: 'sessions-read' }); const req = {}; queueMicrotask(() => req.onsuccess?.({ target: { result: structuredClone([...saved.values()]) } })); return req; },
      put(row) { const copy = structuredClone(row); writes.push(copy); const done = () => saved.set(copy.id, copy);
        if (slowPut && copy.status === 'recoverable') { const gate = slowPut; slowPut = null; tx.gate = gate.promise.then(done); } else persist(tx, 'put', copy, done); },
      delete(id) { deletes.push(id); persist(tx, 'delete', id, () => saved.delete(id)); }
    }; } };
    queueMicrotask(async () => { if (tx.gate) await tx.gate; tx.oncomplete?.(); }); return tx;
  } };
  const permissions = permission === 'missing' ? undefined : { query: permission === 'reject' ? () => Promise.reject(Error('unsupported')) : permission === 'hanging' ? () => new Promise(() => {}) : () => Promise.resolve({ state: permission }) };
  const gum = deferred();
  const navigator = { permissions, mediaDevices: { getUserMedia: () => gum.promise }, locks: {
    request(_name, _opts, cb) { if (typeof _opts === 'function') cb = _opts;
      if (held) return Promise.resolve(cb(null));
      held = true; events.push({ type: 'lock-granted' }); return Promise.resolve(cb({ name: 'synthetic-microphone' })).finally(() => { held = false; events.push({ type: 'lock-released' }); });
    }
  } };
  const context = { console, navigator, Blob, structuredClone, AbortController, queueMicrotask, IDBKeyRange: { only: value => value },
    crypto: { randomUUID: () => 'synthetic-' + (++nextId) },
    Date: class extends Date { static now() { return now; } }, setTimeout, clearTimeout,
    setInterval: setTimeout, clearInterval: clearTimeout, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    dispatchEvent(event) { events.push({ type: 'state', detail: structuredClone(event.detail) }); }, addEventListener() {},
    indexedDB: { open() { const req = {}; queueMicrotask(() => { req.result = db; req.onsuccess(); }); return req; } },
    WizardOSDevice: { recActive() { if (nativeTruth === 'malformed') return '!'; return JSON.stringify(nativeTruth); } }
  };
  context.parent = context; vm.runInNewContext(source, context, { filename: 'web/core/app-capture.js' });
  const capture = context.WizAppCapture;
  const adapter = { name: 'synthetic-native', async start(_opts, hooks) {
    starts++; nativeCalls.push('start'); return adapter.startImpl(hooks);
  }, startImpl: () => new Promise(() => {}), recover: async () => { recovers++; nativeCalls.push('recover'); return {}; }, ack() { assert.fail('no implicit acknowledgment'); } };
  capture.configureNative(adapter);
  const engine = (afterStop = null) => {
    nativeTruth = { id: 'retry-take', kind: 'app' };
    return { nativeId: 'retry-take', mime: 'audio/aac', async stop() { stops++; nativeCalls.push('stop'); nativeTruth = afterStop; }, async cancel() { cancels++; nativeTruth = afterStop; } };
  };
  return { capture, adapter, gum, permissions, saved, writes, timers, engine, nativeCalls, events, deletes,
    delayOperation(matches, gate) { operationGate = { matches, promise: gate.promise }; },
    delayPut(gate) { slowPut = gate; }, truth(value) { nativeTruth = value; },
    counts: () => ({ starts, stops, cancels, recovers }),
    async tick(ms) {
      const target = now + ms; await pump();
      for (;;) { const entry = [...timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0]; if (!entry) break;
        now = entry[1].at; timers.delete(entry[0]); entry[1].fn(); await pump(); }
      now = target; await pump();
    }
  };
}
function outcome(promise) { const out = { status: 'pending' }; promise.then(value => Object.assign(out, { status: 'resolved', value }), error => Object.assign(out, { status: 'rejected', error })); return out; }

for (const terminal of ['stop', 'cancel']) for (const custody of ['quiet', 'live', 'uncertain']) {
  test(`late reservation settles during successful retry; ${terminal}, ${custody} custody`, async () => {
    const f = fixture(); await pump();
    const first = outcome(f.capture.start('synthetic-app')); await pump();
    const gate = deferred(); f.delayPut(gate);
    await f.tick(10000);
    assert.equal(first.error?.code, 'start_timeout');
    const staleId = first.error.id;
    f.adapter.startImpl = () => f.engine(custody === 'quiet' ? null : custody === 'live' ? { id: 'other-take', kind: 'app' } : 'malformed');
    const retry = await f.capture.start('synthetic-app'); await pump();
    gate.resolve(); await pump();
    assert.equal(f.saved.get(staleId).status, 'recoverable');
    assert.equal(f.capture.current('synthetic-app').id, retry.id);
    assert.deepEqual(f.counts(), { starts: 2, stops: 0, cancels: 0, recovers: 0 });
    await retry[terminal](); await pump();
    const stale = f.saved.get(staleId);
    assert.ok(stale, 'uncertain reservation is preserved, never deleted or acknowledged');
    assert.equal(stale.status, custody === 'quiet' ? 'pending' : 'recoverable');
    assert.equal(stale.nativeId, undefined, 'no fabricated native identity');
    assert.equal(stale.partial, true);
    assert.equal(f.capture.getState().hold, custody !== 'quiet');
    assert.equal(f.capture.reloadCheck().safe, custody === 'quiet');
    assert.deepEqual(f.counts(), { starts: 2, stops: terminal === 'stop' ? 1 : 0, cancels: terminal === 'cancel' ? 1 : 0, recovers: 0 });
  });
}
for (const permission of ['missing', 'reject', 'prompt', 'hanging']) {
  test(`explicit pending permission keeps a bounded 60s window: ${permission}`, async () => {
    const f = fixture(permission); await pump();
    f.adapter.startImpl = async hooks => { hooks.stage('microphone permission'); await f.gum.promise; hooks.stage('native recorder'); return new Promise(() => {}); };
    const out = outcome(f.capture.start('synthetic-app')); await pump();
    await f.tick(10500); assert.equal(out.status, 'pending');
    await f.tick(49499); assert.equal(out.status, 'pending');
    await f.tick(501); assert.equal(out.error?.code, 'start_timeout');
    assert.equal(out.error.stage, 'microphone permission');
  });
}
for (const permission of ['granted', 'denied']) {
  test(`known ${permission} permission does not extend a hang`, async () => {
    const f = fixture(permission); await pump();
    f.adapter.startImpl = hooks => { hooks.stage('microphone permission'); return new Promise(() => {}); };
    const out = outcome(f.capture.start('synthetic-app')); await f.tick(10000);
    assert.equal(out.error?.code, 'start_timeout');
  });
}
test('permission settles before 10s; native start still has the original bound', async () => {
  const f = fixture(); await pump();
  f.adapter.startImpl = async hooks => { hooks.stage('microphone permission'); await f.gum.promise; hooks.stage('native recorder'); return new Promise(() => {}); };
  const out = outcome(f.capture.start('synthetic-app')); await f.tick(9000); f.gum.resolve(); await pump(); await f.tick(1000);
  assert.equal(out.error?.stage, 'native recorder');
});
test('native start with no permission stage is bounded at 10s', async () => {
  const f = fixture(); await pump(); const out = outcome(f.capture.start('synthetic-app')); await f.tick(10000);
  assert.equal(out.error?.stage, 'native recorder');
});
test('late permission refusal in the extended window permits an explicit retry', async () => {
  const f = fixture(); await pump();
  f.adapter.startImpl = async hooks => { hooks.stage('microphone permission'); await f.gum.promise; };
  const out = outcome(f.capture.start('synthetic-app')); await f.tick(20000);
  assert.equal(out.status, 'pending'); f.gum.reject(Object.assign(Error('synthetic refusal'), { name: 'NotAllowedError' })); await pump();
  assert.equal(out.error?.code, 'permission_denied'); assert.equal(f.capture.getState().active, false);
  f.adapter.startImpl = () => f.engine(); const retry = await f.capture.start('synthetic-app'); await pump();
  assert.equal(f.capture.current('synthetic-app').id, retry.id); await retry.stop();
});
test('permission query resolving after successful settlement cannot rearm the bound', async () => {
  const f = fixture('prompt'); await pump(); const query = deferred(); f.permissions.query = () => query.promise;
  f.adapter.startImpl = async hooks => { hooks.stage('microphone permission'); await f.gum.promise; return f.engine(); };
  const out = outcome(f.capture.start('synthetic-app')); await f.tick(10000);
  f.gum.resolve(); await pump(); assert.equal(out.status, 'resolved');
  query.resolve({ state: 'prompt' }); await pump();
  assert.equal(f.timers.size, 0, 'settled attempt must not acquire a fresh 50s timeout');
  await out.value.stop();
});
test('permission query cannot extend a stage that changed to a native hang', async () => {
  const f = fixture('prompt'); await pump(); const query = deferred(); f.permissions.query = () => query.promise;
  f.adapter.startImpl = async hooks => { hooks.stage('microphone permission'); await f.gum.promise; hooks.stage('native recorder'); return new Promise(() => {}); };
  const out = outcome(f.capture.start('synthetic-app')); await f.tick(10000); f.gum.resolve(); await pump(); query.resolve({ state: 'prompt' }); await pump();
  assert.equal(out.error?.stage, 'native recorder');
});

test('pending permission query, refusal at 10.2s, then prompt cannot rearm or abandon; explicit retry succeeds', async () => {
  const f = fixture('prompt'); await pump();
  const bootReleases = f.events.filter(e => e.type === 'lock-released').length;
  const query = deferred(); f.permissions.query = () => query.promise;
  f.adapter.startImpl = async hooks => { hooks.stage('microphone permission'); await f.gum.promise; };
  const out = outcome(f.capture.start('synthetic-app')); await f.tick(10000);
  assert.equal(out.status, 'pending');
  await f.tick(200);
  f.gum.reject(Object.assign(Error('synthetic explicit refusal'), { name: 'NotAllowedError' })); await pump();
  assert.equal(out.error?.code, 'permission_denied');
  assert.equal(f.capture.getState().active, false);
  assert.equal(f.events.filter(e => e.type === 'lock-released').length, bootReleases + 1);
  assert.equal(f.writes.length, 0, 'explicit refusal saves no abandoned native reservation');
  assert.equal(f.deletes.length, 1, 'only the ordinary refusal cleanup removes a row');
  const inventory = { events: f.events.length, writes: f.writes.length, deletes: f.deletes.length };
  query.resolve({ state: 'prompt' }); await pump();
  assert.equal(f.timers.size, 0, 'late query must not rearm a settled failed attempt');
  await f.tick(60000);
  assert.deepEqual({ events: f.events.length, writes: f.writes.length, deletes: f.deletes.length }, inventory,
    'no late reservation write/removal, cleanup/release event or recovery admission');
  f.adapter.startImpl = () => f.engine();
  const retry = await f.capture.start('synthetic-app'); await pump();
  assert.equal(f.capture.current('synthetic-app').id, retry.id);
  await retry.stop(); await pump();
  assert.equal(f.saved.get(retry.id).status, 'pending');
  assert.deepEqual(f.counts(), { starts: 2, stops: 1, cancels: 0, recovers: 0 });
});

for (const terminal of ['stop', 'cancel']) {
  test(`retry ${terminal} final transaction precedes release and stale-row recovery admission`, async () => {
    const f = fixture(); await pump();
    const first = outcome(f.capture.start('synthetic-app')); await pump();
    const staleGate = deferred(); f.delayPut(staleGate);
    await f.tick(10000); assert.equal(first.error?.code, 'start_timeout');
    const staleId = first.error.id;
    f.adapter.startImpl = () => f.engine(null);
    const retry = await f.capture.start('synthetic-app'); await pump();
    staleGate.resolve(); await pump();
    assert.equal(f.saved.get(staleId).status, 'recoverable');
    const retryBefore = structuredClone(f.saved.get(retry.id));
    assert.equal(retryBefore.status, 'recording');
    const gate = deferred();
    const op = terminal === 'stop' ? 'put' : 'delete';
    f.delayOperation((kind, value) => kind === op && (typeof value === 'string' ? value : value.id) === retry.id && (kind !== 'put' || value.status === 'pending'), gate);
    const begin = f.events.length;
    const ended = outcome(retry[terminal]()); await pump();
    const heldEvents = f.events.slice(begin);
    assert.ok(heldEvents.some(e => e.type === op + '-requested' && e.id === retry.id), 'gate reached actual final storage port');
    assert.equal(ended.status, 'pending', 'terminal awaits final transaction completion');
    assert.equal(f.capture.current('synthetic-app').id, retry.id);
    assert.deepEqual(f.saved.get(retry.id), retryBefore, 'newer take not rewritten or deleted while final transaction is held');
    assert.equal(f.saved.get(staleId).status, 'recoverable');
    assert.equal(heldEvents.filter(e => ['lock-released', 'lock-granted', 'sessions-read'].includes(e.type)).length, 0,
      'no release, recovery admission or recovery reload can precede final commit');
    assert.deepEqual(f.counts(), { starts: 2, stops: terminal === 'stop' ? 1 : 0, cancels: terminal === 'cancel' ? 1 : 0, recovers: 0 });
    gate.resolve(); await pump();
    assert.equal(ended.status, 'resolved');
    if (terminal === 'stop') assert.equal(f.saved.get(retry.id).status, 'pending');
    else assert.equal(f.saved.has(retry.id), false);
    const after = f.events.slice(begin);
    const commit = after.findIndex(e => e.type === op + '-committed' && e.id === retry.id);
    const release = after.findIndex(e => e.type === 'lock-released');
    assert.ok(commit >= 0 && release > commit, 'final commit precedes release, including on original HEAD');
    assert.equal(f.counts().recovers, 0, 'neither newer take nor ID-less reservation goes to adapter recover');
    const stale = f.saved.get(staleId);
    assert.equal(stale.status, 'pending', 'quiet native custody settles the ID-less stale reservation');
    assert.equal(stale.nativeId, undefined); assert.equal(stale.partial, true);
    const admission = after.findIndex(e => e.type === 'lock-granted');
    const reload = after.findIndex(e => e.type === 'sessions-read');
    assert.ok(admission > release && reload > admission,
      'observed causal order: final commit -> lock release -> recovery admission -> row reload');
    assert.equal(f.capture.getState().active, false);
    assert.equal(f.capture.getState().hold, false);
  });
}
