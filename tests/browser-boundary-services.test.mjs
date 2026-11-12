// Browser owner boundary (wizard-os#133), slice 16: a sandboxed app sets its own badge and window title bar over the
// boundary channel. Shell server side: web/core/app-services.js registers with WizBrowserBoundary.serve.
// The channel itself (browser-boundary.js <-> browser-boundary-client.js) is covered in browser-boundary-frames.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../web/core/app-services.js', import.meta.url), 'utf8');
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.className = ''; this.textContent = '';
    this.classList = { s: new Set(), add: (...c) => c.forEach(x => this.classList.s.add(x)), remove: (...c) => c.forEach(x => this.classList.s.delete(x)), contains: c => this.classList.s.has(c) }; }
  append(...k) { for (const c of k) { c.parentNode = this; this.children.push(c); } }
  insertBefore(c, ref) { c.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); }
  replaceChildren() { this.children = []; } remove() { const p = this.parentNode; if (p) p.children.splice(p.children.indexOf(this), 1); }
  setAttribute(k, v) { this.attrs[k] = v; } addEventListener(e, f) { (this.listeners[e] ||= []).push(f); }
  querySelector(sel) { if (sel === ':scope > .wtools') return this.children.find(c => c.className === 'wtools') || null; if (sel === ':scope > .wbar') return this.children.find(c => c.className === 'wbar') || null; return null; }
  matches() { return false; } closest() { return null; } set innerHTML(v) { this._html = v; }
}

// A sandboxed app frame: its window can be addressed but never read (opaque origin).
function fixture({ id = 'morning-report', src, ready = true, boundary = true } = {}) {
  const location = new URL('https://wizard.example/wizard-os-home/'), counts = {}, taps = [], legacy = [];
  const win = new El('article'), bar = new El('header'); bar.className = 'wbar'; win.append(bar);
  const child = { get location() { throw new Error('SecurityError'); }, get document() { throw new Error('SecurityError'); }, postMessage: m => legacy.push(m) };
  const loads = [], observers = [];
  const frame = { tagName: 'IFRAME', src: src || 'https://wizard.example/' + id + '/', isConnected: true, contentWindow: child,
    hasAttribute: n => n === 'sandbox', addEventListener: (t, fn) => { if (t === 'load') loads.push(fn); }, removeEventListener() {}, closest: s => (s === '.win' ? win : null) };
  // The src attribute set by the shell (a MutationObserver record), and a document load in the frame.
  class MutationObserver { constructor(fn) { this.fn = fn; } observe(el, o) { if (el === frame && o.attributeFilter?.includes('src')) observers.push(this); } disconnect() { observers.splice(observers.indexOf(this), 1); } }
  const app = { id, kind: 'wizard', url: '/' + id + '/' };
  const B = { served: null, resets: new Set(), readyNow: ready,
    serve(fn) { if (this.served) return false; this.served = fn; return true; },
    onReset(fn) { this.resets.add(fn); return () => this.resets.delete(fn); },
    ready: f => f === frame && B.readyNow,
    tool: (f, tid, value) => { taps.push({ f, tid, value }); return true; },
    attach: () => () => {}, enabled: true };
  const window = { WizCore: { apps: () => ({ APPS: [app] }), workspaceNav: { setCount: (k, n) => { counts[k] = n; } } }, dispatchEvent() {}, ...(boundary ? { WizBrowserBoundary: B } : {}) };
  vm.runInNewContext(source, { window, location, URL, MutationObserver, addEventListener() {}, setInterval() {}, setTimeout, clearTimeout,
    document: { hidden: false, readyState: 'loading', addEventListener() {}, createElement: t => new El(t) }, CustomEvent: class {}, navigator: {}, JSON });
  const detach = window.WizAppServices.attach(frame, { appId: id, path: app.url, isVisible: () => true });
  return { B, frame, bar, counts, taps, legacy, detach, services: window.WizAppServices, call: (m, a) => B.served(frame, m, a), reset: () => { for (const fn of B.resets) fn(frame); },
    load: () => { for (const fn of loads) fn({}); }, setSrc: () => { for (const o of [...observers]) o.fn([]); } };
}
const box = f => f.bar.children.find(c => c.className === 'wtools');
const tools = [{ id: 'older', kind: 'button', icon: 'prev', label: 'Older' }, { id: 'date', kind: 'select', label: 'Date', value: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }];

test('off: without the boundary nothing is registered', () => {
  const f = fixture({ boundary: false });
  assert.equal(f.B.served, null);
});

