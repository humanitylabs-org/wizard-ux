// Phone recovery mode (wizard-ux issue 1775, switch wizard/phone-recovery-mode, off by default).
// The real android-relay.js runs in a vm with a stand-in Android bridge: the main page copies this switch to the
// Android app (off only once the switches settle, on at once); an app window never does, and an older Android app
// without the bridge is left alone. The start rules (when a start opens in recovery mode, what the card says) have JVM
// tests in android/app/src/test/java/ai/wizards/os/StartPolicyTest.java; the card is drawn in HomeScreenIconTest.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { experienceRuntime } from './fixtures/skin-palettes-harness.mjs';
import { java, method } from './fixtures/s1-java-slice.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SWITCH = 'wizard/phone-recovery-mode';
const ORIGIN = 'https://wizard.example';

function fixture({ on = [], native = true, session = '' } = {}) {
  const sent = [], timers = [], observers = [], winListeners = {};
  const root = { dataset: { tweaks: ['wizard/desktop-chats', ...on].join(' ') }, setAttribute() {} };
  const href = ORIGIN + '/wizard-os-home/' + (session ? '?app-session=' + session : '');
  const c = { URL, URLSearchParams, console, JSON, Date, Proxy, Reflect, location: new URL(href),
    document: { readyState: 'complete', hidden: false, documentElement: root, body: { appendChild() {} }, querySelectorAll: () => [],
      createElement: () => ({}), getElementById: () => null, addEventListener() {} },
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe() {} },
    navigator: {}, dispatchEvent() {}, CustomEvent: class {}, localStorage: { getItem: () => null, setItem() {} },
    setInterval() {}, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    addEventListener: (n, f) => (winListeners[n] ||= []).push(f) };
  c.window = c;
  c.WizCore = { apps: () => ({ APPS: [], APP: {} }) };
  if (native) c.WizardOSNative = { recoveryModeSwitch: v => sent.push(v) };
  vm.createContext(c);
  for (const f of ['web/core/home-screen-policy.js', 'web/core/deeplink.js', 'web/core/android-relay.js']) vm.runInContext(read(f), c);
  const set = ids => { root.dataset.tweaks = ['wizard/desktop-chats', ...ids].join(' '); for (const o of observers) o.fn([]); };
  const settle = () => { for (const t of timers.filter(t => t.ms === 5000)) t.fn(); };
  const experience = () => { for (const f of winListeners['wos:experience'] || []) f(); };
  return { sent, set, settle, experience };
}

test('the main page copies the recovery-mode switch to the Android app: on at once, off only once settled', () => {
  const off = fixture();
  assert.deepEqual(off.sent, [], 'nothing before the switches are known');
  off.settle();
  assert.deepEqual(off.sent, [false]);
  off.experience(); assert.deepEqual(off.sent, [false], 'unchanged: not sent again');
  const on = fixture({ on: [SWITCH] });
  assert.deepEqual(on.sent, [true]);
  on.set([]); assert.deepEqual(on.sent, [true], 'an off before the switches settle waits');
  on.settle(); assert.deepEqual(on.sent, [true, false]);
  on.set([SWITCH]); assert.deepEqual(on.sent, [true, false, true]);
  on.set([]); assert.deepEqual(on.sent, [true, false, true, false], 'after settling, off goes at once');
});

test('a home-screen app window never sets it, and an older Android app without the bridge is left alone', () => {
  const f = fixture({ session: 'messenger', on: [SWITCH] });
  f.settle(); f.experience();
  assert.deepEqual(f.sent, []);
  assert.doesNotThrow(() => { const g = fixture({ native: false, on: [SWITCH] }); g.settle(); g.experience(); });
});

test('the switch is in the catalog, off by default, and names its issue', async () => {
  const { E, active } = experienceRuntime(); await E.refresh();
  const row = E.state.tweaks.find(t => t.id === SWITCH);
  assert.ok(row, 'listed'); assert.equal(row.on, false, 'off by default');
  assert.equal((await E.defaults())[SWITCH], false); assert.ok(!active().includes(SWITCH), 'not loaded');
  const m = JSON.parse(read('web/tweaks/wizard/phone-recovery-mode/manifest.json'));
  assert.equal(row.name, m.name); assert.equal(m.id, SWITCH);
  assert.deepEqual(m.issues, ['humanitylabs-org/wizard-ux#1775']);
});

test('the real MainActivity.onStart holds the outbox and the meeting recovery back only on a recovery start', () => {
  class AppSessionActivity {}
  const run = paused => {
    const did = [];
    const ai = { wizards: { os: { AppSessionActivity, StartGuard: { paused: () => paused },
      device: { AppState: { shellFront: () => true } },
      everywhere: { EverywhereService: { setAppInFront: () => did.push('front') }, EverywhereOutbox: { get: () => ({ pump: () => did.push('pump') }) } },
      mizel: { MeetingRecorderService: { recoverFromActivity: () => did.push('recover') } } } } };
    method(java('MainActivity.java'), 'protected void onStart()', { scope: { ai, AppSessionActivity, device: { onStart: () => did.push('device') } }, base: class { onStart() {} } });
    return did;
  };
  assert.deepEqual(run(false), ['device', 'front', 'pump', 'recover'], 'a normal start (and every start with the switch off) is as before');
  assert.deepEqual(run(true), ['device', 'front'], 'recovery mode: the shell is told, the background work waits for Start normally');
});
