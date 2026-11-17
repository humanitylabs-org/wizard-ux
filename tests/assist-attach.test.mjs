// Camera and Attach on the side-button corner orb (wizard-os issue 655, switch wizard/assist-attach, off by default).
// The corner orb is the Android app's own page, so the shell copies the switch to native; the real android-relay.js
// runs here in a vm with a stand-in native bridge. The rest checks that the switch, the orb page and the Android
// wiring stay in step (the native rules themselves are JVM tests: android/app/src/test/.../AttachPolicyTest.java).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

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

test('the switch is in the catalog and off by default', () => {
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(cat.tweaks.includes(SWITCH));
  assert.ok(!cat.defaults.includes(SWITCH));
  assert.ok(!(cat.promotedDefaults || []).includes(SWITCH));
  const m = JSON.parse(read('web/tweaks/wizard/assist-attach/manifest.json'));
  assert.equal(m.id, SWITCH);
  assert.match(m.description, /lock screen/);
});

test('the corner orb shows Camera and Attach only when native says the switch is on, and never on the lock screen', () => {
  const html = read('android/app/src/main/assets/assist/surface.html');
  assert.match(html, /#camC,#pickC\{display:none\}/);
  assert.match(html, /body\.corner\.canattach #camC,body\.corner\.canattach #pickC\{display:flex\}/);
  assert.match(html, /MODE==='corner'&&typeof N\.attachOn==='function'&&!!N\.attachOn\(\)/);
  assert.match(html, /\$\('camC'\)\.addEventListener\('click',e=>\{e\.stopPropagation\(\);if\(S\.state==='listen'&&N\.camera\)/);
  assert.match(html, /\$\('pickC'\)\.addEventListener\('click',e=>\{e\.stopPropagation\(\);if\(S\.state==='listen'&&N\.pick\)/);
  const lock = read('android/app/src/main/java/ai/wizards/os/assist/AssistLockActivity.java');
  assert.ok(!/attachOn|camera\(\)|AssistPickActivity/.test(lock), 'the lock-screen surface has no Camera/Attach bridge');
  const session = read('android/app/src/main/java/ai/wizards/os/assist/WizardSession.java');
  assert.match(session, /public boolean attachOn\(\) \{ return AssistAttach\.on\(getContext\(\)\) && !keyguard\.isKeyguardLocked\(\); \}/);
  assert.match(session, /if \(!AssistAttach\.on\(getContext\(\)\) \|\| keyguard\.isKeyguardLocked\(\)\) return;/);
  assert.match(session, /capture\.listening\(\) && !capture\.away\(\)\) capture\.finishOnDismiss/, 'opening the camera never ends the take');
});

test('the picker step and the camera file are private to WizardOS', () => {
  const man = read('android/app/src/main/AndroidManifest.xml');
  assert.match(man, /android:name="\.assist\.AssistPickActivity"\s+android:exported="false"/);
  assert.match(man, /android:name="\.assist\.AssistCameraProvider"\s+android:authorities="\$\{applicationId\}\.assistcam"\s+android:exported="false"\s+android:grantUriPermissions="true"/);
  assert.ok(!/android\.permission\.CAMERA"/.test(man), 'the camera app takes the photo; WizardOS never asks for the camera permission');
  const main = read('android/app/src/main/java/ai/wizards/os/MainActivity.java');
  assert.match(main, /public void assistAttachSwitch\(boolean on\) \{\s+if \(MainActivity\.this instanceof AppSessionActivity\) return;/);
});
