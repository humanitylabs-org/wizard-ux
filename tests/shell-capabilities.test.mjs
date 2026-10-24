// Wizard Shell (android/shell) says WizardOS-Android/ in its user agent but has no WizardOSNative bridge. Every web
// path keyed on that user agent must use what the shell really has: device.orb for Everywhere, the DownloadListener
// for downloads, main-frame navigation for other sites. Full-app-only controls are hidden, never shown dead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SHELL_UA = 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile WizardOS-Android/1.0.0-test WizardShell/1.0.0-test';
const FULL_UA = 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile WizardOS-Android/0.10.9';

function settings({ ua, orb, native, photos } = {}) {
  const sandbox = { console, Map, Set, Date, String, JSON, Promise, navigator: { userAgent: ua }, location: { host: 'fixture.invalid' }, setTimeout: fn => fn(), CSS: { escape: String }, document: { activeElement: null } };
  sandbox.window = sandbox;
  sandbox.WizCore = {}; sandbox.WizBrand = { html: 'W' };
  if (native) sandbox.WizardOSNative = native;
  if (photos) sandbox.wizardPhotosPort = { postMessage() {} };
  const calls = [];
  if (orb) {
    let on = !!orb.on;
    sandbox.WosDeviceOrb = { ready: true, get state() { return { on, permitted: true, visible: false }; }, toggle: async () => { calls.push(on ? 'disable' : 'enable'); on = !on; } };
  }
  vm.runInNewContext(read('web/core/settings.js'), sandbox);
  const root = { innerHTML: '', scrollTop: 0, classList: { add() {} }, dataset: {}, contains: () => false, querySelector: () => null, addEventListener() {}, removeEventListener() {} };
  const view = sandbox.WosSettings.mount(root, { shell: 'phone', helpSub: 'Fixture' });
  return { sandbox, root, view, calls };
}
const tap = st => ({ closest: s => s === '[data-st]' ? { dataset: { st } } : s === '[data-settings-feature]' ? { dataset: { settingsFeature: 'assistant' } } : null });

test('Wizard Shell with device.orb: Everywhere is one switch that drives the floating orb; no dead full-app rows', async () => {
  const { root, view, calls } = settings({ ua: SHELL_UA, orb: { on: false } });
  assert.match(root.innerHTML, /data-st-page="phone"/, 'Phone page offered');
  assert.match(root.innerHTML, /Everywhere off/);
  view.focus('assistant');
  assert.equal(view.page, 'phone');
  assert.equal((root.innerHTML.match(/data-st="everywhere"/g) || []).length, 1, 'exactly one Everywhere switch');
  assert.doesNotMatch(root.innerHTML, /data-st="everywhere"[^>]*disabled/);
  assert.doesNotMatch(root.innerHTML, /shell-orb|Floating orb/, 'no second orb row');
  assert.doesNotMatch(root.innerHTML, /data-st="side"|data-st="typing"|Works in the Wizard OS Android app|Update the Wizard OS app/);
  assert.equal(view.dispatch(tap('everywhere')), true);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(calls, ['enable']);
  assert.match(root.innerHTML, /aria-checked="true"/);
  view.focus('orb'); assert.equal(view.page, 'phone', 'the old orb route lands on Everywhere');
});

test('Wizard Shell without device.orb (older APK): no Phone page, no dead Everywhere switch', () => {
  const { root, view } = settings({ ua: SHELL_UA });
  assert.doesNotMatch(root.innerHTML, /data-st-page="phone"/);
  view.focus('assistant');
  assert.doesNotMatch(root.innerHTML, /data-st="everywhere"/);
});

test('Wizard Shell names itself in Settings → Wizard instead of claiming Web or calling native platform()', () => {
  const { root, view } = settings({ ua: SHELL_UA, orb: {} });
  view.focus('wizard');
  assert.match(root.innerHTML, /Wizard Shell · fixture\.invalid/);
});

test('the full app keeps its native Everywhere, side button and voice typing unchanged', () => {
  const N = { everywhere: () => JSON.stringify({ enabled: true, overlay: true }), setEverywhere(v) { this.set = v; }, voiceTypingSettings() {}, sideButton: () => '{}' };
  const { root, view } = settings({ ua: FULL_UA, native: N, orb: {} });
  view.focus('assistant');
  assert.match(root.innerHTML, /data-st="everywhere"/);
  assert.match(root.innerHTML, /data-st="side"/);
  assert.match(root.innerHTML, /data-st="typing"/);
  view.dispatch(tap('everywhere'));
  assert.equal(N.set, false, 'native setEverywhere toggled, not device.orb');
});

test('downloads in Wizard Shell go through its DownloadListener (<a download>), never the clipboard detour', () => {
  const src = read('web/core/links.js');
  assert.match(src, /const SHELL = !window\.WizardOSNative && \/WizardShell\\\//);
  assert.match(src, /if \(NATIVE && !SHELL\) \{\s*const say/);
  const kit = read('web/core/chat-kit.js');
  assert.match(kit, /appDownloads = \(\) => \{\s*if \(!window\.WizardOSNative && \/WizardShell\\\/\/\.test/);
});

test('every web path keyed on the WizardOS-Android user agent is audited for Wizard Shell', () => {
  // links.js (SHELL branch), chat-kit.js (appDownloads), shell.js (phone layout only: the shell wants it), app.js
  // (native-app class: no CSS or script depends on it). A new consumer must handle WizardShell/ explicitly.
  const users = ['web/core/links.js', 'web/core/chat-kit.js', 'web/core/shell.js', 'web/app.js'];
  for (const f of users) assert.match(read(f), /WizardOS-Android\\\//, f);
  for (const f of ['web/core/links.js', 'web/core/chat-kit.js']) assert.match(read(f), /WizardShell\\\//, f + ' handles the shell');
  assert.doesNotMatch(read('web/core/shell.js'), /android\s*&&\s*window\.WizardOSNative\./, 'shell.js only picks a layout');
});

test('Wizard Shell user agent tags both names so old web keeps the phone layout and new web can tell them apart', () => {
  const java = read('android/shell/src/main/java/ai/wizards/shell/ShellActivity.java');
  assert.match(java, /UA_TAG = " WizardOS-Android\/" \+ BuildConfig\.VERSION_NAME \+ " WizardShell\/"/);
});
