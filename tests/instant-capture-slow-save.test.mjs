// ux#1503: a 2:45 Messenger voice note showed "On-device saving failed (timeout)" because one slow IndexedDB
// write was treated as a hard failure. Instant takes now retry a passing failure with backoff, quietly, and
// Stop never waits on that backoff: the take still hands off (from memory if the store stays broken).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import { block } from './fixtures/source-slice.mjs';
const source = readFileSync(new URL('../web/core/app-capture.js', import.meta.url), 'utf8');
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function load(from, to, c) { const a = source.indexOf(from), b = source.indexOf(to, a); assert.ok(a >= 0 && b > a, from); vm.runInContext(source.slice(a, b), c); }
const failure = detail => Object.assign(Error('synthetic-private'), {detail});
// fast: retry waits are shortened 100x (and recorded) so a test can walk the whole backoff quickly.
function fixture({write, fast = false} = {}) {
  const saved = [], sessions = new Map(), warns = [], waits = [];
  let tries = 0;
  const timer = fast ? (fn, ms) => { if ([500, 1500, 3000, 6000].includes(ms)) { waits.push(ms); ms = ms / 100; } return setTimeout(fn, ms); } : setTimeout;
  const c = vm.createContext({Blob, Date, Math, Promise, Map, Set, structuredClone, setTimeout: timer, clearTimeout, clearInterval,
    fail: (code, message, extra) => Object.assign(Error(message), {code}, extra), MAX_CHUNK: 1024, ownedRows: new Map(), recoveryLive: new Set(), memoryTakes: new Map(), active: null,
    changed() {}, safeCall: fn => fn?.(), emit: (s, kind, msg) => { if (kind === 'warn') warns.push(msg); }, channel: null,
    transaction: async (stores, mode, work) => {
      if (mode === 'readwrite') { tries++; const outcome = write(tries); if (outcome === 'hang') return new Promise(() => {}); if (outcome) throw outcome; }
      return work({objectStore: name => ({put: r => { if (name === 'chunks') saved.push(r); else sessions.set(r.id, r); }})});
    },
    put: async row => { sessions.set(row.id, row); },
    result: async row => ({id: row.id, blob: new Blob(saved.map(p => p.blob), {type: row.mime}), mime: row.mime, durationMs: row.durationMs}),
    remove: async id => { sessions.delete(id); },
  });
  load('  function storageFailure(', '  function openDB()', c);
  load('  function wav(', '  async function result(', c);
  load('  function enqueue(', '  function emit(', c);
  const s = {instant: true, row: {id: 'synthetic', appId: 'messenger', kind: 'audio', seq: 0, bytes: 0, mime: 'audio/webm;codecs=opus', startedAt: Date.now() - 2000, meta: {}},
    opts: {}, limit: 1e9, queue: [], writes: Promise.resolve(), levels: new Set(), offs: [], phase: 'recording',
    stream: {getTracks: () => [{stop() {}}]}, unlock() {}, engine: {async stop() { return {blob: new Blob(['C']), durationMs: 2345}; }, async cancel() {}}};
  c.active = s;
  return {c, s, saved, warns, waits, get tries() { return tries; },
    enqueue: async text => { c.enqueue(s, new Blob([text])); await tick(); },
    settle: () => s.writes.then(() => s.drainPromise)};
}

test('a slow chunk write (timeout twice) retries quietly with backoff and the take stays durable', async () => {
  const f = fixture({fast: true, write: n => n <= 2 ? failure('timeout') : null});
  await f.enqueue('A'); await f.settle();
  assert.deepEqual(f.waits, [500, 1500]);
  assert.equal(f.saved.length, 1); assert.equal(f.s.error, null); assert.deepEqual(f.warns, []);
  await f.enqueue('B');
  const out = await f.c.finish(f.s);
  assert.equal(await out.blob.text(), 'ABC'); assert.equal(out.durable, undefined); assert.deepEqual(f.warns, []);
});

for (const detail of ['timeout', 'blocked', 'UnknownError', 'InvalidStateError', 'AbortError'])
  test('passing failure ' + detail + ' is retried before any warning', async () => {
    const f = fixture({fast: true, write: n => n === 1 ? failure(detail) : null});
    await f.enqueue('A'); await f.settle();
    assert.equal(f.tries, 2); assert.equal(f.saved.length, 1); assert.deepEqual(f.warns, []);
  });

test('quota failure is not retried, and shows no notice: Send still hands the take over from memory', async () => {
  const f = fixture({fast: true, write: () => Object.assign(Error('private'), {name: 'QuotaExceededError'})});
  await f.enqueue('A'); await f.settle();
  assert.equal(f.tries, 1); assert.deepEqual(f.waits, []); assert.deepEqual(f.warns, []);
  const out = await f.c.finish(f.s);
  assert.equal(await out.blob.text(), 'AC'); assert.equal(out.durable, false);
});

// ux#1503 reopen (James's phone, 18 Nov): the store kept timing out past the whole backoff and the warning still
// showed. The on-device copy is only a backup for an instant take, so a store that stays broken says nothing.
test('a store that stays broken retries the whole backoff (well beyond 1.5 s), shows no notice, and Send works from memory', async () => {
  const f = fixture({fast: true, write: () => failure('timeout')});
  await f.enqueue('A'); await f.settle();
  assert.deepEqual(f.waits, [500, 1500, 3000, 6000]);
  assert.ok(f.waits.reduce((a, b) => a + b) > 1500 * 5);
  assert.equal(f.tries, 5); assert.deepEqual(f.warns, []);
  const out = await f.c.finish(f.s);
  assert.equal(await out.blob.text(), 'AC'); assert.equal(out.durable, false); assert.equal(f.c.active, null);
});

