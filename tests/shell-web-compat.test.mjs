import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePage } from './fixtures/w1-pages.mjs';
import { parseCsp } from './fixtures/w1-csp.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withAppParts } from './fixtures/app-parts.mjs';
import { withSettingsParts } from './fixtures/settings-parts.mjs'; // settings.js parts moved out verbatim (issue 1665)
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
function settings({ shell = true, ready = true, full = false } = {}) {
  const calls = [];
  const s = { console, navigator: { userAgent: 'Android ' + (shell ? 'WizardShell/1.0.1' : '') }, location: { host: 'fixture.invalid' }, setTimeout, CSS: { escape: String }, document: { activeElement: null } };
  s.window = s; s.WizCore = {}; s.WizBrand = { html: 'W' };
  let on = false;
  s.WosDeviceOrb = { ready, get state() { return { on, permitted: true }; }, async toggle() { on = !on; calls.push('shell'); } };
  if (full) s.WizardOSNative = { everywhere: () => '{"enabled":true,"overlay":true}', setEverywhere() { calls.push('full'); }, voiceTypingSettings() {} };
  vm.runInNewContext(withSettingsParts(read('web/core/settings.js')), s);
  const root = { innerHTML: '', scrollTop: 0, classList: { add() {} }, dataset: {}, contains: () => false, querySelector: () => null, addEventListener() {}, removeEventListener() {} };
  const view = s.WosSettings.mount(root, { shell: 'phone', helpSub: '' });
  view.focus('assistant');
  return { root, view, calls };
}
const tap = { closest: sel => sel === '[data-st]' ? { dataset: { st: 'everywhere' } } : sel === '[data-settings-feature]' ? { dataset: { settingsFeature: 'assistant' } } : null };
test('repeated Send while native bytes load performs a single stop/read', async () => {
  const app = withAppParts(read('web/app.js'));
  const body = 'const nativeFetching = new Set();\n' + app.slice(app.indexOf('  function nativeFinish'), app.indexOf('    // Notification/Everywhere Send enters here directly')) + '\n}';
  let count = 0, resolve, fetched = false;
  const d = { fetched: () => fetched, fetch: () => { count++; return new Promise(r => { resolve = () => { fetched = true; r(); }; }); } };
  const ctx = { DEV: () => d, nativeTakeAppOwned: () => false, setVoice() {}, toast() {}, txHide() {}, V: {} };
  vm.createContext(ctx); vm.runInContext(body, ctx);
  ctx.nativeFinish('take-A', false); ctx.nativeFinish('take-A', false);
  assert.equal(count, 1); resolve(); await new Promise(r => setImmediate(r)); assert.equal(count, 1);
});
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
// pageAudioFree / state / reloadCheck from app-capture.js, run with the shell recorder (WosDeviceRecording) as the only bridge.
const capture = read('web/core/app-capture.js');
const cut = (a, b) => { const i = capture.indexOf(a), j = capture.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return capture.slice(i, j); };
function capturePage(take) {
  const W = { WosDeviceRecording: { device: () => ({ recActive: () => take }) } };
  const ctx = { W, active: null, preparations: new Map(), memoryTakes: new Map(), attachedMeetingBridge: null, configuredNative: null,
    ownedRows: new Map(), recoveryLive: new Set(), ownershipLoaded: true, recoveryError: null, recoveryLease: null, unknownMeetingActive: false, MEETING_APP: 'meetings' };
  vm.createContext(ctx);
  vm.runInContext(cut('  function state() {', '  function changed()') + cut('  function pageAudioFree() {', '  function cancelReloadRecovery()') +
    cut('  function reloadCheck() {', '  /* Host-only rescue.') + 'this.api = { state, pageAudioFree, reloadCheck };', ctx);
  return ctx.api;
}
test('shared app microphone admission and reload checks see the shell recorder', () => {
  const busy = capturePage('{"id":"shell-take","kind":"meeting"}'), idle = capturePage('null');
  // A shell recorder take nobody in this page owns blocks the page proof, the recorder state and a reload.
  assert.equal(busy.pageAudioFree(), false);
  assert.equal(busy.state().recording, true);
  assert.deepEqual([busy.reloadCheck().safe, busy.reloadCheck().reason], [false, 'device_recording']);
  assert.equal(idle.pageAudioFree(), true);
  assert.equal(idle.state().recording, false);
  assert.equal(idle.reloadCheck().safe, true);
  // An unreadable shell answer never proves quiet.
  const bad = capturePage('{not json');
  assert.equal(bad.pageAudioFree(), false);
  assert.equal(bad.reloadCheck().reason, 'device_recording');
  // The orb's Send never reads a take another app owns from the shell recorder.
  const app = withAppParts(read('web/app.js'));
  const body = 'const nativeFetching = new Set();\n' + app.slice(app.indexOf('  function nativeFinish'), app.indexOf('    // Notification/Everywhere Send enters here directly')) + '\n}';
  const seen = [], ctx = { DEV: () => ({ fetched: () => false, fetch: id => (seen.push('fetch ' + id), new Promise(() => {})) }), nativeTakeAppOwned: id => id === 'app-take',
    setVoice: v => seen.push('voice ' + v), toast: (i, t) => seen.push(t), txHide() {}, V: {} };
  vm.createContext(ctx); vm.runInContext(body, ctx);
  ctx.nativeFinish('app-take', false);
  assert.deepEqual(seen, ['voice paused', 'This recording belongs to another app']);
  ctx.nativeFinish('orb-take', false);
  assert.deepEqual(seen.slice(2), ['fetch orb-take']);
});
// The remote orb page (everywhere.js) with a fake document and a fake orb port.
function everywhere(port = { postMessage(m) { this.sent.push(JSON.parse(m)); }, sent: [] }) {
  const els = {}, el = id => (els[id] ||= { id, disabled: false, textContent: '', attrs: {}, on: {}, classList: { add() {}, remove() {}, toggle() {} }, style: {},
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.on[t] = f; }, appendChild() {}, querySelector: () => null });
  const bodyClasses = new Set();
  const w = { console, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 0, performance: { now: () => 0 }, Orb: { setMode() {}, setLevel() {} }, JSON, wizardOrbPort: port, EverywhereNative: { log() {} },
    document: { getElementById: el, body: { classList: { add: c => bodyClasses.add(c), remove: c => bodyClasses.delete(c), toggle: (c, on) => (on ? bodyClasses.add(c) : bodyClasses.delete(c)), contains: c => bodyClasses.has(c) } }, documentElement: { dataset: {}, style: { setProperty() {} } }, querySelector: () => null } };
  w.window = w;
  vm.createContext(w);
  vm.runInContext(read('web/assist/everywhere.js'), w);
  return { w, els, port, bodyClasses };
}
test('remote orb retains offline signed API and CSP without adding a full-app bridge', () => {
  const html = read('web/assist/everywhere.html');
  // The page's CSP denies the network and every script but its own files.
  // read as the browser reads it: the page's own meta policy, parsed into its directives
  const page = parsePage('assist/everywhere.html'), csp = parseCsp(page.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') || '');
  assert.deepEqual(csp['default-src'], ["'none'"]); assert.deepEqual(csp['connect-src'], ["'none'"]); assert.deepEqual(csp['script-src'], ["'self'"]);
  assert.equal(page.querySelectorAll('script:not([src])').length, 0, 'no inline script');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  const o = everywhere();
  assert.deepEqual(Object.keys(o.w.WosShellOrb), ['v', 'status'], 'the shell orb API is status only: no start, send or read');
  assert.ok(o.bodyClasses.has('shell-orb'));
  assert.ok(o.els.shellPause.disabled, 'nothing to pause before the host names a take');
  o.w.WosShellOrb.status({ id: 'take-1', state: 'recording', ms: 1200 });
  o.els.shellPause.on.click();
  assert.deepEqual(o.port.sent, [{ v: 1, id: 'orb-1', method: 'device.recording.pause', params: { id: 'take-1', on: true } }]);
  assert.ok(o.els.shellCancel.disabled, 'one command at a time');
  o.port.onmessage({ data: JSON.stringify({ v: 1, id: 'orb-1', result: { id: 'take-1', state: 'paused' } }) });
  assert.equal(o.els.shellPause.textContent, 'Resume');
  o.els.shellCancel.on.click();
  assert.deepEqual(o.port.sent[1], { v: 1, id: 'orb-2', method: 'device.recording.cancel', params: { id: 'take-1' } });
  // Without the host port (full Android app, old hosts) the page adds nothing.
  assert.equal(everywhere(null).w.WosShellOrb, undefined);
});
