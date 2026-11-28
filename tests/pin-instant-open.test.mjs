// Instant home-screen apps (wizard-ux issue 1830, on for everyone; the switch wizard/pin-instant-open is gone).
// The real android-relay.js and single-app-session.js run in a vm with a stand-in Android bridge: the main page tells
// an older Android app (0.10.72 to 0.10.83, which kept a copy of the switch) once that it is on, a home-screen app window never does,
// and the pinned page tells the Android app its shell release (before the app frame exists) and when the app's page
// has loaded (so the saved last screen gives way). The Android half (skip Connecting, last screen, the phone-side
// file cache) has JVM tests in android/app/src/test/java/ai/wizards/os/PinInstantPolicyTest.java and PinCacheTest.java;
// the shell worker half is in tests/shell-offline-sw.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { experienceRuntime } from './fixtures/skin-palettes-harness.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SWITCH = 'wizard/pin-instant-open';
const ORIGIN = 'https://wizard.example';

function relay({ on = [], native = true, session = '' } = {}) {
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
  if (native) c.WizardOSNative = { pinInstantSwitch: v => sent.push(v) };
  vm.createContext(c);
  for (const f of ['web/core/home-screen-policy.js', 'web/core/deeplink.js', 'web/core/android-relay.js']) vm.runInContext(read(f), c);
  const set = ids => { root.dataset.tweaks = ['wizard/desktop-chats', ...ids].join(' '); for (const o of observers) o.fn([]); };
  const settle = () => { for (const t of timers.filter(t => t.ms === 5000)) t.fn(); };
  const experience = () => { for (const f of winListeners['wos:experience'] || []) f(); };
  return { sent, set, settle, experience };
}

test('the main page tells an older Android app once that it is on, whatever the old switch says', () => {
  const plain = relay();
  assert.deepEqual(plain.sent, [true], 'at once, with no switch saved');
  plain.settle(); plain.experience(); plain.set([]);
  assert.deepEqual(plain.sent, [true], 'once: switches settling or changing send nothing more');
  const stale = relay({ on: [SWITCH] });
  stale.settle(); stale.set([]); stale.settle();
  assert.deepEqual(stale.sent, [true], 'a stale saved switch changes nothing');
});

test('a home-screen app window never sets it, and an older Android app without the bridge is left alone', () => {
  const f = relay({ session: 'wizard-search', on: [SWITCH] });
  f.settle(); f.experience();
  assert.deepEqual(f.sent, []);
  assert.doesNotThrow(() => { const g = relay({ native: false, on: [SWITCH] }); g.settle(); g.experience(); });
});

// The real single-app-session.js (pinned page) with a cached app, a stand-in bridge and the page's wos-release meta.
function pinned({ native = true, release = 'abcdef012345' } = {}) {
  const calls = [];
  const store = new Map([['wux.apps.v1', JSON.stringify([{ id: 'wizard-search', name: 'Search', url: '/wizard-search/', source: 'apps.json' }])]]);
  const rwin = { WizCore: {}, location: { origin: 'https://box.example', pathname: '/' }, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) } };
  const rctx = { window: rwin, document: { addEventListener() {}, hidden: false }, CustomEvent: class {}, localStorage: rwin.localStorage, location: rwin.location,
    addEventListener() {}, fetch: async () => ({ ok: false }), setTimeout, clearTimeout, console };
  rctx.self = rwin; rctx.globalThis = rctx;
  vm.createContext(rctx); vm.runInContext(read('web/core/apps.js'), rctx);
  const r = rwin.WizCore.apps('mobile');
  const pwin = {};
  const pctx = vm.createContext({ window: pwin, document: { documentElement: { setAttribute() {} } }, location: { origin: 'https://box.example', search: '?app-session=wizard-search' }, URL, URLSearchParams, Object, Proxy, Reflect, localStorage: { getItem: () => null, setItem() {} } });
  vm.runInContext(read('web/core/home-screen-policy.js'), pctx);
  const frames = [];
  function el(tag) { const on = {}; return { tag, dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {} }, children: [], setAttribute() {},
    addEventListener: (n, f) => (on[n] ||= []).push(f), fire: n => (on[n] || []).forEach(f => f()), remove() {}, set textContent(v) {}, set innerHTML(v) { this.children = []; },
    appendChild(c) { this.children.push(c); if (c.tag === 'iframe') frames.push(c); }, append(...c) { this.children.push(...c); }, replaceChildren() { this.children = []; } }; }
  const host = el('host');
  const document = { documentElement: el('html'), getElementById: () => host, addEventListener() {}, createElement: el, title: '',
    querySelector: s => s === 'meta[name="wos-release"]' && release ? { content: release } : null };
  const window = { WizHomeScreenPolicy: pwin.WizHomeScreenPolicy, WizCore: { apps: () => r, appsLoaded: () => new Promise(() => {}) }, WosSelMenu: { back: () => false },
    WizAppServices: { attach: () => () => {}, guardBack() {} }, WizChatsHost: { create: () => ({ bind() {}, forget() {}, isHosted: () => false }) },
    requestAnimationFrame: f => setTimeout(f, 0) };
  if (native) window.WizardOSNative = { pinRelease: v => calls.push(['release', v]), pinShown: () => calls.push(['shown']) };
  const ctx = vm.createContext({ window, document, localStorage: { getItem: () => null, setItem() {} }, location: { origin: 'https://box.example' }, URL,
    addEventListener() {}, setInterval() {}, setTimeout });
  vm.runInContext(read('web/core/single-app-session.js'), ctx);
  return { calls, frames };
}

test('a pinned page tells the Android app its shell release before the app frame exists, then when the app has loaded', async () => {
  const p = pinned();
  assert.deepEqual(p.calls, [['release', 'abcdef012345']], 'the release goes first');
  await new Promise(setImmediate);
  assert.equal(p.frames.length, 1, 'the cached app mounted');
  assert.deepEqual(p.calls, [['release', 'abcdef012345']], 'not shown before the app page loads');
  p.frames[0].fire('load');
  await new Promise(r => setTimeout(r, 200));
  assert.deepEqual(p.calls, [['release', 'abcdef012345'], ['shown']]);
});

test('an unstamped shell (no release) or an Android app without the calls: nothing breaks', async () => {
  const p = pinned({ release: '' });
  assert.deepEqual(p.calls, []);
  const q = pinned({ native: false });
  await new Promise(setImmediate);
  assert.equal(q.frames.length, 1);
  assert.doesNotThrow(() => q.frames[0].fire('load'));
  await new Promise(r => setTimeout(r, 200));
});

test('the switch is gone: not in the catalog, and a saved on or off is cleared', async () => {
  const catalog = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(!JSON.stringify(catalog).includes(SWITCH), 'not in the catalog');
  const { E, active } = experienceRuntime(); await E.refresh();
  assert.equal(E.state.tweaks.find(t => t.id === SWITCH), undefined, 'no row in Try new features');
  assert.equal((await E.defaults())[SWITCH], undefined);
  assert.ok(!active().includes(SWITCH), 'not loaded');
});
