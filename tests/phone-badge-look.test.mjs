// One UI-style icon count (wizard-ux issue 1669, switch wizard/phone-badge-look, off by default).
// The real android-relay.js runs in a vm with a stand-in Android bridge: the main page copies this switch to the
// Android app (off only once the switches settle, on at once); an app window never does, and an older Android app
// without the bridge is left alone. The drawing itself (exact label, One UI geometry, Samsung squircle placement) has
// JVM tests in android/app/src/test/java/ai/wizards/os/badge and an emulator test in HomeScreenIconTest.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { experienceRuntime } from './fixtures/skin-palettes-harness.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SWITCH = 'wizard/phone-badge-look';
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
  if (native) c.WizardOSNative = { badgeLookSwitch: v => sent.push(v) };
  vm.createContext(c);
  for (const f of ['web/core/home-screen-policy.js', 'web/core/deeplink.js', 'web/core/android-relay.js']) vm.runInContext(read(f), c);
  const set = ids => { root.dataset.tweaks = ['wizard/desktop-chats', ...ids].join(' '); for (const o of observers) o.fn([]); };
  const settle = () => { for (const t of timers.filter(t => t.ms === 5000)) t.fn(); };
  const experience = () => { for (const f of winListeners['wos:experience'] || []) f(); };
  return { sent, set, settle, experience };
}

test('the main page copies the badge-look switch to the Android app: on at once, off only once settled', () => {
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
  const m = JSON.parse(read('web/tweaks/wizard/phone-badge-look/manifest.json'));
  assert.equal(row.name, m.name); assert.equal(m.id, SWITCH);
  assert.deepEqual(m.issues, ['humanitylabs-org/wizard-ux#1669']);
});
