// Hold-for-command speed on the phone orb (Miguel, 31 Oct 2026): a press held still opens the browser mic early, so a
// hold that becomes a command (or a slow tap that becomes a message) records at once instead of after the iPhone's
// getUserMedia. Tap and hold keep their meaning and timing (James's rule: tap = message; the 380 ms hold is unchanged).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const between = (a, b) => { const i = app.indexOf(a), j = app.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, a); return app.slice(i, j); };

function world({ granted = true, native = false, state = 'idle' } = {}) {
  const log = [];
  const track = n => ({ stop() { log.push('stop:' + n); } });
  let n = 0, pending = [];
  const ctx = vm.createContext({
    V: { state }, DEV: () => (native ? {} : null), window: { MediaRecorder: function () {} }, log,
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

test('wired into the dock orb: warm after a still moment, dropped when the press ends, taken by openRec; tap/hold unchanged', () => {
  assert.match(app, /const MIC_WARM_MS = 90;/);
  assert.match(app, /if \(V\.state === 'idle'\) G\.warm = setTimeout\(\(\) => \{ if \(G && G\.mode === 'pending'\) warmMic\(\); \}, MIC_WARM_MS\);\n    if \(mayHoldCommand\(\)\) G\.hold = setTimeout\(/);
  assert.match(app, /clearTimeout\(g\.hold\); clearTimeout\(g\.warm\); queueMicrotask\(dropWarm\);/);
  assert.match(app, /const stream = await \(takeWarm\(\) \|\| openMic\(\)\);/);
  // the hold threshold and the tap rule stay as they were
  assert.match(app, /G\.start=startVoice\('command'\);\}else\{G\.refused=true;toast\('⏸','Pause your reply before a command'\);\} \} \}, 380\);/);
  assert.match(app, /if \(V\.state === 'idle'\) return window\.WosSkinHost\?\.orbTap\?\.\(\) \? undefined : startOrbVoice\(\);/);
  // the take takes the warm stream synchronously (openRec's first await), before the press's microtask drops it
  const open = between('  async function openRec(', '  function onRecInterrupted(');
  assert.equal(open.indexOf('await'), open.indexOf('await (takeWarm() || openMic())'), 'nothing is awaited before the take claims the warm stream');
});
