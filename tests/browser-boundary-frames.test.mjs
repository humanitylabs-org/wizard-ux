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

test('skin layer: the shell\'s skin stylesheets and My skin travel with the theme, also again after a reload', async () => {
  const sh = shell(), f = frame(sh);
  const got = [];
  f.a.WizBoundaryClient.connect({ onBack: () => false, onTheme: (a, layer) => { got.push(clone(layer)); return true; } });
  sh.B.attach(f.el);
  await tick();
  const layer = { sheets: ['/wizard-os-home/core/skins.css', '/wizard-os-home/skins/grove/skin.css?v=3'], mine: '.wz-btn{border-radius:0}' };
  sh.B.theme(f.el, { revision: 3, colorScheme: 'dark' }, layer);
  await tick();
  assert.deepEqual(got, [layer]);
  f.load(); await tick();
  assert.deepEqual(got, [layer, layer], 'a reloaded app gets the same layer with the theme');
  sh.B.theme(f.el, { revision: 4, colorScheme: 'dark' });
  await tick();
  assert.equal(got.at(-1), null, 'no layer sent means none');
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
  await assert.rejects(f.a.WizBoundaryClient.request('orb.set', {}), e => e.code === 'unavailable');
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
  await assert.rejects(f.a.WizBoundaryClient.request('orb.set', {}, 2000), e => e.code === 'unavailable');
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

test('layout keys: a running layout adds its own ⌥ window keys; they reach the shell only with a real keypress, and off() gives them back', async () => {
  const { sh, f, got, press } = await keyed();
  assert.equal((await press({ key: '˙', code: 'KeyH', altKey: true })).prevented, false, 'without a layout ⌥H stays the app\'s');
  const off = sh.B.layoutKeys(['KeyH', 'KeyK', 42, 'x'.repeat(40)]); await tick();
  const h = await press({ key: '˙', code: 'KeyH', altKey: true });
  assert.equal(h.prevented && h.stopped, true, '⌥H is the view\'s Home: the app page never sees it');
  assert.equal((await press({ key: '˚', code: 'KeyK', altKey: true })).prevented, true);
  assert.equal((await press({ key: '¬', code: 'KeyL', altKey: true })).prevented, false, 'a code nobody named stays the app\'s');
  assert.deepEqual(got.map(x => x.code), ['KeyH', 'KeyK']);
  got.length = 0;
  // The desktop renaming its own list keeps the layout's.
  assert.equal((await press({ key: '˜', code: 'KeyN', altKey: true })).prevented, true, 'the desktop\'s own keys still come across');
  sh.B.keys(['Digit2']); await tick();
  assert.equal((await press({ key: '˜', code: 'KeyN', altKey: true })).prevented, false);
  assert.equal((await press({ key: '˙', code: 'KeyH', altKey: true })).prevented, true, 'the layout\'s stay');
  // A page posting ⌥H without a real keypress is dropped like any other named key.
  sh.g.navigator.userActivation.isActive = false;
  const channel = f.sent.filter(m => m.data.op === 'ready').at(-1).data.channel;
  sh.ev.fire('message', { source: f.a, origin: 'null', data: { type: 'wizard:boundary', version: 1, channel, op: 'input', kind: 'key', event: 'keydown', key: '˙', code: 'KeyH', altKey: true } });
  await tick();
  assert.deepEqual(got.map(x => x.code), ['KeyN', 'KeyH']);
  sh.g.navigator.userActivation.isActive = true;
  off(); off(); await tick();
  assert.equal((await press({ key: '˙', code: 'KeyH', altKey: true })).prevented, false, 'the layout gone (Classic): ⌥H is the app\'s again');
  assert.equal((await press({ key: '…', code: 'Digit2', altKey: true })).prevented, true, 'a second off() never drops the desktop\'s keys');
  assert.deepEqual(got.map(x => x.code), ['KeyN', 'KeyH', 'Digit2']);
});

test('layout keys wiring: the AI apps view takes its own window keys from a sandboxed app while it runs, never voice, send or chat keys', async () => {
  const layout = read('web/layouts/ai-apps/desktop.js');
  assert.match(layout, /const offFrameKeys = globalThis\.WizBrowserBoundary\?\.layoutKeys\?\.\(FRAME_KEYS\) \|\| null;/);
  assert.match(layout, /return \(\) => \{\n    offAppKeys\?\.\(\);\n    offFrameKeys\?\.\(\);/, 'the view lets go when it is torn down');
  const keys = JSON.parse(/export const FRAME_KEYS = Object\.freeze\((\[[^\]]*\])\)/.exec(layout)[1].replace(/'/g, '"'));
  assert.ok(keys.includes('KeyH') && keys.includes('KeyK'), '⌥H Home and ⌥K search come across');
  for (const k of ['KeyN', 'KeyS', 'KeyW', 'KeyD', 'KeyV', 'KeyC', 'Space', 'KeyE', 'KeyX', 'KeyZ', 'KeyB', 'KeyP', 'ArrowUp', 'ArrowDown', 'KeyU', 'KeyI'])
    assert.equal(keys.includes(k), false, k + ' stays the app\'s while it has the keyboard');
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

// Slice 19: the shell's notices (update ready, read your data again) reach a sandboxed app on its channel only.
test('notices: update and refresh reach the ready app on its current channel, as protocol data only', async () => {
  const sh = shell(), f = frame(sh);
  const updates = [], refreshes = [];
  f.a.WizBoundaryClient.connect({ onBack: () => false, onUpdate: v => updates.push(v), onRefresh: r => refreshes.push(r) });
  assert.equal(sh.B.notice(f.el, 'update', { available: { version: 'v:1' } }), false, 'not attached: nothing');
  sh.B.attach(f.el);
  assert.equal(sh.B.notice(f.el, 'refresh', { reason: 'poll' }), false, 'not ready yet: nothing');
  await tick(); await tick();
  assert.equal(sh.B.notice(f.el, 'update', { available: { version: 'v:1', changes: [{ thread: 'private' }] } }), true);
  assert.equal(sh.B.notice(f.el, 'refresh', { reason: 'agent' }), true);
  assert.equal(sh.B.notice(f.el, 'refresh', { reason: 'javascript:1' }), false, 'unknown reason');
  assert.equal(sh.B.notice(f.el, 'open', {}), false, 'unknown notice');
  await tick(); await tick();
  assert.deepEqual(clone(updates), [{ version: 'v:1' }], 'only the version crosses');
  assert.deepEqual(refreshes, ['agent']);
  // A message on an old channel, or from another window, is ignored by the client.
  const stale = { type: 'wizard:boundary', version: 1, channel: 'old', op: 'notice', kind: 'refresh', reason: 'poll' };
  f.app.fire('message', { source: f.a.parent, origin: ORIGIN, data: stale });
  const cur = f.sent.findLast(s => s.data.op === 'ready').data.channel;
  f.app.fire('message', { source: {}, origin: ORIGIN, data: { ...stale, channel: cur } });
  f.app.fire('message', { source: f.a.parent, origin: 'https://evil.example', data: { ...stale, channel: cur } });
  assert.deepEqual(refreshes, ['agent']);
  assert.ok(sh.log.filter(l => l.to === 'app').every(l => l.target === '*'));
});

// Slice 20: receiving shares. The app registers and pulls for its own window; a waiting share is announced on its
// channel; a pending item crosses as its own share fields only.
test('receiving shares: served methods, item fields only, and a share notice that makes the app pull', async () => {
  const sh = shell(), f = frame(sh);
  const shares = [];
  f.a.WizBoundaryClient.connect({ onBack: () => false, onShare: () => shares.push('pull') });
  sh.B.attach(f.el);
  await tick(); await tick();
  const calls = [];
  sh.B.serve((el, method, args) => {
    calls.push([method, clone(args)]);
    if (method === 'share.pending') return [
      { id: 'sh-1', kind: 'text', text: 'hello', title: 'T', target: 'p1', claim: { owner: 'shell record' }, appId: 'notes', at: 1 },
      { id: 'sh-2', kind: 'script', text: 'x' },
      { kind: 'text', text: 'no id' },
      { id: 'sh-3', kind: 'url', url: 'https://example.com/a', text: 'y'.repeat(200001), size: 3 },
    ];
    return method === 'share.ack' ? args.id === 'sh-1' : true;
  });
  // No tap needed: receiving opens no shell sheet; the app only reads what the owner already sent to it.
  assert.equal(await f.a.WizBoundaryClient.request('share.receive', { accepts: ['text'] }, 2000), true);
  assert.equal(await f.a.WizBoundaryClient.request('share.targets', { targets: [{ id: 'p1', name: 'Ann' }] }, 2000), true);
  assert.deepEqual(clone(await f.a.WizBoundaryClient.request('share.pending', {}, 2000)), [
    { id: 'sh-1', kind: 'text', target: 'p1', text: 'hello', title: 'T' },
    { id: 'sh-3', kind: 'url', target: null, url: 'https://example.com/a', size: 3 },
  ], 'only the item\'s share fields; the shell\'s claim and an unknown kind never cross');
  assert.equal(await f.a.WizBoundaryClient.request('share.ack', { id: 'sh-1' }, 2000), true);
  assert.deepEqual(calls.map(c => c[0]), ['share.receive', 'share.targets', 'share.pending', 'share.ack']);
  assert.equal(sh.B.notice(f.el, 'share'), true);
  await tick(); await tick();
  assert.deepEqual(shares, ['pull']);
  f.load(); // a new channel: the old document's notice target is gone until it answers again
  assert.equal(sh.B.notice(f.el, 'share'), false, 'not ready on the new channel yet: nothing');
});

// Slice 21: Wizard Music ducking and the fingerprint vault cross as protocol data only; vault codes reach the app.
test('duck and vault: served methods, only a secret or saved flags cross back, vault errors keep their code', async () => {
  const sh = shell(), f = frame(sh);
  f.a.WizBoundaryClient.connect({ onBack: () => false });
  sh.B.attach(f.el);
  await tick(); await tick();
  const calls = [];
  sh.B.serve((el, method, args) => {
    calls.push(method);
    if (method === 'audio.duck') return Promise.resolve(args.on === true);
    if (method === 'vault.has') return Promise.resolve({ available: true, saved: true, appId: 'other', path: '/x' });
    if (method === 'vault.open') return args.title === 'no' ? Promise.reject(new Error('vault:cancelled')) : Promise.resolve({ secret: 'fixture-secret', key: 'k' });
    if (method === 'vault.seal') return Promise.resolve({ secret: 'x'.repeat(4097), saved: true });
    return Promise.resolve({ saved: false, extra: 1 });
  });
  const req = (m, a) => f.a.WizBoundaryClient.request(m, a, 2000);
  assert.equal(await req('audio.duck', { on: true }), true);
  assert.deepEqual(clone(await req('vault.has', {})), { available: true, saved: true });
  assert.deepEqual(clone(await req('vault.open', { title: 'Unlock' })), { secret: 'fixture-secret' }, 'only the secret crosses back');
  assert.deepEqual(clone(await req('vault.seal', { secret: 's' })), { saved: true }, 'an over-long secret never crosses');
  assert.deepEqual(clone(await req('vault.forget', {})), { saved: false });
  await assert.rejects(req('vault.open', { title: 'no' }), e => e.message === 'vault:cancelled');
  assert.deepEqual(calls, ['audio.duck', 'vault.has', 'vault.open', 'vault.seal', 'vault.forget', 'vault.open']);
});

// Slice 22: Wizard ID crosses as protocol data only: the owner's public info, a well-formed signed event, a NIP-44
// result, or denied / cancelled / none. Anything else the shell holds stays behind.
test('identity: served methods, only public info, a signed event or a NIP-44 result cross back', async () => {
  const sh = shell(), f = frame(sh);
  f.a.WizBoundaryClient.connect({ onBack: () => false });
  sh.B.attach(f.el);
  await tick(); await tick();
  const ev = { id: 'a'.repeat(64), pubkey: 'b'.repeat(64), created_at: 1700000000, kind: 1, tags: [['p', 'c'.repeat(64)]], content: 'hi', sig: 'd'.repeat(128) };
  const calls = [];
  sh.B.serve((el, method, args) => {
    calls.push(method);
    if (method === 'identity.info') return Promise.resolve({ npub: 'npub1x', pubkey: 'b'.repeat(64), name: 'Owner', backed_up: false, nsec: 'never' });
    if (method === 'identity.sign') return Promise.resolve(args.event.kind === 2 ? { denied: true, why: 'x' } : args.event.kind === 3 ? { ...ev, sig: 'zz' } : { ...ev, requester: 'Notes' });
    if (method === 'identity.nip44_encrypt') return Promise.resolve({ ciphertext: 'Aq==', key: 'k' });
    return Promise.resolve({ plaintext: 'hello', shared: 'k' });
  });
  const req = (m, a) => f.a.WizBoundaryClient.request(m, a, 2000);
  assert.deepEqual(clone(await req('identity.info', {})), { npub: 'npub1x', pubkey: 'b'.repeat(64), name: 'Owner', backed_up: false });
  assert.deepEqual(clone(await req('identity.sign', { event: { kind: 1 } })), ev, 'only the signed event\'s own fields');
  assert.deepEqual(clone(await req('identity.sign', { event: { kind: 2 } })), { denied: true });
  assert.equal(await req('identity.sign', { event: { kind: 3 } }), null, 'a malformed event never crosses');
  assert.deepEqual(clone(await req('identity.nip44_encrypt', { pubkey: 'c'.repeat(64), plaintext: 'hi' })), { ciphertext: 'Aq==' });
  assert.deepEqual(clone(await req('identity.nip44_decrypt', { pubkey: 'c'.repeat(64), ciphertext: 'Aq==' })), { plaintext: 'hello' });
  assert.deepEqual(calls, ['identity.info', 'identity.sign', 'identity.sign', 'identity.sign', 'identity.nip44_encrypt', 'identity.nip44_decrypt']);
});

// Slice 23: recording (capture.*). Preparing needs a tap; the server is told whether a start came with one; the
// recorder's data crosses as plain data only; its events reach the app as `capture` notices.
test('capture: prepare needs a tap, start carries the tap to the server, answers and events are plain data only', async () => {
  const sh = shell(), f = frame(sh), heard = [], hellos = [];
  f.a.WizBoundaryClient.connect({ onBack: () => false, onCapture: d => heard.push(clone(d)), onReady: () => hellos.push(1) });
  sh.B.attach(f.el);
  await tick();
  assert.ok(hellos.length >= 1, 'onReady runs after the hello');
  const calls = [];
  class Shell { constructor() { this.secret = 'shell'; } }
  sh.B.serve((el, method, args, ctx) => {
    calls.push([method, ctx.tapped]);
    if (method === 'capture.start') return Promise.resolve({ capture: { id: 't1', info: { phase: 'recording', durationMs: 5, hook() {}, owner: new Shell() } } });
    if (method === 'capture.prepare') return { capture: { id: 'p1' } };
    return { capture: [{ id: 't0', meta: { a: 1 }, run: () => 1 }] };
  });
  await assert.rejects(f.a.WizBoundaryClient.request('capture.prepare', { opts: {} }, 2000), e => e.code === 'refused' && /Recording needs a tap/.test(e.message));
  assert.equal(calls.length, 0, 'no tap: the server never sees a prepare');
  assert.deepEqual(clone(await f.a.WizBoundaryClient.request('capture.start', { opts: {} }, 2000)), { capture: { id: 't1', info: { phase: 'recording', durationMs: 5 } } },
    'only plain data crosses: no function, no shell object');
  sh.g.navigator = { userActivation: { isActive: true } }; sh.g.document.activeElement = f.el;
  assert.deepEqual(clone(await f.a.WizBoundaryClient.request('capture.prepare', { opts: {} }, 2000)), { capture: { id: 'p1' } });
  await f.a.WizBoundaryClient.request('capture.start', { opts: {} }, 2000);
  assert.deepEqual(clone(await f.a.WizBoundaryClient.request('capture.pending', {}, 2000)), { capture: [{ id: 't0', meta: { a: 1 } }] });
  assert.deepEqual(calls, [['capture.start', false], ['capture.prepare', true], ['capture.start', true], ['capture.pending', true]]);
  assert.equal(sh.B.notice(f.el, 'capture', { id: 't1', event: 'level', value: 0.5 }), true);
  assert.equal(sh.B.notice(f.el, 'capture', { event: 'current', value: { id: 't1', phase: 'recording', fn() {} } }), true);
  assert.equal(sh.B.notice(f.el, 'capture', { id: 't1', event: 'eval', value: 1 }), false, 'unknown event');
  await tick(); await tick();
  assert.deepEqual(heard, [{ event: 'level', id: 't1', value: 0.5 }, { event: 'current', value: { id: 't1', phase: 'recording' } }]);
});

// App keys (data-wz-key) under the boundary: the AI apps view presses an app's own ⌥ keys (wizard-os#133 slice 24).
async function appKeyed() {
  const k = await keyed(), pressed = [];
  const rect = { left: 10, top: 20, width: 30, height: 12 };
  let live = [{ el: { getBoundingClientRect: () => rect }, key: 'j', label: 'Next note' }];
  k.f.a.WizBoundaryClient.connect({ keys: () => live, press: key => { pressed.push(key); return true; } });
  await tick(); await tick();
  return { ...k, pressed, setLive: l => { live = l; } };
}

test('app keys: only while a layout presses them does the app report, hold back and press its own ⌥ keys', async () => {
  const { sh, f, got, press, pressed } = await appKeyed();
  // No layout presses app keys (Classic desktop): ⌥J stays the page's, nothing is reported.
  assert.equal((await press({ key: '∆', code: 'KeyJ', altKey: true })).prevented, false);
  assert.equal(sh.B.appKeys(f.el).length, 0);
  assert.equal(f.sent.some(m => m.data.op === 'keys.app'), false);
  const off = sh.B.pressAppKeys(() => f.el); await tick(); await tick();
  const keys = sh.B.appKeys(f.el);
  assert.deepEqual(clone(keys.map(t => [t.key, t.label])), [['j', 'Next note']]);
  const r = keys[0].el.getBoundingClientRect();
  assert.deepEqual([r.left, r.top, r.right, r.bottom], [10, 20, 40, 32], 'its box in the app window, for the keycap');
  assert.equal(keys[0].el.ownerDocument.elementFromPoint(0, 0), keys[0].el, 'the guide hit test lands on the stand-in');
  const j = await press({ key: '∆', code: 'KeyJ', altKey: true });
  assert.equal(j.prevented, true, '⌥J is pressed by the shell, never typed by the page');
  assert.deepEqual(got.at(-1) && [got.at(-1).type, got.at(-1).code], ['keydown', 'KeyJ']);
  // keys the app does not mark, ⇧ variants and ⌥E in a field stay the page's
  assert.equal((await press({ key: '˚', code: 'KeyK', altKey: true })).prevented, false);
  assert.equal((await press({ key: 'Ô', code: 'KeyJ', altKey: true, shiftKey: true })).prevented, false);
  keys[0].el.click(); await tick(); await tick();
  assert.deepEqual(pressed, ['j'], 'the stand-in asks the app to press its own control');
  off(); await tick(); await tick();
  assert.equal(sh.B.appKeys(f.el).length, 0);
  assert.equal((await press({ key: '∆', code: 'KeyJ', altKey: true })).prevented, false, 'the view gone: ⌥J is the page\'s again');
});

test('app keys: forged or reserved keys are dropped; a press only reaches a key that is live now; a reload clears them', async () => {
  const { sh, f, got, press, pressed, setLive } = await appKeyed();
  sh.B.pressAppKeys(() => f.el); await tick(); await tick();
  const channel = f.sent.filter(m => m.data.op === 'ready').at(-1).data.channel;
  const post = data => sh.ev.fire('message', { source: f.a, origin: 'null', data: { type: 'wizard:boundary', version: 1, channel, ...data } });
  post({ op: 'keys.app', keys: [{ key: 'h', label: 'Home', x: 0, y: 0, w: 10, h: 10 }, { key: 'v', x: 0, y: 0, w: 10, h: 10 }, { key: 'q', x: 0, y: 0, w: 0, h: 10 }, { key: 'm', x: 'a', y: 0, w: 10, h: 10 }, { key: 'k', label: 'x'.repeat(300), x: 1, y: 2, w: 3, h: 4 }] });
  assert.deepEqual(clone(sh.B.appKeys(f.el).map(t => [t.key, t.label.length])), [['k', 64]], 'Wizard\'s own keys and bad boxes never become app keys');
  // a made-up ⌥H (Wizard's Home) is not an app key even if posted as one
  sh.g.document.activeElement = f.el;
  post({ op: 'input', kind: 'key', event: 'keydown', key: '˙', code: 'KeyH', altKey: true });
  assert.notEqual(got.at(-1)?.code, 'KeyH');
  // the page no longer has ⌥J: a stale stand-in press does nothing
  const stale = sh.B.appKeys(f.el)[0];
  setLive([]);
  stale.el.click(); await tick(); await tick();
  assert.deepEqual(pressed, []);
  setLive([{ el: { getBoundingClientRect: () => ({ left: 1, top: 1, width: 5, height: 5 }) }, key: 'j', label: '' }]);
  f.load(); await tick(); await tick();
  stale.el.click(); await tick(); await tick();
  assert.deepEqual(pressed, [], 'a stand-in from the old document never presses on the new one');
  assert.deepEqual(clone(sh.B.appKeys(f.el).map(t => t.key)), ['j'], 'the new document reports its keys on its own channel');
  void press;
});

test('app keys wiring: the AI apps view presses app keys while it runs and reads a sandboxed app\'s keys from the boundary', () => {
  const layout = read('web/layouts/ai-apps/desktop.js'), client = read('web/core/app-client.js');
  assert.match(layout, /var offAppKeys = globalThis\.WizBrowserBoundary\?\.pressAppKeys\?\.\(\(\) => \(appFront\(\) \? paneFrame\(\) : null\)\) \|\| null;/);
  assert.match(layout, /offAppKeys\?\.sync\?\.\(\);/, 'the app in front is synced on every repaint');
  assert.match(layout, /return \(\) => \{\n    offAppKeys\?\.\(\);/, 'the view lets go when it is torn down');
  assert.match(layout, /if \(B\?\.owns\?\.\(f\)\) \{ try \{ return B\.appKeys\(f\)\.filter\(t => t && t\.el && isAppKey\(t\.key\)\);/);
  assert.match(client, /keys: \(\) => keyList\(document\), press: key => keyPress\(key\)/, 'WizardApp hands its own key list and press to the boundary client');
});

test('app keys: only the app in front holds back its ⌥ keys; another app window keeps its own shortcuts', async () => {
  const { sh, f, press, pressed } = await appKeyed();
  let front = null;
  const view = sh.B.pressAppKeys(() => front); await tick(); await tick();
  assert.equal((await press({ key: '∆', code: 'KeyJ', altKey: true })).prevented, false, 'not the app in front: ⌥J stays its own');
  assert.equal(sh.B.appKeys(f.el).length, 0);
  front = f.el; view.sync(); await tick(); await tick();
  assert.equal((await press({ key: '∆', code: 'KeyJ', altKey: true })).prevented, true, 'in front: the view presses it');
  sh.B.appKeys(f.el)[0].el.click(); await tick(); await tick();
  assert.deepEqual(pressed, ['j']);
  front = null; view.sync(); await tick(); await tick();
  assert.equal((await press({ key: '∆', code: 'KeyJ', altKey: true })).prevented, false, 'another app came to the front: ⌥J is this page\'s again');
  assert.equal(sh.B.appKeys(f.el).length, 0);
});

test('app keys: ⌥E/U/I in a text field stay accents on a Mac only', async () => {
  for (const mac of [true, false]) {
    const k = await keyed({ mac });
    k.f.a.WizBoundaryClient.connect({ keys: () => [{ el: { getBoundingClientRect: () => ({ left: 1, top: 1, width: 9, height: 9 }) }, key: 'e', label: 'Edit' }], press: () => true });
    k.sh.B.pressAppKeys(() => k.f.el); await tick(); await tick();
    k.f.a.document.activeElement = { tagName: 'INPUT', type: 'text', readOnly: false };
    assert.equal((await k.press({ key: '´', code: 'KeyE', altKey: true })).prevented, !mac, mac ? 'Mac: an accent' : 'elsewhere: the app key');
  }
});
