// One UI-style icon count (wizard-ux issue 1669, on for everyone; switch wizard/phone-badge-look removed).
// The real android-relay.js runs in a vm with a stand-in Android bridge: an older Android app (0.10.70 to 0.10.81,
// which kept a copy of the old switch) is told once that the look is on, whatever the shell's switches say; an app
// window never tells it, and a newer Android app without the call is left alone. The drawing itself (exact label,
// One UI geometry, Samsung squircle placement) has JVM tests in android/app/src/test/java/ai/wizards/os/badge and an
// emulator test in HomeScreenIconTest.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { experienceRuntime } from './fixtures/skin-palettes-harness.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const GONE_ID = 'wizard/phone-badge-look';
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

test('an older Android app is told once that the One UI look is on, and never told off', () => {
  const f = fixture();
  assert.deepEqual(f.sent, [true], 'on at once, before any switch is known');
  f.settle(); f.experience(); f.set([]); f.set([GONE_ID]); f.set([]);
  assert.deepEqual(f.sent, [true], 'nothing the shell switches do changes it');
});

test('a home-screen app window never tells it, and a newer Android app without the call is left alone', () => {
  const f = fixture({ session: 'messenger' });
  f.settle(); f.experience();
  assert.deepEqual(f.sent, []);
  assert.doesNotThrow(() => { const g = fixture({ native: false }); g.settle(); g.experience(); });
});

test('the switch is gone from the catalog and a saved choice for it is cleared', async () => {
  const catalog = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(!JSON.stringify(catalog).includes(GONE_ID), 'not in the catalog');
  const { E, active } = experienceRuntime(); await E.refresh();
  assert.ok(!E.state.tweaks.some(t => t.id === GONE_ID), 'not listed in Settings');
  assert.ok(!active().includes(GONE_ID), 'not loaded');
  assert.equal((await E.defaults())[GONE_ID], undefined, 'no default for it');
});
