// Browser owner boundary, sandboxed app frames (wizard-os#133): web/core/browser-boundary.js (shell) and
// web/core/browser-boundary-client.js (app), talking through a fake postMessage bus with real origin/source checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SHELL_SRC = read('web/core/browser-boundary.js');
const CLIENT_SRC = read('web/core/browser-boundary-client.js');
const FIELD_SRC = read('web/core/focused-field.js');
const ORIGIN = 'https://box.example.ts.net';
const tick = () => new Promise(r => setTimeout(r, 0));
const clone = v => JSON.parse(JSON.stringify(v));

function listeners() {
  const map = new Map();
  return {
    add: (type, fn) => { if (!map.has(type)) map.set(type, new Set()); map.get(type).add(fn); },
    remove: (type, fn) => map.get(type)?.delete(fn),
    fire: (type, e) => { for (const fn of [...(map.get(type) || [])]) fn(e); },
  };
}
function classes() { const s = new Set(); return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c) }; }

function shell({ on = true } = {}) {
  const ev = listeners(), log = [];
  const g = { setTimeout, clearTimeout, crypto: globalThis.crypto, JSON, console, Promise, Object, String, Map, Set };
  g.window = g; g.top = g; g.URL = URL; g.location = { href: ORIGIN + '/wizard-os-home/', origin: ORIGIN };
  g.WizShellBoundary = on ? { on: true } : undefined;
  g.addEventListener = ev.add; g.removeEventListener = ev.remove;
  g.document = { activeElement: null };
  g.WizAppearance = { sync: () => log.push('appearance-sync') };
  vm.createContext(g);
  vm.runInContext(SHELL_SRC, g);
  return { g, ev, log, B: g.WizBrowserBoundary };
}

// An app document inside a frame. sandbox: the attribute value (null = no sandbox attribute).
function frame(sh, { sandbox = 'allow-scripts allow-forms allow-downloads', client = true, mac = false } = {}) {
  const app = listeners(), sent = [], win = { cls: classes() };
  const fev = listeners(), doc = listeners();
  const a = { setTimeout, clearTimeout, crypto: globalThis.crypto, JSON, console, Promise, Object, String, Map, Set, Error };
  a.window = a; a.origin = 'null';
  if (mac) a.navigator = { platform: 'MacIntel' };
  a.location = { origin: ORIGIN, href: ORIGIN + '/notes/' };
  a.addEventListener = app.add; a.removeEventListener = app.remove;
  a.InputEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
  a.document = { activeElement: null, addEventListener: doc.add };
  // App -> shell. Origin is opaque, so the shell sees 'null'; the client must address the shell's real origin.
  a.parent = { postMessage(data, target) {
    sent.push({ data: clone(data), target });
    if (target !== ORIGIN) return;
    queueMicrotask(() => sh.ev.fire('message', { source: a, origin: 'null', data: clone(data) }));
  } };
  // Shell -> app.
  a.postMessage = (data, target) => {
    sh.log.push({ to: 'app', op: data.op, target });
    queueMicrotask(() => app.fire('message', { source: a.parent, origin: ORIGIN, data: clone(data) }));
  };
  vm.createContext(a);
  const attrs = new Map(sandbox === null ? [] : [['sandbox', sandbox]]);
  const el = {
    tagName: 'IFRAME', isConnected: true, contentWindow: a,
    hasAttribute: n => attrs.has(n), getAttribute: n => attrs.get(n) ?? null, setAttribute: (n, v) => attrs.set(n, v),
    addEventListener: fev.add, removeEventListener: fev.remove,
    closest: sel => (sel === '.win' ? { classList: win.cls } : null),
    getClientRects: () => [1],
  };
  if (client) vm.runInContext(CLIENT_SRC, a);
  return { a, el, app, sent, win, doc, load: () => fev.fire('load', {}) };
}

test('off: without the box switch nothing is defined and frames are untouched', () => {
  const sh = shell({ on: false });
  assert.equal(sh.B, undefined);
});

test('a frame shell page never turns the boundary on', () => {
  const ev = listeners();
  const g = { WizShellBoundary: { on: true }, addEventListener: ev.add, document: {} };
  g.window = g; g.top = {};
  vm.createContext(g); vm.runInContext(SHELL_SRC, g);
  assert.equal(g.WizBrowserBoundary, undefined);
});

