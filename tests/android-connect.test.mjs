import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../web/core/settings.js', import.meta.url), 'utf8');
function feature(native) {
  const sandbox = { CSS: { escape: s => String(s) }, WizardOSNative: native, WizCore: {}, WizBrand: { html: 'W' }, location: { host: 'fixture.invalid' }, navigator: { userAgent: 'Android' }, document: {}, requestAnimationFrame() {} };
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