test('a sandboxed app sets its own badge, keyed by the installed app id of its frame', () => {
  const f = fixture();
  assert.equal(typeof f.B.served, 'function');
  assert.equal(f.call('badge.set', { n: 4 }), true);
  assert.equal(f.counts['morning-report'], 4);
  f.call('badge.set', { n: 5000 }); assert.equal(f.counts['morning-report'], 999);
  f.detach(); assert.equal(f.counts['morning-report'], 0, 'closing the window clears its badge');
});

test('a sandboxed app puts tools in its own window bar, and a tap goes back over the boundary channel only', () => {
  const f = fixture();
  assert.equal(f.call('titlebar.set', { tools }), true);
  const b = box(f); assert.equal(b.children.length, 2); assert.equal(f.bar.classList.contains('has-tools'), true);
  for (const fn of b.listeners.click) fn({ stopPropagation() {}, target: { closest: s => (s === 'button[data-tool]' ? { dataset: { tool: 'older' }, disabled: false } : null) } });
  for (const fn of b.listeners.change) fn({ target: { closest: s => (s === 'select[data-tool]' ? { dataset: { tool: 'date' }, value: 'b' } : null) } });
  assert.deepEqual(f.taps.map(t => [t.f === f.frame, t.tid, t.value]), [[true, 'older', undefined], [true, 'date', 'b']]);
  assert.equal(f.legacy.length, 0, 'nothing is posted to an opaque window with the shell origin');
  // An option the app never offered is not sent.
  for (const fn of b.listeners.change) fn({ target: { closest: s => (s === 'select[data-tool]' ? { dataset: { tool: 'date' }, value: 'zzz' } : null) } });
  assert.equal(f.taps.length, 2);
});

test('a new channel (reload) clears the title bar; tools are still validated as data', () => {
  const f = fixture();
  f.call('titlebar.set', { tools }); f.reset();
  assert.equal(box(f), undefined); assert.equal(f.bar.classList.contains('has-tools'), false);
  assert.throws(() => f.call('titlebar.set', { tools: [{ id: 'X Y', kind: 'button' }] }), /Invalid title-bar tool/);
  assert.throws(() => f.call('titlebar.set', { tools: [{ id: 'out', kind: 'link', href: 'https://evil.example/' }] }), /stay inside the app/);
});

test('not ready on its channel, outside its app path, or a shell-owned count: refused', () => {
  const notReady = fixture({ ready: false });
  assert.throws(() => notReady.call('badge.set', { n: 1 }), /not verified/);
  const moved = fixture({ src: 'https://wizard.example/other-app/' });
  assert.throws(() => moved.call('titlebar.set', { tools }), /not verified/);
  for (const id of ['notifications', 'wizard']) {
    const f = fixture({ id });
    assert.throws(() => f.call('badge.set', { n: 9 })); assert.equal(id in f.counts, false);
  }
  const f = fixture();
  assert.throws(() => f.call('share.text', { text: 'x' }), /Not available/);
  f.B.readyNow = false;
  assert.throws(() => f.call('badge.set', { n: 1 }), /not verified/, 'a frame whose new document has not answered yet');
});

test('a page that navigated its own frame (src still says the app) gets nothing until the shell loads the window', () => {
  const f = fixture();
  f.load(); // the first load of the window
  assert.equal(f.call('badge.set', { n: 1 }), true);
  f.load(); // a load the shell did not start: a link or location change inside the frame
  assert.throws(() => f.call('badge.set', { n: 2 }), /not verified/);
  assert.throws(() => f.call('titlebar.set', { tools }), /not verified/);
  assert.equal(f.counts['morning-report'], 1);
  f.setSrc(); f.load(); // the shell set src (reload, route)
  assert.equal(f.call('titlebar.set', { tools }), true);
  f.load(); assert.throws(() => f.call('badge.set', { n: 3 }), /not verified/);
  f.services.expectLoad(f.frame); f.load(); // the shell's own location.replace (route change)
  assert.equal(f.call('badge.set', { n: 3 }), true);
});

test('relative title-bar links resolve against the page\'s own address and still stay inside the app', () => {
  const f = fixture();
  const link = [{ id: 'pdf', kind: 'link', text: 'PDF', label: 'PDF', href: 'report.pdf' }];
  f.call('titlebar.set', { tools: link, base: 'https://wizard.example/morning-report/2026/11/' });
  assert.equal(box(f).children[0].href, 'https://wizard.example/morning-report/2026/11/report.pdf');
  // A base outside the app is ignored (the app's entry is used); a link that leaves the app is refused either way.
  f.call('titlebar.set', { tools: link, base: 'https://wizard.example/other/' });
  assert.equal(box(f).children[0].href, 'https://wizard.example/morning-report/report.pdf');
  assert.throws(() => f.call('titlebar.set', { tools: [{ id: 'up', kind: 'link', label: 'Up', href: '../../other/' }], base: 'https://wizard.example/morning-report/a/' }), /stay inside the app/);
});