test('on: frames are sandboxed without same-origin, and only such frames attach', () => {
  const sh = shell();
  assert.equal(sh.B.enabled, true);
  assert.match(sh.B.frameAttributes(), /^sandbox="[^"]*allow-scripts[^"]*"$/);
  assert.doesNotMatch(sh.B.frameAttributes(), /allow-same-origin|allow-top-navigation|allow-popups-to-escape/);
  const same = frame(sh, { sandbox: 'allow-scripts allow-same-origin', client: false });
  sh.B.attach(same.el);
  assert.equal(sh.B.owns(same.el), false, 'a same-origin sandbox is no boundary: not attached');
  // An unsandboxed app page (not one of the shell's own pages) is reloaded sandboxed, then attached.
  const bare = frame(sh, { sandbox: null, client: false });
  bare.a.location.pathname = '/notes/';
  sh.B.attach(bare.el);
  assert.equal(bare.el.getAttribute('sandbox'), 'allow-scripts allow-forms allow-downloads');
  assert.equal(sh.B.owns(bare.el), true);
  const f = frame(sh, { client: false });
  sh.B.attach(f.el);
  assert.equal(sh.B.owns(f.el), true);
});

test('hello / ready on a per-load channel; the theme follows and is acked', async () => {
  const sh = shell(), f = frame(sh);
  const applied = [];
  f.a.WizBoundaryClient.connect({ onBack: () => false, onTheme: a => { applied.push(a.revision); return true; } });
  sh.B.attach(f.el);
  await tick();
  assert.ok(f.a.WizBoundaryClient.ready, 'the client answered a hello');
  assert.ok(sh.log.filter(x => x.to === 'app').every(x => x.target === '*'), 'an opaque frame is addressed with *');
  assert.ok(f.sent.every(m => m.target === ORIGIN), 'the app addresses the shell origin, never *');
  sh.B.theme(f.el, { revision: 7, colorScheme: 'dark' });
  await tick();
  assert.deepEqual(applied, [7]);
  assert.equal(f.win.cls.contains('wz-themed'), true, 'themed only after the app acknowledged the revision');
  // A reload gets a new channel, drops the marker and re-sends the last theme on ready.
  const before = f.sent.filter(m => m.data.op === 'ready').at(-1).data.channel;
  f.load(); assert.equal(f.win.cls.contains('wz-themed'), false);
  await tick();
  const after = f.sent.filter(m => m.data.op === 'ready').at(-1).data.channel;
  assert.notEqual(after, before);
  assert.deepEqual(applied, [7, 7]);
  assert.ok(sh.log.includes('appearance-sync'));
});

test('Back: handled stays in the app, atRoot runs the shell step, a timeout stays put', async () => {
  const sh = shell(), f = frame(sh);
  let canBack = true; const steps = [];
  f.a.WizBoundaryClient.connect({ onBack: () => { if (canBack) { steps.push('app'); return true; } return false; } });
  assert.equal(sh.B.back(f.el, () => steps.push('shell')), 'stay', 'not attached yet');
  sh.B.attach(f.el); await tick();
  assert.equal(sh.B.back(f.el, () => steps.push('shell')), 'pending');
  assert.equal(sh.B.back(f.el, () => steps.push('shell')), 'pending', 'a second press while waiting is not a second step');
  await tick(); await tick();
  assert.deepEqual(steps, ['app']);
  canBack = false;
  sh.B.back(f.el, () => steps.push('shell')); await tick(); await tick();
  assert.deepEqual(steps, ['app', 'shell']);
  // No client answering: the shell never guesses.
  f.a.WizBoundaryClient.connect({});
  sh.B.back(f.el, () => steps.push('shell')); await tick(); await tick();
  assert.deepEqual(steps, ['app', 'shell'], 'refused is neither handled nor at root');
});

test('an app without the client is notReady (the shell keeps its own Back steps)', async () => {
  const sh = shell(), f = frame(sh, { client: false });
  sh.B.attach(f.el); await tick();
  assert.equal(sh.B.back(f.el, () => {}), 'notReady');
});

test('messages from anything but the frame on its current channel are ignored', async () => {
  const sh = shell(), f = frame(sh), other = frame(sh);
  const steps = [];
  f.a.WizBoundaryClient.connect({ onBack: () => false });
  sh.B.attach(f.el); await tick();
  const channel = f.sent.filter(m => m.data.op === 'ready').at(-1).data.channel;
  // A forged reply: same-origin page (origin not null), another window, or a stale channel.
  sh.B.back(f.el, () => steps.push('shell'));
  const id = sh.log.length; // the back ask went out; forge answers before the real one lands
  sh.ev.fire('message', { source: f.a, origin: ORIGIN, data: { type: 'wizard:boundary', version: 1, channel, op: 'ready' } });
  sh.ev.fire('message', { source: other.a, origin: 'null', data: { type: 'wizard:boundary', version: 1, channel, op: 'reply', id: 'wb-1', status: 'atRoot' } });
  sh.ev.fire('message', { source: f.a, origin: 'null', data: { type: 'wizard:boundary', version: 1, channel: 'old', op: 'reply', id: 'wb-1', status: 'atRoot' } });
  assert.ok(id > 0);
  await tick(); await tick();
  assert.deepEqual(steps, ['shell'], 'only the real answer (atRoot from the app itself) counted, once');
  // The client ignores a hello that is not from its parent at the shell origin.
  const c = frame(sh);
  c.app.fire('message', { source: {}, origin: ORIGIN, data: { type: 'wizard:boundary', version: 1, op: 'hello', channel: 'x' } });
  c.app.fire('message', { source: c.a.parent, origin: 'https://evil.example', data: { type: 'wizard:boundary', version: 1, op: 'hello', channel: 'x' } });
  assert.equal(c.a.WizBoundaryClient.ready, false);
});

