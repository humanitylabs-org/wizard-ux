// Box-to-phone push for app notifications (wizard-ux issue 1618, switch wizard/phone-push, off by default).
// The real android-relay.js runs in a vm with a stand-in Android bridge: the main page copies this switch to the
// Android app (off only once the switches settle, on at once); an app window never does, and an older Android app
// without the bridge is left alone. The native half (the line to the box, AppPushPolicy) has JVM tests, and the box
// half is humanitylabs-org/notifications api/phone/inbox.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { experienceRuntime } from './fixtures/skin-palettes-harness.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SWITCH = 'wizard/phone-push';
const ORIGIN = 'https://wizard.example';

function fixture({ on = [], native = true, session = '' } = {}) {
  const push = [], notify = [], timers = [], observers = [], winListeners = {};
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
  if (native) c.WizardOSNative = { appPushSwitch: v => push.push(v), appNotifySwitch: v => notify.push(v) };
  vm.createContext(c);
  for (const f of ['web/core/home-screen-policy.js', 'web/core/deeplink.js', 'web/core/android-relay.js']) vm.runInContext(read(f), c);
  const set = ids => { root.dataset.tweaks = ['wizard/desktop-chats', ...ids].join(' '); for (const o of observers) o.fn([]); };
  const settle = () => { for (const t of timers.filter(t => t.ms === 5000)) t.fn(); };
  const experience = () => { for (const f of winListeners['wos:experience'] || []) f(); };
  return { push, notify, set, settle, experience };
}

test('the main page copies the push switch to the Android app: off only once the switches settle, on at once', () => {
  const off = fixture();
  assert.deepEqual(off.push, [], 'nothing before the switches are known: a box still loading never turns it off');
  off.settle();
  assert.deepEqual(off.push, [false]);
  off.experience(); assert.deepEqual(off.push, [false], 'unchanged: not sent again');
  const on = fixture({ on: [SWITCH] });
  assert.deepEqual(on.push, [true]);
  assert.deepEqual(on.notify, [true], 'the per-app reader it builds on is on for everyone (wizard-ux issue 1567)');
  on.set([]); assert.deepEqual(on.push, [true], 'an off before the switches settle waits');
  on.experience(); assert.deepEqual(on.push, [true], 'the first experience event can come before this device\'s switches: still waits');
  on.settle(); assert.deepEqual(on.push, [true, false]);
  on.set([SWITCH]); assert.deepEqual(on.push, [true, false, true]);
  on.set([]); assert.deepEqual(on.push, [true, false, true, false], 'after settling, off goes at once');
});

test('a page whose own switches arrive late never sends an early off (no stop and restart of the line on each open)', () => {
  const f = fixture();               // the switches are not applied yet
  f.experience();                    // the first experience event, before this device's switches
  f.set([SWITCH]);           // now they are
  f.settle(); f.experience();
  assert.deepEqual(f.push, [true]);
});

test('it is its own switch: per-app notifications (on for everyone) alone never start the push line', () => {
  const f = fixture();
  f.settle();
  assert.deepEqual(f.push, [false]);
  assert.deepEqual(f.notify, [true]);
});

test('a home-screen app window never sets it, and an older Android app without the bridge is left alone', () => {
  const f = fixture({ session: 'wizard-health', on: [SWITCH] });
  f.settle(); f.experience();
  assert.deepEqual(f.push, []);
  assert.doesNotThrow(() => { const g = fixture({ native: false, on: [SWITCH] }); g.settle(); g.experience(); });
});

test('the switch is in the catalog, off by default, and names its issue', async () => {
  const { E, active } = experienceRuntime(); await E.refresh();
  const row = E.state.tweaks.find(t => t.id === SWITCH);
  assert.ok(row, 'listed'); assert.equal(row.on, false, 'off by default');
  assert.equal((await E.defaults())[SWITCH], false); assert.ok(!active().includes(SWITCH), 'not loaded');
  const m = JSON.parse(read('web/tweaks/wizard/phone-push/manifest.json'));
  assert.equal(row.name, m.name); assert.equal(m.id, SWITCH);
  assert.deepEqual(m.issues, ['humanitylabs-org/wizard-ux#1618']);
});
