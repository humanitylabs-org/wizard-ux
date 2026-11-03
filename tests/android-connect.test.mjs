import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../web/core/settings.js', import.meta.url), 'utf8');
function feature(native, { userAgent = 'Android', Capacitor } = {}) {
  const sandbox = { CSS: { escape: s => String(s) }, WizardOSNative: native, Capacitor, WizCore: {}, WizBrand: { html: 'W' }, location: { host: 'fixture.invalid' }, navigator: { userAgent }, document: {}, requestAnimationFrame() {} };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox);
  // Exercise the real settings mount/feature filtering, not a different Android-only settings implementation.
  const handlers = {};
  const root = { classList: { add() {} }, dataset: {}, scrollTop: 0, contains: () => false, querySelector: () => null,
    addEventListener: (name, fn) => handlers[name] = fn, removeEventListener() {}, getBoundingClientRect: () => ({ top: 0 }) };
  const view = sandbox.window.WosSettings.mount(root, { shell: 'phone', helpSub: 'Fixture' });
  return { root, view, handlers };
}
test('Change Wizard is absent in browsers and older native clients', () => {
  for (const native of [undefined, { platform() { return 'android:old'; } }]) {
    const { root, view } = feature(native);
    view.focus('server');
    assert.doesNotMatch(root.innerHTML, /Change Wizard/);
  }
});
test('Change Wizard uses shared settings and only invokes native navigation', () => {
  let calls = 0;
  const { root, view } = feature({ platform() { return 'android:test'; }, changeServer() { calls++; } });
  view.focus('server'); // Settings > About & updates, beside the connected Wizard's status
  assert.equal(view.page, 'about');
  assert.match(root.innerHTML, /Change Wizard/);
  const element = { closest(selector) { if (selector === '[data-settings-feature]') return { dataset: { settingsFeature: 'server' } }; if (selector === '[data-st]') return { dataset: { st: 'change-server' } }; return null; } };
  assert.equal(view.dispatch(element), true);
  assert.equal(calls, 1);
});

const changeRow = { closest(selector) { if (selector === '[data-settings-feature]') return { dataset: { settingsFeature: 'server' } }; if (selector === '[data-st]') return { dataset: { st: 'change-server' } }; return null; } };
const iPhone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WizardOS-iOS/1.0';
test('Change Wizard on iPhone opens the app\'s connect screen through WizardShell, never as Android', () => {
  let calls = 0;
  const Capacitor = { Plugins: { WizardShell: { changeWizard() { calls++; return Promise.resolve(); } } } };
  const { root, view } = feature(undefined, { userAgent: iPhone, Capacitor });
  view.focus('server');
  assert.match(root.innerHTML, /Change Wizard/);
  assert.equal(view.dispatch(changeRow), true);
  assert.equal(calls, 1);
});
test('Change Wizard stays hidden in Safari and in a Capacitor page without WizardShell', () => {
  for (const Capacitor of [undefined, { Plugins: {} }]) {
    const { root, view } = feature(undefined, { userAgent: iPhone, Capacitor });
    view.focus('server');
    assert.doesNotMatch(root.innerHTML, /Change Wizard/);
  }
});

test('QR scanner follows the phone orientation (zxing CaptureActivity is landscape by default)', () => {
  const m = fs.readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.match(m, /com\.journeyapps\.barcodescanner\.CaptureActivity"\s+android:screenOrientation="fullSensor"\s+tools:replace="screenOrientation"/);
});
