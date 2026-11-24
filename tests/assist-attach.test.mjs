// Camera and Attach on the side-button corner orb (wizard-os issue 655, switch wizard/assist-attach, off by default).
// The corner orb is the Android app's own page, so the shell copies the switch to native; the real android-relay.js
// runs here in a vm with a stand-in native bridge. The rest checks that the switch, the orb page and the Android
// wiring stay in step (the native rules themselves are JVM tests: android/app/src/test/.../AttachPolicyTest.java).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { java, method } from './fixtures/s1-java-slice.mjs';
import { readFileSync } from 'node:fs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { between } from './fixtures/source-slice.mjs';
import { lookBox } from './fixtures/r5A-experience.mjs';
import { manifest } from './fixtures/r8C-manifest.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SWITCH = 'wizard/assist-attach';

function fixture({ on = false, native = true } = {}) {
  const calls = [], timers = [], observers = [], winListeners = {};
  const root = { dataset: { tweaks: on ? 'wizard/desktop-chats ' + SWITCH : 'wizard/desktop-chats' } };
  const c = { URL, console, JSON, Date, location: new URL('https://wizard.example/wizard-os-home/'),
    document: { readyState: 'complete', hidden: false, documentElement: root, body: { appendChild() {} }, querySelectorAll: () => [],
      createElement: () => ({}), getElementById: () => null, addEventListener() {} },
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe(t, o) { this.t = t; this.o = o; } },
    navigator: {}, dispatchEvent() {}, CustomEvent: class {},
    setInterval() {}, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    addEventListener: (n, f) => (winListeners[n] ||= []).push(f) };
  if (native) c.WizardOSNative = { assistAttachSwitch: v => calls.push(v) };
  c.window = c; vm.createContext(c);
  vm.runInContext(read('web/core/android-relay.js'), c);
  const flip = v => { root.dataset.tweaks = v ? 'wizard/desktop-chats ' + SWITCH : 'wizard/desktop-chats'; for (const o of observers) o.fn([]); };
  const settle = () => { for (const t of timers.filter(t => t.ms === 5000)) t.fn(); };
  const experience = () => { for (const f of winListeners['wos:experience'] || []) f(); };
  return { calls, flip, settle, experience };
}

test('off by default: nothing is sent to the Android app before the switches settle, then one off', () => {
  const f = fixture();
  assert.deepEqual(f.calls, []);
  f.settle();
  assert.deepEqual(f.calls, [false]);
  f.experience(); f.settle();
  assert.deepEqual(f.calls, [false], 'the same state is never sent twice');
});

test('on: the Android app hears it at once, and turning it off later reaches it too', () => {
  const f = fixture({ on: true });
  assert.deepEqual(f.calls, [true]);
  f.flip(false);
  assert.deepEqual(f.calls, [true], 'an off waits for the switches to settle');
  f.experience();
  assert.deepEqual(f.calls, [true, false]);
  f.flip(true);
  assert.deepEqual(f.calls, [true, false, true]);
});

test('a browser or an older APK without the bridge is left alone', () => {
  const f = fixture({ on: true, native: false });
  f.settle(); f.flip(false); f.experience();
  assert.deepEqual(f.calls, []);
});

test('the switch is in the catalog and off by default', async () => {
  // The real Settings › Look switch list (core/experience.js) on the real catalog: listed, off, not loaded, not promoted.
  const box = await lookBox();
  const row = box.row(SWITCH);
  assert.ok(row, 'Settings › Look lists the switch');
  assert.equal(row.on, false, 'a fresh device has it off');
  assert.match(row.description, /lock screen/);
  assert.ok(!box.active().includes(SWITCH), 'and never loads it');
  assert.ok(!box.E.promotedDefaults.includes(SWITCH));
});

