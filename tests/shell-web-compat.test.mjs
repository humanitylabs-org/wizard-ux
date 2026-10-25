import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
function settings({ shell = true, ready = true, full = false } = {}) {
  const calls = [];
  const s = { console, navigator: { userAgent: 'Android ' + (shell ? 'WizardShell/1.0.1' : '') }, location: { host: 'fixture.invalid' }, setTimeout, CSS: { escape: String }, document: { activeElement: null } };
  s.window = s; s.WizCore = {}; s.WizBrand = { html: 'W' };
  let on = false;
  s.WosDeviceOrb = { ready, get state() { return { on, permitted: true }; }, async toggle() { on = !on; calls.push('shell'); } };
  if (full) s.WizardOSNative = { everywhere: () => '{"enabled":true,"overlay":true}', setEverywhere() { calls.push('full'); }, voiceTypingSettings() {} };
  vm.runInNewContext(read('web/core/settings.js'), s);
  const root = { innerHTML: '', scrollTop: 0, classList: { add() {} }, dataset: {}, contains: () => false, querySelector: () => null, addEventListener() {}, removeEventListener() {} };
  const view = s.WosSettings.mount(root, { shell: 'phone', helpSub: '' });
  view.focus('assistant');
  return { root, view, calls };
}
const tap = { closest: sel => sel === '[data-st]' ? { dataset: { st: 'everywhere' } } : sel === '[data-settings-feature]' ? { dataset: { settingsFeature: 'assistant' } } : null };
test('shell Everywhere drives exactly one optional switch and hold means pause', async () => {
  const h = settings();
  assert.equal((h.root.innerHTML.match(/data-st="everywhere"/g) || []).length, 1);
  assert.doesNotMatch(h.root.innerHTML, /data-st="side"|data-st="typing"|data-st="everywhere"[^>]*disabled/);
  h.view.dispatch(tap); await new Promise(r => setImmediate(r));
  assert.deepEqual(h.calls, ['shell']);
  assert.match(h.root.innerHTML, /hold to pause recording/);
  assert.doesNotMatch(h.root.innerHTML, /hold it to hide/);
});
test('old companion without capability hides unsupported controls; full app retains its bridge', () => {
  assert.doesNotMatch(settings({ ready: false }).root.innerHTML, /data-st="everywhere"|data-st="side"/);
  const h = settings({ full: true });
  assert.match(h.root.innerHTML, /data-st="side"/);
  h.view.dispatch(tap); assert.deepEqual(h.calls, ['full']);
});
test('shared app microphone admission and reload checks see the shell recorder', () => {
  const s = read('web/core/app-capture.js');
  assert.equal((s.match(/\(W\.WizardOSDevice \|\| W\.WosDeviceRecording\?\.device\(\)\)\?\.recActive/g) || []).length, 5);
  const app = read('web/app.js');
  const finish = app.slice(app.indexOf('function nativeFinish('), app.indexOf('const releasedTakes'));
  assert.ok(finish.indexOf('nativeTakeAppOwned(id)') < finish.indexOf('shell.fetch(id)'));
});
test('remote orb retains offline signed API and CSP without adding a full-app bridge', () => {
  const html = read('web/assist/everywhere.html'), js = read('web/assist/everywhere.js');
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  assert.match(js, /WosShellOrb/);
  assert.match(js, /wizardOrbPort/);
  assert.match(js, /command\('pause'/);
  assert.match(js, /command\('cancel'/);
});
