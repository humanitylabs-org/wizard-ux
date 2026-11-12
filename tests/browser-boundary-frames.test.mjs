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
  g.window = g; g.top = g;
  g.WizShellBoundary = on ? { on: true } : undefined;
  g.addEventListener = ev.add; g.removeEventListener = ev.remove;
  g.document = { activeElement: null };
  g.WizAppearance = { sync: () => log.push('appearance-sync') };
  vm.createContext(g);
  vm.runInContext(SHELL_SRC, g);
  return { g, ev, log, B: g.WizBrowserBoundary };
}

// An app document inside a frame. sandbox: the attribute value (null = no sandbox attribute).
function frame(sh, { sandbox = 'allow-scripts allow-forms allow-downloads', client = true } = {}) {
  const app = listeners(), sent = [], win = { cls: classes() };
  const fev = listeners(), doc = listeners();
  const a = { setTimeout, clearTimeout, crypto: globalThis.crypto, JSON, console, Promise, Object, String, Map, Set, Error };
  a.window = a; a.origin = 'null';
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
    hasAttribute: n => attrs.has(n), getAttribute: n => attrs.get(n) ?? null,
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
  for (const sandbox of [null, 'allow-scripts allow-same-origin']) {
    const f = frame(sh, { sandbox, client: false });
    sh.B.attach(f.el);
    assert.equal(sh.B.owns(f.el), false, String(sandbox));
  }
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

test('client requests: only ready, and it waits for the first hello', async () => {
  const sh = shell(), f = frame(sh);
  f.a.WizBoundaryClient.connect({ onBack: () => false });
  await assert.rejects(f.a.WizBoundaryClient.request('share.text', {}), e => e.code === 'unavailable');
  const r = f.a.WizBoundaryClient.request('ready', null, 2000);
  sh.B.attach(f.el);
  assert.deepEqual(clone(await r), { version: 1, hosted: true });
});

test('wiring: pages load the boundary right after shell-token.js; app frames get the sandbox only when it is on', () => {
  for (const page of ['web/index.html', 'web/desktop.html']) {
    const html = read(page);
    const t = html.indexOf('<script src="core/shell-token.js"></script>'), b = html.indexOf('<script src="core/browser-boundary.js"></script>');
    assert.ok(t > 0 && b > t, page);
    assert.ok(b < html.indexOf('<script src="core/appearance-host.js"></script>') && b < html.indexOf('<script src="core/app-services.js"></script>'), page);
  }
  const gate = "${window.WizBrowserBoundary?.enabled ? ' ' + window.WizBrowserBoundary.frameAttributes() : ''}";
  assert.ok(read('web/app.js').includes('<iframe class="appframe"' + gate), 'phone app frames');
  assert.ok(read('web/desktop/desktop.js').includes(`<iframe data-own-app="\${esc(a.id || '')}"` + gate), 'desktop app frames');
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
