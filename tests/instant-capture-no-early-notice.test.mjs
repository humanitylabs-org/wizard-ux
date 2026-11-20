// ux#1553: every Messenger voice note on a slow phone showed "Recording is kept in memory while saving catches up"
// about one second in, because start() armed a 1 s notice while patiently() (ux#1503) was still quietly retrying the
// first row save. A slow-but-healthy store now says nothing, and since the ux#1503 reopen a broken one says nothing either.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../web/core/app-capture.js', import.meta.url), 'utf8');
function slice(from, to) { const a = source.indexOf(from), b = source.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return source.slice(a, b); }
const failure = detail => Object.assign(Error('synthetic-private'), {detail});

// Runs the real instant-take persistence block of start() with every timer 100x faster, so "3 s" is 30 ms and the
// old 1 s notice would be 10 ms.
async function run(putOutcome) {
  const warns = [];
  let tries = 0;
  const fast = (fn, ms) => setTimeout(fn, ms / 100);
  const c = vm.createContext({Promise, Error, setTimeout: fast, clearTimeout,
    fail: (code, message, extra) => Object.assign(Error(message), {code}, extra),
    emit: (s, kind, msg) => { if (kind === 'warn') warns.push(msg); }, changed() {},
    openDB: async () => {},
    put: () => { tries++; return putOutcome(tries); },
    drain: async () => {}});
  vm.runInContext(slice('  function storageFailure(', '  function openDB()'), c);
  vm.runInContext(slice('  const SAVE_RETRY_MS =', '  function drain('), c);
  const block = slice('      if (s.instant) {\n        s.persistencePending = true;', '      if (s.interrupted)');
  vm.runInContext('async function persist(s) {\n' + block + '\n  await s.persistence;\n}', c);
  const s = {instant: true, row: {id: 'synthetic'}, phase: 'recording', writes: Promise.resolve()};
  await c.persist(s);
  return {warns, tries, s};
}

test('a first save that takes 3 s shows no notice at all', async () => {
  const r = await run(() => new Promise(resolve => setTimeout(resolve, 30)));
  assert.equal(r.tries, 1);
  assert.deepEqual(r.warns, []);
  assert.equal(r.s.persistencePending, false);
});

test('a first save that is retried quietly and then lands shows no notice', async () => {
  const r = await run(n => n <= 2 ? Promise.reject(failure('timeout')) : Promise.resolve());
  assert.equal(r.tries, 3);
  assert.deepEqual(r.warns, []);
});

// ux#1503 reopen: the take is in memory and hands off from there, so even a first save that keeps failing is quiet.
test('a first save that keeps failing shows no notice; the failure is kept for the hand-off', async () => {
  const r = await run(() => Promise.reject(failure('timeout')));
  assert.equal(r.tries, 5);
  assert.deepEqual(r.warns, []);
  assert.equal(r.s.error.detail, 'timeout');
});
