// Phone notifications per app (wizard-ux issue 1567, on for everyone: the switch wizard/phone-app-notifications is gone).
// The real android-relay.js runs in a vm with a stand-in Android bridge: the main page tells the Android app it is on,
// with the apps' names for their Android channels; an app window never does. The native rules are JVM tests
// (AppNotifyPolicyTest); the wiring is checked from source.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { experienceRuntime } from './fixtures/skin-palettes-harness.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const GONE_SWITCH = 'wizard/phone-app-notifications';
const ORIGIN = 'https://wizard.example';

function fixture({ on = false /* the old switch still saved on this device */, native = true, session = '', apps = [] } = {}) {
  const calls = [], timers = [], observers = [], winListeners = {};
  const root = { dataset: { tweaks: on ? 'wizard/desktop-chats ' + GONE_SWITCH : 'wizard/desktop-chats' }, setAttribute() {} };
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
  const flip = v => { root.dataset.tweaks = v ? 'wizard/desktop-chats ' + GONE_SWITCH : 'wizard/desktop-chats'; for (const o of observers) o.fn([]); };
  const settle = () => { for (const t of timers.filter(t => t.ms === 5000)) t.fn(); };
  const experience = () => { for (const f of winListeners['wos:experience'] || []) f(); };
  return { calls, flip, settle, experience, reg };
}

test('the main page tells the Android app it is on at once, with no switch and no wait for the switches to settle', () => {
  const f = fixture();
  assert.deepEqual(f.calls, [[true, '{}']]);
  f.settle(); f.experience();
  assert.deepEqual(f.calls, [[true, '{}']], 'nothing changed: nothing sent, and never an off');
});

test('an old saved value of the removed switch changes nothing: it stays on', () => {
  const f = fixture({ on: true });
  f.flip(false); f.settle(); f.experience(); f.flip(true);
  assert.deepEqual(f.calls.map(c => c[0]), [true]);
});

test('the apps\' names go along for their channels, and a changed app list is sent again', () => {
  const f = fixture({ apps: [{ id: 'messenger', name: 'Messenger' }, { id: 'wizard-mail', name: 'Mail' }, { id: 'Bad Id', name: 'x' }, { id: 'nameless' }] });
  assert.deepEqual(JSON.parse(f.calls[0][1]), { messenger: 'Messenger', 'wizard-mail': 'Mail' });
  f.experience(); assert.equal(f.calls.length, 1, 'nothing changed: nothing sent');
  f.reg.APPS.push({ id: 'wizard-notes', name: 'Notes' });
  f.experience(); assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[1][0], true);
  assert.equal(JSON.parse(f.calls[1][1])['wizard-notes'], 'Notes');
});

test('a home-screen app window never calls it, and an older app without the bridge is left alone', () => {
  const f = fixture({ session: 'wizard-health' });
  f.settle(); f.experience();
  assert.deepEqual(f.calls, []);
  assert.doesNotThrow(() => { const g = fixture({ native: false }); g.settle(); });
});

test('the switch is gone: not in the catalog or help, and a saved choice is cleared', async () => {
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(!JSON.stringify(cat).includes(GONE_SWITCH), 'not in the catalog');
  assert.ok(!(GONE_SWITCH in JSON.parse(read('skill/help.json')).switches), 'not in help');
  const { E } = experienceRuntime(); await E.refresh();
  assert.ok(!E.state.tweaks.some(t => t.id === GONE_SWITCH), 'not listed in Settings');
});