test('field insertion: pinned field gets the text once, a field typed in meanwhile is stale', async () => {
  const sh = shell(), f = frame(sh);
  f.a.WizBoundaryClient.connect({ onBack: () => false });
  const input = (value = 'hello', at = 5) => {
    const ev = listeners(), el = { isConnected: true, value, selectionStart: at, selectionEnd: at, disabled: false, readOnly: false,
      matches: () => true, closest: () => null, addEventListener: ev.add, removeEventListener: ev.remove,
      setRangeText(t, s, e) { this.value = this.value.slice(0, s) + t + this.value.slice(e); }, dispatchEvent: e => ev.fire(e.type, e), fire: ev.fire };
    return el;
  };
  sh.B.attach(f.el); await tick();
  const el = input(); f.a.document.activeElement = el;
  assert.equal(await sh.B.pinField(f.el), null, 'only the focused frame');
  sh.g.document.activeElement = f.el;
  const pin = await sh.B.pinField(f.el);
  assert.ok(pin);
  assert.equal(await pin.insert('world'), true);
  assert.equal(el.value, 'hello world');
  assert.equal(await pin.insert('again'), false, 'one insert per pin');
  const el2 = input('abc', 3); f.a.document.activeElement = el2;
  const pin2 = await sh.B.pinField(f.el);
  el2.value = 'abcd'; el2.fire('input', {});
  assert.equal(await pin2.insert('x'), false);
  assert.equal(el2.value, 'abcd');
});

test('client requests: only the served methods, and it waits for the first hello', async () => {
  const sh = shell(), f = frame(sh);
  f.a.WizBoundaryClient.connect({ onBack: () => false });
  await assert.rejects(f.a.WizBoundaryClient.request('capture.pending', {}), e => e.code === 'unavailable');
  const r = f.a.WizBoundaryClient.request('ready', null, 2000);
  sh.B.attach(f.el);
  assert.deepEqual(clone(await r), { version: 1, hosted: true });
});

test('badge and title bar: served by the one registered server; taps come back; a reload clears and the app re-sends', async () => {
  const sh = shell(), f = frame(sh);
  const taps = [], calls = [], resets = [];
  f.a.WizBoundaryClient.connect({ onBack: () => false, onTool: d => taps.push(clone(d)) });
  sh.B.attach(f.el);
  await tick();
  // No server yet: closed like any other service.
  await assert.rejects(f.a.WizBoundaryClient.request('badge.set', { n: 1 }, 2000), e => e.code === 'unavailable');
  assert.equal(sh.B.serve((el, method, args) => { calls.push([el === f.el, method, clone(args)]); if (args?.bad) throw new Error('Invalid title-bar tool'); return method === 'titlebar.set' ? true : { leak: 1 }; }), true);
  assert.equal(sh.B.serve(() => true), false, 'only one server, registered once');
  sh.B.onReset(el => resets.push(el === f.el));
  assert.equal(await f.a.WizBoundaryClient.request('badge.set', { n: 3 }, 2000), null, 'only a boolean ever crosses back');
  assert.equal(await f.a.WizBoundaryClient.request('titlebar.set', { tools: [{ id: 'older', kind: 'button' }] }, 2000), true);
  await assert.rejects(f.a.WizBoundaryClient.request('titlebar.set', { bad: true }, 2000), e => e.code === 'refused' && /Invalid/.test(e.message));
  await assert.rejects(f.a.WizBoundaryClient.request('identity.info', {}, 2000), e => e.code === 'unavailable');
  // Sharing out needs the browser's transient user activation (a real tap in the app); this shell has none.
  await assert.rejects(f.a.WizBoundaryClient.request('share.text', { text: 'x' }, 2000), e => e.code === 'refused' && /tap/.test(e.message));
  assert.deepEqual(calls.map(c => c.slice(0, 2)), [[true, 'badge.set'], [true, 'titlebar.set'], [true, 'titlebar.set']]);
  // A tap: only to this frame, only on its current channel, only a tool id (and a picker value).
  assert.equal(sh.B.tool(f.el, 'older'), true);
  assert.equal(sh.B.tool(f.el, 'date', 'b'), true);
  assert.equal(sh.B.tool(f.el, 'Not An Id'), false);
  await tick();
  assert.deepEqual(taps, [{ id: 'older' }, { id: 'date', value: 'b' }]);
  // A reload: the shell clears that window's tools (reset) and the app sends its last badge and title bar again.
  calls.length = 0; resets.length = 0;
  f.load();
  await tick(); await tick();
  assert.deepEqual(resets, [true]);
  assert.deepEqual(calls.map(c => c[1]).sort(), ['badge.set', 'titlebar.set']);
  const again = calls.find(c => c[1] === 'titlebar.set')[2];
  assert.equal(again.bad, true, 'the last title bar the app asked for');
  assert.equal(again.base, 'https://box.example.ts.net/notes/', 'with the page\'s own address as the base for relative links');
  // A detached frame gets no taps.
  sh.B.attach(f.el)(); assert.equal(sh.B.tool(f.el, 'older'), false);
});

