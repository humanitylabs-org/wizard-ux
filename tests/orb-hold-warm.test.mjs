// Hold-for-command speed on the phone orb (Miguel, 31 Oct 2026): a press held still opens the browser mic early, so a
// hold that becomes a command (or a slow tap that becomes a message) records at once instead of after the iPhone's
// getUserMedia. Tap and hold keep their meaning and timing (James's rule: tap = message; the 380 ms hold is unchanged).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withAppParts } from './fixtures/app-parts.mjs';
import { orbHold } from './fixtures/r8B-orbhold.mjs';

const app = withAppParts(readFileSync(new URL('../web/app.js', import.meta.url), 'utf8'));
const between = (a, b) => { const i = app.indexOf(a), j = app.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, a); return app.slice(i, j); };

function world({ granted = true, native = false, state = 'idle', capture = null } = {}) {
  const log = [];
  const track = n => ({ stop() { log.push('stop:' + n); } });
  let n = 0, pending = [];
  const ctx = vm.createContext({
    V: { state }, DEV: () => (native ? {} : null), window: { MediaRecorder: function () {}, WizAppCapture: { getState: () => capture } }, log,
    navigator: { mediaDevices: { getUserMedia: () => { const id = ++n; log.push('gum:' + id); return new Promise(r => pending.push(() => r({ id, getTracks: () => [track(id)] }))); } } },
    browserMicIsExternal: async () => false, Promise, Error,
  });
  vm.runInContext(between('  async function openMic() {', '  async function openRec(').replace(/try \{ navigator\.permissions[^\n]*\n/, '') + `\nmicGranted = ${granted};\nthis.api = { warmMic, takeWarm, dropWarm, get MW() { return MW; } };`, ctx);
  return { api: ctx.api, log, resolve: async () => { for (const f of pending.splice(0)) f(); await new Promise(r => setImmediate(r)); } };
}

test('a still press warms the mic once; the take that starts takes that stream (no second getUserMedia)', async () => {
  const w = world();
  w.api.warmMic(); w.api.warmMic();
  assert.deepEqual(w.log, ['gum:1'], 'one request per press');
  const p = w.api.takeWarm(); assert.ok(p, 'the take gets the warm stream');
  assert.equal(w.api.takeWarm(), null, 'only once');
  w.api.dropWarm(); await w.resolve();
  assert.equal((await p).id, 1); assert.ok(!w.log.includes('stop:1'), 'a taken stream is never stopped by the press ending');
});

test('a press that ends without a take (swipe, cancel) closes the warm mic', async () => {
  const w = world();
  w.api.warmMic(); w.api.dropWarm(); await w.resolve();
  assert.deepEqual(w.log, ['gum:1', 'stop:1']);
});

test('never a permission prompt, never with the native recorder, never during a take', () => {
  for (const opt of [{ granted: false }, { native: true }, { state: 'listen' }]) {
    const w = world(opt); w.api.warmMic();
    assert.deepEqual(w.log, [], JSON.stringify(opt)); assert.equal(w.api.takeWarm(), null);
  }
});

// Runs the real dock orb press (app-orbswipe.js) with the real warm mic (app-mic.js), fake clock and getUserMedia
// (tests/fixtures/r8B-orbhold.mjs).
test('wired into the dock orb: warm after a still moment, dropped when the press ends, taken by openRec; tap/hold unchanged', async () => {
  assert.equal((await orbHold()).mic.MIC_WARM_MS, 90);
  // a still press: no mic before the still moment, one request at it
  const tap = await orbHold();
  tap.down(); await tap.advance(89); assert.deepEqual(tap.log, [], 'not before the still moment');
  await tap.advance(1); assert.deepEqual(tap.log, ['gum:1'], 'warm after a still moment');
  // the slow tap: still a message, and its take claims the warm stream before the press's microtask drops it
  tap.up(); await tap.settle(); await tap.settle();
  assert.deepEqual(tap.takes, ['tap'], 'a tap is a message');
  assert.deepEqual(tap.log, ['gum:1'], 'the take took the warm stream: no second getUserMedia, never stopped');
  assert.equal(tap.V.stream?.id, 1);
  assert.deepEqual(tap.calls.filter(c => c[0] === 'Orb.press').map(c => c[1]), [true, false], 'the orb\'s pressed look ends with the press');
  // a press that ends without a take (pointer cancelled): the warm mic is dropped
  const gone = await orbHold();
  gone.down(); await gone.advance(120); gone.cancel(); await gone.settle();
  assert.deepEqual(gone.log, ['gum:1', 'stop:1']); assert.deepEqual(gone.takes, []);
  // the hold: still 380 ms, then a command, which records on the stream warmed meanwhile
  const hold = await orbHold();
  hold.down(); await hold.advance(379); assert.deepEqual(hold.takes, [], 'no command before 380 ms');
  await hold.advance(1); assert.deepEqual(hold.takes, ['command'], 'a 380 ms hold is a command');
  hold.up(); await hold.settle();
  assert.deepEqual(hold.log, ['gum:1'], 'the command took the warm stream'); assert.equal(hold.V.stream?.id, 1);
  // a quick tap: no warm-up at all, the take opens its own mic as before
  const quick = await orbHold();
  quick.down(); await quick.advance(50); assert.deepEqual(quick.log, []);
  quick.up(); await quick.settle(); assert.deepEqual(quick.takes, ['tap']); assert.deepEqual(quick.log, ['gum:1']);
  // a layout's own orb tap still wins the tap, and the warm stream is released
  const own = await orbHold({ orbTap: true });
  own.down(); await own.advance(100); own.up(); await own.settle();
  assert.deepEqual(own.takes, []); assert.deepEqual(own.log, ['gum:1', 'stop:1']);
});

test('never while an app or meeting holds the mic (startVoice hands it over first): no second stream', () => {
  for (const capture of [{ active: true }, { recording: true }, { hold: true }]) {
    const w = world({ capture }); w.api.warmMic();
    assert.deepEqual(w.log, [], JSON.stringify(capture)); assert.equal(w.api.takeWarm(), null);
  }
  const free = world({ capture: { active: false } }); free.api.warmMic(); assert.deepEqual(free.log, ['gum:1'], 'an idle capture state still warms');
});