test('Stop during a backoff wait does not wait it out: one last try, then the take hands off from memory, no warning', async () => {
  const f = fixture({write: () => failure('UnknownError')}); // real timers: the first wait is 500 ms, the rest 10.5 s
  await f.enqueue('A'); await f.enqueue('B');
  assert.equal(f.tries, 1); assert.ok(f.s.retryWake, 'a retry is waiting');
  const before = Date.now();
  const out = await f.c.finish(f.s);
  assert.ok(Date.now() - before < 400, 'Stop must not wait for the backoff');
  assert.equal(await out.blob.text(), 'ABC'); assert.equal(out.durable, false); assert.equal(out.storageError, 'UnknownError');
  assert.ok(f.tries >= 2, 'tried again at Stop'); assert.equal(f.s.retryWake, null); assert.deepEqual(f.warns, []); assert.equal(f.c.active, null);
  assert.equal(f.c.memoryTakes.has('synthetic'), true, 'kept for the app to send and ack');
});

test('a delayed write that lands during the retry still hands off a durable take on Stop', async () => {
  const f = fixture({write: n => n === 1 ? failure('timeout') : null});
  await f.enqueue('A');
  const out = await f.c.finish(f.s); // wakes the waiting retry, which now succeeds
  assert.equal(await out.blob.text(), 'AC'); assert.equal(out.durable, undefined); assert.deepEqual(f.warns, []);
});

test('Discard during a backoff wait stops retrying', async () => {
  const f = fixture({fast: true, write: () => failure('timeout')});
  await f.enqueue('A');
  await f.c.cancelSession(f.s); await f.settle().catch(() => {});
  await new Promise(r => setTimeout(r, 120));
  assert.ok(f.tries <= 2, 'no retries after Discard'); assert.deepEqual(f.warns, []);
});

// The real first-row save of an instant take (the s.persistence block of start()), run in the fixture's context with
// the real patiently(): openDB and put are stand-ins that fail the way a slow IndexedDB does.
async function firstRowSave(f, { opens: failOpens = 0, never = false } = {}) {
  const at = source.indexOf('        s.persistence = (async () => {');
  const code = source.slice(at, source.indexOf('        })();', at) + '        })();'.length);
  const seen = { opens: 0, puts: 0, drains: 0 };
  Object.assign(f.c, { s: f.s, openDB: async () => { seen.opens++; if (never || seen.opens <= failOpens) throw failure('timeout'); },
    drain: async () => { seen.drains++; }, changed() {} });
  f.c.put = async () => { seen.puts++; };
  f.s.persistencePending = true;
  vm.runInContext(code, f.c); await f.s.persistence; await f.s.writes;
  return seen;
}
test('the first-row save of an instant take (openDB + put) goes through the same quiet retry', async () => {
  const f = fixture({fast: true, write: () => null});
  const seen = await firstRowSave(f, { opens: 2 });
  assert.deepEqual(seen, { opens: 3, puts: 1, drains: 1 }, 'openDB is retried, then the row is put once and the chunks drain');
  assert.deepEqual(f.waits, [500, 1500], 'the same backoff as a chunk write');
  assert.equal(f.s.error, undefined); assert.equal(f.s.persistencePending, false); assert.deepEqual(f.warns, []);
});

test('no instant-take storage failure anywhere emits the old notice, and getInfo carries no storage warning', async () => {
  assert.doesNotMatch(source, /'On-device saving failed/);
  // a store that never opens: the take keeps going from memory, quietly
  const f = fixture({fast: true, write: () => failure('timeout')});
  const seen = await firstRowSave(f, { never: true });
  assert.equal(seen.puts, 0); assert.equal(f.s.error?.code, 'storage_failed'); assert.deepEqual(f.warns, [], 'no notice');
  await f.enqueue('A'); await f.settle(); assert.deepEqual(f.warns, []);
  // the real session(): getInfo reports the code but no warning text for an instant take; other takes keep it
  vm.runInContext(block(source, '  function session(s) {'), Object.assign(f.c, { capabilities: () => ({}) }));
  const info = f.c.session(f.s).getInfo();
  assert.equal(info.error, 'storage_failed'); assert.equal(info.warning, null);
  const slow = { ...f.s, instant: false, error: f.s.error };
  assert.match(f.c.session(slow).getInfo().warning, /On-device audio storage failed/);
});

test('a long take (36 chunks, about 3 minutes) on a store that never works sends every piece from memory with no notice', async () => {
  const f = fixture({fast: true, write: () => failure('timeout')});
  let text = '';
  for (let i = 0; i < 36; i++) { const t = String.fromCharCode(65 + (i % 26)); text += t; await f.enqueue(t); }
  await f.settle();
  const out = await f.c.finish(f.s);
  assert.equal(await out.blob.text(), text + 'C'); assert.equal(out.durable, false); assert.deepEqual(f.warns, []);
});

test('slow openDB then put: patiently retries the whole first-row save', async () => {
  const f = fixture({fast: true, write: () => null});
  let opens = 0, puts = 0;
  const openDB = async () => { opens++; if (opens < 3) throw failure('timeout'); };
  await f.c.patiently(f.s, async () => { await openDB(); puts++; });
  assert.equal(opens, 3); assert.equal(puts, 1); assert.deepEqual(f.waits, [500, 1500]);
});