test('wiring: pages load the boundary right after shell-token.js; app frames get the sandbox only when it is on', () => {
  for (const page of ['web/index.html', 'web/desktop.html']) {
    const html = read(page);
    const t = html.indexOf('<script src="core/shell-token.js"></script>'), b = html.indexOf('<script src="core/browser-boundary.js"></script>');
    assert.ok(t > 0 && b > t, page);
    assert.ok(b < html.indexOf('<script src="core/appearance-host.js"></script>') && b < html.indexOf('<script src="core/app-services.js"></script>'), page);
  }
  const gate = v => "${window.WizBrowserBoundary?.enabled ? ' ' + window.WizBrowserBoundary.frameAttributes(" + v + ") : ''}";
  assert.ok(read('web/app.js').includes('<iframe class="appframe"' + gate('frameUrl')), 'phone app frames');
  assert.ok(read('web/desktop/desktop.js').includes(`<iframe data-own-app="\${esc(a.id || '')}"` + gate('url')), 'desktop app frames');
  const services = read('web/core/app-services.js');
  assert.match(services, /if \(window\.WizBrowserBoundary\?\.owns\(frame\)\) return window\.WizBrowserBoundary\.back\(frame, onRoot\);/);
  assert.match(services, /window\.WizBrowserBoundary\?\.enabled \? window\.WizBrowserBoundary\.attach\(frame\) : null/);
  const client = read('web/core/app-client.js');
  assert.match(client, /const opaque = framed && globalThis\.origin === 'null';/);
  assert.match(client, /\/wizard-os-home\/core\/browser-boundary-client\.js/);
});

// A text input inside the app document (the fake client document).
function appInput(value = 'hello', at = value.length) {
  const ev = listeners();
  return { isConnected: true, value, selectionStart: at, selectionEnd: at, disabled: false, readOnly: false,
    matches: () => true, closest: () => null, addEventListener: ev.add, removeEventListener: ev.remove,
    setRangeText(t, s, e) { this.value = this.value.slice(0, s) + t + this.value.slice(e); }, dispatchEvent: e => ev.fire(e.type, e), fire: ev.fire };
}
// The shell's shared dictation (core/focused-field.js) wired to the boundary, the way app.js / desktop.js create it.
function shellFields(sh, frames, admit = () => true) {
  vm.runInContext(FIELD_SRC, sh.g);
  const top = { activeElement: null, location: { href: 'https://box/' }, addEventListener() {},
    defaultView: { addEventListener() {}, MutationObserver: class { observe() {} } } };
  sh.g.document = top;
  const changes = [];
  const F = sh.g.WizCore.focusedField.create({ document: top, frames, admit, onChange: c => changes.push(!!c), boundary: () => sh.B });
  return { F, top, changes };
}

test('dictation: a sandboxed app reports field focus as one boolean; the orb offers dictation and the words land', async () => {
  const sh = shell(), f = frame(sh);
  f.a.WizBoundaryClient.connect({ onBack: () => false });
  sh.B.attach(f.el); await tick();
  const { F, top, changes } = shellFields(sh, () => [f.el]);
  top.activeElement = f.el;
  assert.equal(F.refresh(), null, 'no field focused in the app yet');
  const el = appInput('note'); f.a.document.activeElement = el;
  f.doc.fire('focusin', {}); await tick();
  const report = f.sent.filter(m => m.data.op === 'field.focus').at(-1).data;
  assert.deepEqual(Object.keys(report).sort(), ['channel', 'editable', 'op', 'type', 'version'], 'only a boolean leaves the app');
  assert.equal(report.editable, true);
  assert.equal(changes.at(-1), true, 'the shell repainted on the app report');
  assert.equal(F.current.remote, true);
  // The orb takes the press (keyboard focus on a shell control): the remembered field still counts.
  const seal = F.capture();
  assert.ok(seal && seal.remote);
  const done = F.insert(seal, 'world');
  seal.release(); // callers release right after insert; a sandboxed insert finishes first
  assert.equal(await done, true);
  assert.equal(el.value, 'note world');
  assert.equal(await F.insert(seal, 'again'), false, 'one insert per seal');
});

