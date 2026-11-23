// Phone notifications per app (wizard-ux issue 1567, switch wizard/phone-app-notifications, off by default).
// The real android-relay.js runs in a vm with a stand-in Android bridge: the main page copies the switch (and the apps'
// names for their Android channels) to the Android app; an app window never does. The native rules are JVM tests
// (AppNotifyPolicyTest); the wiring is checked from source.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { experienceRuntime } from './fixtures/skin-palettes-harness.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SWITCH = 'wizard/phone-app-notifications';
const ORIGIN = 'https://wizard.example';

function fixture({ on = false, native = true, session = '', apps = [] } = {}) {
  const calls = [], timers = [], observers = [], winListeners = {};
  const root = { dataset: { tweaks: on ? 'wizard/desktop-chats ' + SWITCH : 'wizard/desktop-chats' }, setAttribute() {} };
  const href = ORIGIN + '/wizard-os-home/' + (session ? '?app-session=' + session : '');
  const c = { URL, URLSearchParams, console, JSON, Date, Proxy, Reflect, location: new URL(href),
    document: { readyState: 'complete', hidden: false, documentElement: root, body: { appendChild() {} }, querySelectorAll: () => [],
      createElement: () => ({}), getElementById: () => null, addEventListener() {} },
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe() {} },
    navigator: {}, dispatchEvent() {}, CustomEvent: class {}, localStorage: { getItem: () => null, setItem() {} },
    setInterval() {}, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    addEventListener: (n, f) => (winListeners[n] ||= []).push(f) };
  c.window = c;
  const reg = { APPS: apps, APP: Object.fromEntries(apps.map(a => [a.id, a])) };
  c.WizCore = { apps: () => reg };
  if (native) c.WizardOSNative = { appNotifySwitch: (v, names) => calls.push([v, names]) };
  vm.createContext(c);
  for (const f of ['web/core/home-screen-policy.js', 'web/core/deeplink.js', 'web/core/android-relay.js']) vm.runInContext(read(f), c);
  const flip = v => { root.dataset.tweaks = v ? 'wizard/desktop-chats ' + SWITCH : 'wizard/desktop-chats'; for (const o of observers) o.fn([]); };
  const settle = () => { for (const t of timers.filter(t => t.ms === 5000)) t.fn(); };
  const experience = () => { for (const f of winListeners['wos:experience'] || []) f(); };
  return { calls, flip, settle, experience, reg };
}

test('the main page copies the switch to the Android app: off only once the switches settle, on at once', () => {
  const off = fixture();
  assert.deepEqual(off.calls, []);
  off.settle();
  assert.deepEqual(off.calls, [[false, '']]);
  const on = fixture({ on: true });
  assert.equal(on.calls.length, 1);
  assert.equal(on.calls[0][0], true);
  on.flip(false); assert.equal(on.calls.length, 1);
  on.experience(); assert.deepEqual(on.calls[1], [false, '']);
  on.flip(true); assert.equal(on.calls[2][0], true);
});

test('the apps\' names go along for their channels, and a changed app list is sent again', () => {
  const f = fixture({ on: true, apps: [{ id: 'messenger', name: 'Messenger' }, { id: 'wizard-mail', name: 'Mail' }, { id: 'Bad Id', name: 'x' }, { id: 'nameless' }] });
  assert.deepEqual(JSON.parse(f.calls[0][1]), { messenger: 'Messenger', 'wizard-mail': 'Mail' });
  f.experience(); assert.equal(f.calls.length, 1, 'nothing changed: nothing sent');
  f.reg.APPS.push({ id: 'wizard-notes', name: 'Notes' });
  f.experience(); assert.equal(f.calls.length, 2);
  assert.equal(JSON.parse(f.calls[1][1])['wizard-notes'], 'Notes');
});

test('a home-screen app window never sets the switch, and an older app without the bridge is left alone', () => {
  const f = fixture({ session: 'wizard-health', on: true });
  f.settle(); f.experience();
  assert.deepEqual(f.calls, []);
  assert.doesNotThrow(() => { const g = fixture({ native: false, on: true }); g.settle(); });
});

// Not run here (wizard-ux issue 1674): this pinned Java/Swift source text and no JDK runs it in this suite. Android App notifications wiring (MainActivity bridge, AppNotify poll); the page side runs above.
test('the switch is in the catalog, off by default, and names its issue', async () => {
  // the real experience.js over the real catalog: listed in Settings › Look, off on a fresh device
  const { E, active } = experienceRuntime(); await E.refresh();
  const row = E.state.tweaks.find(t => t.id === SWITCH);
  assert.ok(row, 'listed'); assert.equal(row.on, false, 'off by default');
  assert.equal((await E.defaults())[SWITCH], false); assert.ok(!active().includes(SWITCH), 'not loaded');
  const m = JSON.parse(read('web/tweaks/wizard/phone-app-notifications/manifest.json'));
  assert.equal(row.name, m.name); assert.equal(m.id, SWITCH);
  assert.deepEqual(m.issues, ['humanitylabs-org/wizard-ux#1567']);
});