test('the corner orb shows Camera and Attach only when native says the switch is on, and never on the lock screen', () => {
  const html = read('android/app/src/main/assets/assist/surface.html');
  // The real orb page: its stylesheet, its buttons, canAttach() and the two click handlers, run on a mini-dom.
  const css = between(html, '<style>', '</style>').slice(7);
  const doc = createDocument(); doc.body.innerHTML = between(html, '<button class="chip" id="camC"', '<b id="pickN">') + '</b></button>';
  const asks = [], N = { attachOn: () => N.on, camera: () => asks.push('camera'), pick: () => asks.push('pick'), on: true };
  const ctx = { document: doc, N, S: { state: 'listen' }, $: id => doc.getElementById(id), setTimeout: () => 0 };
  vm.createContext(ctx);
  vm.runInContext(`var MODE='full';\n${between(html, 'function canAttach()', '/* ---------- called by native')}\n${between(html, "$('camC').addEventListener", "\n", 0)}\n${between(html, "$('pickC').addEventListener", "\n")}`, ctx);
  const shown = () => ['camC', 'pickC'].map(id => cascade(doc.getElementById(id), css).display.value);
  doc.body.classList.add('corner');
  assert.equal(vm.runInContext('canAttach()', ctx), false, 'full-screen orb: never');
  vm.runInContext("MODE='corner'", ctx);
  N.on = false; assert.equal(vm.runInContext('canAttach()', ctx), false); assert.deepEqual(shown(), ['none', 'none'], 'switch off: hidden');
  N.on = true; assert.equal(vm.runInContext('canAttach()', ctx), true); assert.deepEqual(shown(), ['flex', 'flex'], 'switch on in the corner: shown');
  delete N.attachOn; assert.equal(vm.runInContext('canAttach()', ctx), false, 'an older APK without attachOn: hidden'); assert.deepEqual(shown(), ['none', 'none']);
  N.attachOn = () => { throw new Error('gone'); }; assert.equal(vm.runInContext('canAttach()', ctx), false);
  doc.getElementById('camC').dispatchEvent({ type: 'click', bubbles: true }); doc.getElementById('pickC').dispatchEvent({ type: 'click', bubbles: true });
  assert.deepEqual(asks, ['camera', 'pick'], 'while listening the buttons ask native');
  ctx.S.state = 'think'; doc.getElementById('camC').dispatchEvent({ type: 'click', bubbles: true }); doc.getElementById('pickC').dispatchEvent({ type: 'click', bubbles: true });
  assert.deepEqual(asks, ['camera', 'pick'], 'never outside a take');
  // (the hide/show rules, canAttach() and the listen-only click handlers: run and cascaded above)
  const lock = read('android/app/src/main/java/ai/wizards/os/assist/AssistLockActivity.java');
  assert.ok(!/attachOn|camera\(\)|AssistPickActivity/.test(lock), 'the lock-screen surface has no Camera/Attach bridge');
  // the real WizardSession methods, run with stand-ins: the bridge, the picker and dismissal obey the switch and the lock
  const session = java('assist/WizardSession.java');
  const world = (on, locked, take = {}) => {
    const log = [];
    const capture = { listening: () => take.listening ?? true, away: () => take.away ?? false, attachedCount: () => 0, attachCap: () => 10,
      beginAway: () => { log.push('away'); return true; }, finishOnDismiss: why => log.push('finish:' + why), detach() {}, noteDismissed() {}, pickDone() {} };
    const scope = { capture, shotPending: false, AssistAttach: { on: c => { assert.equal(c, 'ctx'); return on; } }, getContext: () => 'ctx',
      keyguard: { isKeyguardLocked: () => locked }, startAssistantActivity: () => log.push('picker'), AssistPickActivity: { intent: (c, k) => k } };
    return { log, scope };
  };
  for (const [on, locked] of [[false, false], [true, false], [false, true], [true, true]]) {
    const w = world(on, locked);
    assert.equal(method(session, 'public boolean attachOn()', { scope: w.scope }).value, on && !locked, `attachOn on=${on} locked=${locked}`);
    method(session, 'private void openPick(String kind)', { args: { kind: 'camera' }, scope: w.scope });
    assert.deepEqual(w.log, on && !locked ? ['away', 'picker'] : [], `openPick on=${on} locked=${locked}`);
  }
  const hide = take => { const w = world(true, false, take); method(session, 'public void onHide()', { scope: w.scope, base: class { onHide() {} } }); return w.log; };
  assert.deepEqual(hide({ away: true }), [], 'opening the camera never ends the take');
  assert.deepEqual(hide({ away: false }), ['finish:dismiss'], 'a real dismissal still sends the take');
  assert.deepEqual(hide({ listening: false }), []);
});

// static-rule: AndroidManifest.xml is declarative config: exported=false and the missing permission are the behaviour
test('the picker step and the camera file are private to WizardOS', () => {
  const m = manifest();
  const pick = m.find(e => e.tag === 'activity' && e.attrs['android:name'] === '.assist.AssistPickActivity');
  assert.equal(pick?.attrs['android:exported'], 'false');
  const cam = m.find(e => e.tag === 'provider' && e.attrs['android:name'] === '.assist.AssistCameraProvider');
  assert.equal(cam?.attrs['android:authorities'], '${applicationId}.assistcam');
  assert.equal(cam?.attrs['android:exported'], 'false');
  assert.equal(cam?.attrs['android:grantUriPermissions'], 'true');
  assert.ok(!m.some(e => e.tag === 'uses-permission' && e.attrs['android:name'] === 'android.permission.CAMERA'),
    'the camera app takes the photo; WizardOS never asks for the camera permission');
});