test('dictation: a reload, a field typed in meanwhile, or an unadmitted window never gets the words', async () => {
  const sh = shell(), f = frame(sh);
  f.a.WizBoundaryClient.connect({ onBack: () => false });
  sh.B.attach(f.el); await tick();
  let admitted = true;
  const { F, top } = shellFields(sh, () => [f.el], () => admitted);
  top.activeElement = f.el;
  let el = appInput('a'); f.a.document.activeElement = el; f.doc.fire('focusin', {}); await tick();
  // Typed in meanwhile: stale.
  let seal = F.capture(); await seal.pin; el.value = 'ab'; el.fire('input', {});
  assert.equal(await F.insert(seal, 'x'), false); assert.equal(el.value, 'ab');
  // The app document reloads: the seal belongs to the old document.
  el = appInput('c'); f.a.document.activeElement = el; f.doc.fire('focusin', {}); await tick();
  seal = F.capture(); f.load(); await tick();
  assert.equal(await F.insert(seal, 'x'), false); assert.equal(el.value, 'c');
  // Another window has focus now (admit says no).
  f.doc.fire('focusin', {}); await tick();
  seal = F.capture(); admitted = false;
  assert.equal(await F.insert(seal, 'x'), false); assert.equal(el.value, 'c');
  admitted = true;
  // Focus left the app's field: nothing to dictate into.
  f.a.document.activeElement = null; f.doc.fire('focusin', {}); await tick();
  assert.equal(F.refresh(), null);
  // Another frame has the focus: it never borrows this frame's field.
  f.a.document.activeElement = el; f.doc.fire('focusin', {}); await tick();
  top.activeElement = { tagName: 'IFRAME' };
  assert.equal(await sh.B.pinField(f.el), null);
});

test('dictation wiring: phone and desktop await the insert (a sandboxed insert answers later)', () => {
  assert.match(read('web/app.js'), /const inserted = await FIELDS\.insert\(target, text\);/);
  assert.match(read('web/desktop/desktop.js'), /if \(await fields\(\)\.insert\(target, text\)\)/);
});

