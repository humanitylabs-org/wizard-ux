import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import fixture from '../tools/qa-desktop-frame-fixture.cjs';
const welcome = fs.readFileSync(new URL('../web/core/welcome.js', import.meta.url), 'utf8');
const desktop = fs.readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
const harness = fs.readFileSync(new URL('../qa-desktop-frame-hotkeys.cjs', import.meta.url), 'utf8');
function slice(source, start, end) { const a = source.indexOf(start), b = source.indexOf(end, a); assert(a >= 0 && b > a); return source.slice(a, b); }
function storage(phone = false) {
  const saved = new Map(), s = { localStorage: { getItem: k => saved.has(k) ? saved.get(k) : null, setItem: (k, v) => saved.set(k, String(v)) } };
  s.window = s; s.top = s; vm.runInNewContext(`(${fixture.seedOwner.toString()})({ phone: ${phone} })`, s); return { saved, s };
}
test('established-owner init seeds exact Welcome key and never resets persisted desks/skin on reload', () => {
  const { saved, s } = storage(); assert.equal(saved.get('wos.welcome.v1'), 'done');
  assert.equal(JSON.parse(saved.get('wux.desk.ws')).length, 3);
  s.localStorage.setItem('wux.desk.cur', '2'); s.localStorage.setItem('wos.skin', 'landscapes');
  vm.runInNewContext(`(${fixture.seedOwner.toString()})({ phone: false })`, s);
  assert.equal(saved.get('wux.desk.cur'), '2'); assert.equal(saved.get('wos.skin'), 'landscapes');
  assert.equal(storage(true).saved.has('wux.desk.ws'), false);
});
test('nested init cannot overwrite top-level owner state', () => {
  const { s } = storage(); s.top = {}; s.localStorage.setItem = () => { throw Error('nested write'); };
  vm.runInNewContext(`(${fixture.seedOwner.toString()})({ phone: false })`, s);
});
async function boot(options, setup, state) {
  const tasks = [], opened = [], log = [], s = { Promise, tsig: () => ({}), booted: false, H: null, acted: false, act() {}, addEventListener() {}, removeEventListener() {}, seenPending: () => false, markSeen() {}, read: () => state, log: x => log.push(x), open: x => opened.push(x), setTimeout: (f, ms) => { if (!ms) tasks.push(f); }, fetch: async url => ({ ok: true, json: async () => url.endsWith('/model/options') ? options : setup }) };
  s.window = { WizCore: { appsLoaded: () => Promise.resolve() }, WizConfig: { ready: Promise.resolve() } };
  s.OPTIONS = '/wizard/hermes/api/model/options'; s.SETUP = '/wizard/v1/setup'; s.SUB = 'claude-subscription-directsdk-experimental';
  const ai = slice(welcome, '  function aiConnected(j, slug)', '\n  // slug:');
  const ready = slice(welcome, '  async function aiReady(slug)', '\n  async function setupState()');
  const setupFn = slice(welcome, '  async function setupState()', '\n  // The server');
  const bootFn = slice(welcome, '  function boot(h)', '\n\n  // The first thread');
  vm.runInNewContext(ai + ready + setupFn + bootFn + '\nthis.boot = boot;', s);
  s.boot({}); assert.equal(tasks.length, 1); await tasks.shift()(); return { opened, log };
}
test('actual Welcome boot diagnoses old empty options as disconnected despite DOM removal', async () => {
  const out = await boot({}, {}, ''); assert.deepEqual(out.opened, ['ai']); assert.deepEqual(out.log, ['boot:false::false']);
  assert(welcome.includes('get active() { return !!el; }'));
  // The old harness removed a node, not this lexical controller reference.
  assert(welcome.includes('function close()')); assert(!harness.includes("document.getElementById('wosWelcome')?.remove()"));
});
test('actual Welcome boot accepts fixture schema with done + ready + first_run:false', async () => {
  const out = await boot(fixture.ownerRead('/wizard/hermes/api/model/options'), fixture.ownerRead('/wizard/v1/setup'), 'done');
  assert.deepEqual(out.opened, []); assert.deepEqual(out.log, ['boot:true:done:false']);
});
function dispatcher(welcomeActive = false) {
  const calls = [], s = { window: { WosWelcome: { active: welcomeActive } }, pick: { active: () => false }, keyHints: { down() {}, pinned: () => false }, NATIVE_MENU: false, LINKS: null, homeOpen: false, focused: () => null, typing: () => true, pal: { hidden: true }, settingsFocused: () => false, stepWin: d => calls.push(['step', d]), palToggle: m => calls.push(['picker', m]), VOICE: { state: 'idle' } };
  vm.runInNewContext(slice(desktop, '  function onKey(e, fromFrame = false)', "\n  addEventListener('keydown'") + '\nthis.onKey = onKey;', s);
  const key = (code, overrides = {}) => { const e = { code, key: code, target: {}, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault() {}, stopPropagation() {}, ...overrides }; s.onKey(e, true); return e; };
  return { calls, key };
}
test('exact served dispatcher supports Alt brackets and Alt O, not Control Tab/O or Meta O', () => {
  const d = dispatcher(); d.key('BracketRight'); d.key('BracketLeft'); d.key('KeyO');
  assert.deepEqual(d.calls, [['step', 1], ['step', -1], ['picker', 'apps']]); d.calls.length = 0;
  for (const [code, ctrlKey, metaKey] of [['Tab', true, false], ['KeyO', true, false], ['KeyO', false, true]]) d.key(code, { altKey: false, ctrlKey, metaKey });
  assert.deepEqual(d.calls, []); assert(!harness.includes('Control+Tab')); assert(!harness.includes("'Control+o'")); assert(!harness.includes("'Meta+o'"));
});
test('actual dispatcher Welcome guard blocks otherwise supported chords before any handler', () => {
  const d = dispatcher(true); d.key('BracketRight'); d.key('KeyO'); assert.deepEqual(d.calls, []);
});
test('defaultPrevented alone is not an existing onKey cancellation contract; do not claim it is', () => {
  const d = dispatcher(); d.key('KeyO', { defaultPrevented: true }); assert.deepEqual(d.calls, [['picker', 'apps']]);
});
test('fixture observer forwards identical event and this; uninstrumented lane leaves listeners untouched', () => {
  for (const instrument of [true, false]) {
    const handlers = { window: {}, document: {} }, s = { Math, onKey: (e, frame) => { s.seen = e; s.fromFrame = frame; }, keyHints: {} };
    const add = label => function(type, fn) { (handlers[label][type] ||= []).push(fn); };
    s.addEventListener = add('window'); s.document = { addEventListener: add('document') }; s.window = s;
    vm.runInNewContext(`(${fixture.appScript.toString()})(${instrument}); window.addEventListener('keydown', function(e) { onKey(e, true); this.lastObserved = e; }, true);`, s);
    const e = { key: '2', code: 'Digit2', isTrusted: false, stopPropagation() { this.stopped = true; } };
    for (const fn of handlers.window.keydown) fn.call(s, e);
    assert.equal(s.seen, e); assert.equal(s.lastObserved, e); assert.equal(s.fromFrame, true); assert.equal(s.fixtureBridge.registrations.length, instrument ? 1 : 0); assert.equal(s.fixtureBridge.calls.length, instrument ? 1 : 0);
    assert.equal(e.stopped, true); // only the intentionally blocking app listener consumes propagation
  }
});
test('real browser oracle remains exact; no force clicks or alternate expected desktop indexes', () => {
  assert(harness.includes("'Alt+2 from focused app input must switch without a desktop click'"));
  assert(harness.includes('trusted chord must reach the app')); assert(harness.includes('baseline Document adapter must specifically be stranded'));
  assert(!harness.includes('force: true')); assert(harness.includes('real Welcome controller must be inactive'));
  const settings = fs.readFileSync(new URL('../web/core/settings.js', import.meta.url), 'utf8');
  assert(settings.includes("{ id: 'appearance', title: 'Appearance'"));
  assert(harness.includes('[data-st-page="appearance"]')); assert(!harness.includes('[data-st-page="look"]'));
  assert(harness.includes("page.locator('.mz-intro').waitFor({ state: 'detached' })"));
});
