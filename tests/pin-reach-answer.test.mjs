// Connecting only while the Wizard hasn't answered (wizard-ux issue 1607, switch wizard/pin-reach-answer, off by default).
// The real android-relay.js runs in a vm with a stand-in Android bridge: the main page copies the switch to the Android
// app, an app window never does. The native rules are JVM tests (ReachPolicyTest); the wiring is checked from source.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SWITCH = 'wizard/pin-reach-answer';
const ORIGIN = 'https://wizard.example';

function fixture({ on = false, native = true, session = '' } = {}) {
  const switches = [], timers = [], observers = [], winListeners = {};
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
  c.WizCore = { apps: () => ({ APPS: [], APP: {} }) };
  if (native) c.WizardOSNative = { reachAnswerSwitch: v => switches.push(v) };
  vm.createContext(c);
  for (const f of ['web/core/home-screen-policy.js', 'web/core/deeplink.js', 'web/core/android-relay.js']) vm.runInContext(read(f), c);
  const flip = v => { root.dataset.tweaks = v ? 'wizard/desktop-chats ' + SWITCH : 'wizard/desktop-chats'; for (const o of observers) o.fn([]); };
  const settle = () => { for (const t of timers.filter(t => t.ms === 5000)) t.fn(); };
  const experience = () => { for (const f of winListeners['wos:experience'] || []) f(); };
  return { switches, flip, settle, experience };
}

test('the main page copies the switch to the Android app: off only once the switches settle, on at once', () => {
  const off = fixture();
  assert.deepEqual(off.switches, []);
  off.settle();
  assert.deepEqual(off.switches, [false]);
  const on = fixture({ on: true });
  assert.deepEqual(on.switches, [true]);
  on.flip(false); assert.deepEqual(on.switches, [true]);
  on.experience(); assert.deepEqual(on.switches, [true, false]);
  on.flip(true); assert.deepEqual(on.switches, [true, false, true]);
});

test('a home-screen app window never sets the switch, and an older app without the bridge is left alone', () => {
  const f = fixture({ session: 'wizard-health', on: true });
  f.settle(); f.experience();
  assert.deepEqual(f.switches, []);
  assert.doesNotThrow(() => { const g = fixture({ native: false, on: true }); g.settle(); });
});

test('Android: an answer stops only the connecting mark, behind the switch; a paint still ends both', () => {
  const src = read('android/app/src/main/java/ai/wizards/os/MainActivity.java');
  const body = src.slice(src.indexOf('    void answered(String url) {'), src.indexOf('    private void showOffline(String why) {'));
  assert.match(body, /ReachPolicy\.answerDisarms\(ReachAnswer\.on\(this\), isWeb\(url\), mainFailed, sameHost\(url, wantUrl\)\)/);
  assert.ok(body.includes('main.removeCallbacks(reachMark);'));
  assert.ok(!body.includes('reachGiveUp'), 'the give-up mark stays armed until a page paints');
  const started = src.slice(src.indexOf('public void onPageStarted(WebView view, String url'), src.indexOf('public void onPageFinished('));
  assert.ok(started.includes('answered(url);'));
  const hist = src.slice(src.indexOf('public void doUpdateVisitedHistory('), src.indexOf('public void onPageCommitVisible('));
  assert.ok(hist.includes('if (ReachAnswer.on(MainActivity.this)) { answered(url); return; }'));
  const painted = src.slice(src.indexOf('public void onPageCommitVisible('), src.indexOf('public void onPageStarted('));
  assert.ok(painted.includes('landed();'), 'a paint still clears both marks');
  const bridge = src.slice(src.indexOf('public void reachAnswerSwitch(boolean on)'));
  assert.ok(bridge.slice(0, 200).includes('if (MainActivity.this instanceof AppSessionActivity) return;'));
  assert.match(read('android/app/src/main/java/ai/wizards/os/ReachAnswer.java'), /getBoolean\(KEY, false\)/, 'off by default on the phone');
});

test('the switch is in the catalog, off by default, and names its issue', () => {
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(cat.tweaks.includes(SWITCH));
  assert.ok(!cat.defaults.includes(SWITCH));
  assert.ok(!(cat.promotedDefaults || []).includes(SWITCH));
  const m = JSON.parse(read('web/tweaks/wizard/pin-reach-answer/manifest.json'));
  assert.equal(m.id, SWITCH);
  assert.deepEqual(m.issues, ['humanitylabs-org/wizard-ux#1607']);
});