// Desktop keys and clicks from a sandboxed app (Esc, ⌥ chords, click-to-focus).
function keyEvent(init) {
  const e = { altKey: false, shiftKey: false, metaKey: false, ctrlKey: false, repeat: false, isComposing: false, keyCode: 0, ...init, prevented: false, stopped: false };
  e.preventDefault = () => { e.prevented = true; }; e.stopImmediatePropagation = () => { e.stopped = true; };
  return e;
}
async function keyed({ activation = true, mac = false } = {}) {
  const sh = shell(), f = frame(sh, { mac }), got = [];
  sh.g.navigator = { userActivation: { isActive: activation } };
  sh.g.document.activeElement = f.el; sh.g.document.hasFocus = () => true;
  sh.B.keys(['KeyN', 'KeyW', 'Minus', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Digit1']);
  sh.B.onInput((fr, ev) => got.push({ same: fr === f.el, ...ev }));
  f.a.WizBoundaryClient.connect({});
  sh.B.attach(f.el); await tick();
  return { sh, f, got, press: async (init, type = 'keydown') => { const e = keyEvent(init); f.app.fire(type, e); await tick(); await tick(); return e; } };
}

test('keys: Esc and the named ⌥ codes are taken from the app page and reach the shell; other keys never leave the app', async () => {
  const { f, got, press } = await keyed();
  const esc = await press({ key: 'Escape', code: 'Escape' });
  assert.equal(esc.prevented && esc.stopped, true, 'Esc is the shell\'s Back, as before the boundary');
  const n = await press({ key: '˜', code: 'KeyN', altKey: true });
  assert.equal(n.prevented, true, '⌥N is the shell\'s: the app page never types its dead key');
  const e = await press({ key: '´', code: 'KeyE', altKey: true });
  assert.equal(e.prevented, false, 'an unnamed ⌥ letter stays the app\'s alone (accents, the app\'s own ⌥ keys)');
  const plain = await press({ key: 'a', code: 'KeyA' });
  const cmd = await press({ key: 'w', code: 'KeyW', metaKey: true });
  assert.equal(plain.prevented || cmd.prevented, false);
  assert.deepEqual(got.map(x => [x.type, x.code, x.same]), [['keydown', 'Escape', true], ['keydown', 'KeyN', true]]);
  assert.ok(f.sent.every(m => m.data.op !== 'input' || !['KeyA', 'KeyE', 'KeyW'].includes(m.data.code)), 'plain, unnamed and ⌘ keys are never posted');
  await press({ key: 'Alt', code: 'AltLeft', altKey: false }, 'keyup');
  assert.deepEqual(got.at(-1), { same: true, kind: 'key', type: 'keyup', key: 'Alt', code: 'AltLeft', altKey: false, shiftKey: false, metaKey: false, ctrlKey: false, repeat: false, field: false, readOnly: false });
});

test('keys: word moves and Mac ⌥- in a text field stay the field\'s; the field flag says only that', async () => {
  const { f, got, press } = await keyed();
  f.a.document.activeElement = { tagName: 'TEXTAREA', readOnly: false };
  const left = await press({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true });
  const sel = await press({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true, shiftKey: true });
  const up = await press({ key: 'ArrowUp', code: 'ArrowUp', altKey: true });
  assert.deepEqual([left.prevented, sel.prevented, up.prevented], [false, false, true]);
  assert.equal((await press({ key: '–', code: 'Minus', altKey: true })).prevented, true, 'off a Mac ⌥- is the shell\'s narrower');
  assert.deepEqual(got.map(x => x.code), ['ArrowUp', 'Minus'], 'only the keys the shell takes are posted');
  assert.equal(got.at(-1).field, true);
  assert.equal(Object.keys(got.at(-1)).some(k => /value|text|name|id/i.test(k)), false);
  const mac = await keyed({ mac: true });
  mac.f.a.document.activeElement = { tagName: 'INPUT', type: 'text', readOnly: false };
  assert.equal((await mac.press({ key: '–', code: 'Minus', altKey: true })).prevented, false, 'on a Mac ⌥- types – in the field');
  mac.f.a.document.activeElement = { tagName: 'INPUT', type: 'text', readOnly: true };
  assert.equal((await mac.press({ key: '–', code: 'Minus', altKey: true })).prevented, true, 'a read-only field types nothing');
  assert.equal(mac.got.at(-1).readOnly, true);
});

test('keys: without a real keypress (user activation) or focus, posted ⌥ keys and clicks are ignored; Esc and bare ⌥ need focus only', async () => {
  const { sh, f, got, press } = await keyed({ activation: false });
  await press({ key: '˜', code: 'KeyN', altKey: true });
  f.app.fire('pointerdown', {}); await tick(); await tick();
  assert.deepEqual(got, [], 'a page posting messages cannot drive ⌥N or focus');
  await press({ key: 'Escape', code: 'Escape' });
  await press({ key: 'Alt', code: 'AltLeft', altKey: true });
  assert.deepEqual(got.map(x => x.code), ['Escape', 'AltLeft']);
  sh.g.navigator.userActivation.isActive = true;
  f.app.fire('pointerdown', {}); await tick(); await tick();
  assert.equal(got.at(-1).kind, 'pointer');
  sh.g.document.activeElement = {};
  await press({ key: 'Escape', code: 'Escape' });
  assert.equal(got.at(-1).kind, 'pointer', 'a frame without focus gets no keys');
  // A forged input from another window, or a ⌘ chord dressed up as a shell key, is dropped.
  sh.g.document.activeElement = f.el;
  const channel = f.sent.filter(m => m.data.op === 'ready').at(-1).data.channel;
  const other = frame(sh, { client: false });
  sh.ev.fire('message', { source: other.a, origin: 'null', data: { type: 'wizard:boundary', version: 1, channel, op: 'input', kind: 'key', event: 'keydown', key: 'Escape', code: 'Escape' } });
  sh.ev.fire('message', { source: f.a, origin: 'null', data: { type: 'wizard:boundary', version: 1, channel, op: 'input', kind: 'key', event: 'keydown', key: 'w', code: 'KeyW', metaKey: true } });
  // With activation, a made-up ⌥ chord the shell did not name (⌥V: a new voice chat) is still refused.
  sh.ev.fire('message', { source: f.a, origin: 'null', data: { type: 'wizard:boundary', version: 1, channel, op: 'input', kind: 'key', event: 'keydown', key: '√', code: 'KeyV', altKey: true } });
  assert.equal(got.at(-1).kind, 'pointer');
});

test('keys: the claimed list reaches an app that is already connected', async () => {
  const { sh, press } = await keyed();
  assert.equal((await press({ key: 'Ω', code: 'KeyZ', altKey: true })).prevented, false);
  sh.B.keys(['KeyZ']); await tick();
  assert.equal((await press({ key: 'Ω', code: 'KeyZ', altKey: true })).prevented, true);
});

test('on: the shell\'s own pages (Store, Agents, Setup) stay same-origin; every other frame is sandboxed', () => {
  const sh = shell();
  for (const url of ['/wizard-os-home/store/index.html', '/wizard-os-home/store/index.html?app=notes', '/wizard-os-home/agents/index.html', '/wizard-os-home/setup/index.html', '/wizard-ux/setup/'])
    assert.equal(sh.B.frameAttributes(url), '', url);
  for (const url of ['/notes/', '/troubleshoot/', '/wizard-os-home/index.html', '/wizard-os-home/store/evil.html', 'https://evil.example/wizard-os-home/store/index.html', '/pages/store/index.html', undefined])
    assert.match(sh.B.frameAttributes(url), /^sandbox="allow-scripts allow-forms allow-downloads"$/, String(url));
});

test('on: an unsandboxed shell frame that lands on any other same-origin page is reloaded sandboxed', () => {
  const sh = shell();
  const listeners = new Map(), attrs = new Map();
  const loc = { href: 'about:blank', origin: 'null', pathname: 'blank' };
  const el = {
    tagName: 'IFRAME', isConnected: true, src: '/wizard-os-home/store/index.html',
    contentWindow: { get location() { return loc; }, postMessage() {} },
    hasAttribute: n => attrs.has(n), getAttribute: n => attrs.get(n) ?? null, setAttribute: (n, v) => attrs.set(n, v),
    addEventListener: (n, fn) => listeners.set(n, (listeners.get(n) || []).concat(fn)), removeEventListener() {},
    closest: () => null, getClientRects: () => [1],
  };
  const fire = () => { for (const fn of listeners.get('load') || []) fn({}); };
  const origin = sh.g.location.origin;
  sh.B.attach(el);
  assert.equal(attrs.has('sandbox'), false, 'about:blank is left alone');
  Object.assign(loc, { href: origin + '/wizard-os-home/store/index.html', origin, pathname: '/wizard-os-home/store/index.html' }); fire();
  assert.equal(attrs.has('sandbox'), false, 'the Store stays same-origin');
  Object.assign(loc, { href: 'https://other.example/x', origin: 'https://other.example', pathname: '/x' }); fire();
  assert.equal(attrs.has('sandbox'), false, 'another site cannot reach the shell: left alone');
  Object.assign(loc, { href: origin + '/notes/', origin, pathname: '/notes/' }); fire();
  assert.equal(attrs.get('sandbox'), 'allow-scripts allow-forms allow-downloads');
  assert.equal(el.src, origin + '/notes/', 'reloaded, now sandboxed');
  assert.equal(sh.B.owns(el), true, 'and on the boundary channel like any app frame');
});

test('on: the disposer of a guarded shell window also ends the session the guard started later', () => {
  const sh = shell();
  const attrs = new Map(), listeners = new Set();
  const origin = sh.g.location.origin;
  const loc = { href: origin + '/wizard-os-home/agents/index.html', origin, pathname: '/wizard-os-home/agents/index.html' };
  const el = {
    tagName: 'IFRAME', isConnected: true, src: loc.href,
    contentWindow: { get location() { return loc; }, postMessage() {} },
    hasAttribute: n => attrs.has(n), getAttribute: n => attrs.get(n) ?? null, setAttribute: (n, v) => attrs.set(n, v),
    addEventListener: (n, fn) => listeners.add(fn), removeEventListener: (n, fn) => listeners.delete(fn),
    closest: () => null, getClientRects: () => [1],
  };
  const dispose = sh.B.attach(el);
  assert.equal(sh.B.attach(el), dispose, 'one guard per window');
  Object.assign(loc, { href: origin + '/notes/', pathname: '/notes/' });
  for (const fn of [...listeners]) fn({});
  assert.equal(sh.B.owns(el), true);
  dispose();
  assert.equal(sh.B.owns(el), false, 'closing the window lets go of its session');
  assert.equal(listeners.size, 0, 'and of every load listener');
});

test('share and transcription: async answers are protocol data only, share needs a tap, a reload drops the answer', async () => {
  const sh = shell(), f = frame(sh);
  f.a.WizBoundaryClient.connect({ onBack: () => false });
  sh.B.attach(f.el);
  await tick();
  const calls = [], later = [];
  sh.B.serve((el, method, args) => {
    calls.push([method, clone({ ...args, file: undefined })]);
    if (method === 'voice.transcribe') return args.slow ? new Promise(r => later.push(r)) : Promise.resolve({ text: 'hello', provider: 'secret', key: 'k' });
    if (method === 'share.text') return Promise.resolve('shared');
    if (method === 'share.file') return Promise.reject(new Error('Share failed'));
    return true;
  });
  assert.deepEqual(clone(await f.a.WizBoundaryClient.request('voice.transcribe', { language: 'en' }, 2000)), { text: 'hello' }, 'only the transcript crosses back');
  // No activation API or no tap: refused before the server sees it.
  await assert.rejects(f.a.WizBoundaryClient.request('share.text', { text: 'a' }, 2000), e => e.code === 'refused');
  assert.equal(calls.some(c => c[0] === 'share.text'), false);
  sh.g.navigator = { userActivation: { isActive: true } };
  // A tap elsewhere in the shell activates it too, but this frame does not have focus then.
  await assert.rejects(f.a.WizBoundaryClient.request('share.text', { text: 'a' }, 2000), e => e.code === 'refused');
  assert.equal(calls.some(c => c[0] === 'share.text'), false);
  sh.g.document.activeElement = f.el;
  assert.equal(await f.a.WizBoundaryClient.request('share.text', { text: 'a' }, 2000), 'shared');
  assert.equal(calls.at(-1)[1].base, 'https://box.example.ts.net/notes/', 'the page\'s own address for a relative link');
  await assert.rejects(f.a.WizBoundaryClient.request('share.file', { options: {} }, 2000), e => e.code === 'refused' && /Share failed/.test(e.message));
  // At most 4 at once per window.
  const slow = [1, 2, 3, 4].map(() => f.a.WizBoundaryClient.request('voice.transcribe', { slow: true }, 2000));
  await tick(); await tick();
  await assert.rejects(f.a.WizBoundaryClient.request('voice.transcribe', {}, 2000), e => e.code === 'busy');
  // The window loads a new document before the answer: the answer is not sent to it.
  const old = later.splice(0), sent = sh.log.length;
  f.load(); await tick(); await tick();
  for (const r of old) r({ text: 'old channel' });
  await tick(); await tick();
  assert.equal(sh.log.slice(sent).filter(m => m.op === 'service.reply').length, 0, 'no answer on the new channel for the old one');
  // The same document asks again on its new channel (the client re-sends open requests), within a fresh in-flight count.
  assert.equal(later.length, 4);
  for (const r of later) r({ text: 'new channel' });
  assert.deepEqual((await Promise.all(slow)).map(clone), [1, 2, 3, 4].map(() => ({ text: 'new channel' })));
});

test('share to Wizard needs a tap in the window; update holds are placed again on every new channel', async () => {
  const sh = shell(), f = frame(sh);
  f.a.WizBoundaryClient.connect({ onBack: () => false });
  sh.B.attach(f.el);
  await tick();
  const calls = []; let n = 0; const held = new Set();
  sh.B.serve((el, method, args) => {
    calls.push([method, clone(args)]);
    if (method === 'share.wizard') return Promise.resolve('sent');
    if (method === 'update.hold') { const id = 'as-' + (++n); held.add(id); return id; }
    if (method === 'update.release') return held.delete(args.id);
    return true;
  });
  sh.B.onReset(() => held.clear());
  // Share to Wizard opens a shell sheet: no tap, refused before the server sees it.
  await assert.rejects(f.a.WizBoundaryClient.request('share.wizard', { text: 'a' }, 2000), e => e.code === 'refused' && /tap/.test(e.message));
  assert.equal(calls.some(c => c[0] === 'share.wizard'), false);
  sh.g.navigator = { userActivation: { isActive: true } }; sh.g.document.activeElement = f.el;
  assert.equal(await f.a.WizBoundaryClient.request('share.wizard', { text: 'a' }, 2000), 'sent');
  // A hold: the app gets its own id; the shell's id stays inside the client.
  const h = await f.a.WizBoundaryClient.request('update.hold', { reason: 'Unsaved note', keepId: 'keep-1' }, 2000);
  assert.match(h, /^hold-/); assert.deepEqual([...held], ['as-1']);
  assert.equal(calls.at(-1)[1].keepId, undefined, 'no keep callback id crosses');
  // The shell loads the window again (a new channel) and drops its holds; the same document places its hold again.
  sh.B.attach(f.el); f.load(); await tick(); await tick(); await tick();
  assert.deepEqual([...held], ['as-2']);
  // Releasing the app's id lets go of the shell's current one.
  assert.equal(await f.a.WizBoundaryClient.request('update.release', { id: h }, 2000), true);
  await tick(); await tick();
  assert.deepEqual([...held], []);
  assert.equal(await f.a.WizBoundaryClient.request('update.release', { id: h }, 2000), false, 'only once');
  // Released while the hold is being placed again on a new channel: the shell's id is let go as soon as it arrives.
  const id = await f.a.WizBoundaryClient.request('update.hold', { reason: 'x' }, 2000);
  assert.equal(held.size, 1);
  f.load(); await tick(); await tick();
  const placing = calls.filter(c => c[0] === 'update.hold').length;
  await f.a.WizBoundaryClient.request('update.release', { id }, 2000);
  for (let i = 0; i < 6; i++) await tick();
  assert.ok(calls.filter(c => c[0] === 'update.hold').length >= placing);
  assert.deepEqual([...held], []);
});
