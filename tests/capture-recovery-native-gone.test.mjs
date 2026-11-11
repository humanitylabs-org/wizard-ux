// Issue 1231: on a phone, web capture recovery ended with UnknownError on every launch and never settled the
// native takes it had claimed. A take whose audio is no longer on the phone must settle (pending, partial) so the
// app can offer and acknowledge it, and a recorder failure must name its own code in the diagnostics report.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const source = readFileSync(new URL('../web/core/app-capture.js', import.meta.url), 'utf8');
function extract(from, to, ctx) {
  const a = source.indexOf(from), b = source.indexOf(to, a); assert.ok(a >= 0 && b > a, from);
  vm.runInNewContext(source.slice(a, b), ctx); return ctx;
}
const fail = (code, message, extra) => Object.assign(Error(message), {code}, extra);
// A fake WizardOSDevice: `takes` maps native id -> {meta, audio} (audio: Uint8Array, or null when the file is gone).
function device(takes) {
  const acked = [];
  return {acked, recActive: () => 'null',
    recClaim: id => { const t = takes[id]; if (!t?.meta) return 'null'; return JSON.stringify({...t.meta, bytes: t.audio ? t.audio.length : 0}); },
    recStop: () => 'null',
    recRead: (id, off) => { const t = takes[id]; if (!t?.audio) return 'null';
      return JSON.stringify({b64: Buffer.from(t.audio.subarray(off)).toString('base64'), next: -1, size: t.audio.length}); },
    // The phone's positive "no file" answer (Files.notExists); `io` marks a take whose disk read is failing.
    recAudioGone: id => !takes[id]?.audio && !takes[id]?.io,
    recDone: id => { acked.push(id); delete takes[id]; }};
}
function adapterFor(d) {
  const c = extract('  function deviceAdapter(', '  function meetingAdapter(', {fail, Blob, atob, JSON, Number, Uint8Array, Promise, setTimeout});
  return c.deviceAdapter(d);
}
function recovery(rows, d) {
  let all = rows.map(r => ({...r}));
  const c = {active: null, ownedRows: new Map(), recoveryLive: new Set(), ownershipLoaded: false, unknownMeetingActive: false, recoveryError: null,
    rows: async () => all.map(r => ({...r})), changed() {}, meetingBridge: () => null, W: {WizardOSDevice: d},
    put: async r => { all = all.filter(x => x.id !== r.id).concat({...r}); c.ownedRows.set(r.id, r); },
    adapter: () => adapterFor(d), DEFAULT_LIMIT: 1 << 20, MAX_CHUNK: 1 << 20,
    enqueue: (s, blob) => { s.row = {...s.row, bytes: (s.row.bytes || 0) + blob.size, seq: (s.row.seq || 0) + 1}; },
    fail, crypto: {randomUUID}, Date, JSON};
  extract('  async function recoverLocked(', '  async function recover()', c);
  return {c, get all() { return all; }};
}
const row = (id, nativeId, extra = {}) => ({id, appId: 'messenger', kind: 'audio', native: 'wizard-device', nativeId, status: 'recoverable', bytes: 0, seq: 0, meta: {}, ...extra});

test('a claimed take whose audio is gone settles as pending instead of failing every launch', async () => {
  const d = device({n1: {meta: {id: 'n1', ms: 4000, state: 'claimed'}, audio: null}, n2: {meta: null, audio: null}});
  const f = recovery([row('a', 'n1'), row('b', 'n2')], d);
  await f.c.recoverLocked({});
  assert.equal(f.c.recoveryError, null);
  for (const r of f.all) { assert.equal(r.status, 'pending', r.id); assert.equal(r.partial, true); }
  assert.equal(f.all.find(r => r.id === 'a').durationMs, 4000);
  // A second launch has nothing left to retry.
  await f.c.recoverLocked({}); assert.equal(f.c.recoveryError, null);
});
test('a take that still has audio is read as before, and audio without metadata is never dropped', async () => {
  const audio = new Uint8Array([1, 2, 3, 4]);
  const d = device({n1: {meta: {id: 'n1', ms: 1000}, audio}, n2: {meta: null, audio}});
  const f = recovery([row('a', 'n1'), row('b', 'n2')], d);
  await f.c.recoverLocked({});
  const a = f.all.find(r => r.id === 'a'), b = f.all.find(r => r.id === 'b');
  assert.equal(a.status, 'pending'); assert.equal(a.bytes, 4); assert.equal(a.rescueComplete, true);
  assert.equal(b.status, 'recoverable'); assert.equal(b.recoveryError, 'native_claim_pending');
  assert.equal(f.c.recoveryError.code, 'native_claim_pending');
});
test('a failing read is never taken for a missing take, and an older app keeps retrying', async () => {
  const d = device({n1: {meta: null, audio: null, io: true}, n2: {meta: {id: 'n2', ms: 1}, audio: null, io: true}});
  const f = recovery([row('a', 'n1'), row('b', 'n2')], d);
  await f.c.recoverLocked({});
  for (const r of f.all) assert.equal(r.status, 'recoverable', r.id);
  const old = device({n3: {meta: null, audio: null}}); delete old.recAudioGone;
  const g = recovery([row('c', 'n3')], old);
  await g.c.recoverLocked({});
  assert.equal(g.all[0].status, 'recoverable'); assert.equal(g.c.recoveryError.code, 'native_claim_pending');
});
test('a live native take is never settled', async () => {
  const d = device({}); d.recActive = () => JSON.stringify({id: 'n1'});
  assert.deepEqual({...await adapterFor(d).recover(row('a', 'n1'))}, {live: true});
});
test('recovery diagnostics name the recorder code instead of UnknownError', async () => {
  const sent = [];
  const c = {W: {WizardOSNative: {platform: () => 'android:0.10.39'}, fetch: async (p, o) => { sent.push(JSON.parse(o.body)); return {ok: true}; }},
    DB_NAME: 'wizard-app-capture-v1', LOCK: 'x', navigator: {userAgent: 'SM-S938B'}, Date, Promise, Set, AbortSignal, setTimeout, clearTimeout, fail};
  extract('  function storageFailure(', '  function openDB()', c);
  c.storageDiagnostic('recovery', fail('native_read_failed', 'private words'), Date.now(), {phase: 'complete', sessionCount: 3});
  c.storageDiagnostic('recovery', {name: 'UnknownError', code: 'native_x'}, Date.now(), {phase: 'rows'});
  c.storageDiagnostic('recovery', fail('recovery_timeout', 'x', {detail: 'timeout'}), Date.now(), {phase: 'native_recover'});
  c.storageDiagnostic('recovery', fail('Bad Code!', 'x'), Date.now(), {phase: 'save'});
  await new Promise(r => setTimeout(r, 350));
  const codes = sent.map(p => p.events[0].data.result.code);
  assert.deepEqual(codes, ['native_read_failed', 'UnknownError', 'timeout', 'UnknownError']);
  assert.doesNotMatch(JSON.stringify(sent), /private words/);
});
