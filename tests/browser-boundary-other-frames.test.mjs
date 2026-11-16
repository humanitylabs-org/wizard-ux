// Browser owner boundary (wizard-os#133): the pinned single-app session (web/core/single-app-session.js) sandboxes its
// app frame when the box turned the boundary on, and never reads the opaque frame. Off: unchanged.
// Link sheet and hidden voice frames are proven in real Chromium by tests/qa-browser-boundary-other-frames.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { launcherFixture } from './launcher-fixture.mjs';

const root = new URL('../', import.meta.url).pathname;
const read = path => fs.readFileSync(root + 'web/' + path, 'utf8');
const SANDBOX = 'allow-scripts allow-forms allow-downloads';
function storage() {
  const data = new Map();
  return { getItem: k => data.get(String(k)) ?? null, setItem: (k, v) => data.set(String(k), String(v)), removeItem: k => data.delete(String(k)), get length() { return data.size; }, key: n => [...data.keys()][n] ?? null, data };
}
function policy() {
  const window = {};
  const ctx = vm.createContext({ window, document: { documentElement: { setAttribute() {} } }, location: { origin: 'https://box.example', search: '?app-session=wisdom' }, URL, URLSearchParams, Object, Proxy, Reflect });
  launcherFixture(ctx); vm.runInContext(read('core/home-screen-policy.js'), ctx);
  return window.WizHomeScreenPolicy;
}
async function session({ boundary }) {
  const p = policy(); let frame, serviceStep = 'pending'; const attached = [], reads = [];
  function el(tag) {
    return { tag, dataset: {}, attrs: {}, style: { setProperty() {} }, classList: { add() {}, remove() {} }, children: [], events: {},
      setAttribute(k, v) { this.attrs[k] = String(v); }, hasAttribute(k) { return k in this.attrs; }, getAttribute(k) { return this.attrs[k] ?? null; },
      appendChild(child) { this.children.push(child); if (child.tag === 'iframe') frame = child; }, replaceChildren() { this.children = []; }, append() {},
      addEventListener(type, fn) { this.events[type] = fn; }, remove() {}, get isConnected() { return true; } };
  }
  const host = el('host'), document = { documentElement: el('html'), getElementById: () => host, addEventListener() {}, createElement: el, title: '' };
  const app = { id: 'wisdom', name: 'Wisdom', kind: 'wizard', url: '/wisdom/' };
  const window = { WizHomeScreenPolicy: p, WizCore: { apps: () => ({ APP: { wisdom: app } }), appsLoaded: () => Promise.resolve() }, WosSelMenu: { back: () => false },
    WizAppServices: { attach: (f, o) => { attached.push({ f, o }); return () => {}; }, guardBack() {}, back: () => serviceStep } };
  if (boundary) window.WizBrowserBoundary = Object.freeze({ enabled: true, sandbox: SANDBOX });
  const store = storage();
  const ctx = vm.createContext({ window, document, localStorage: store, location: { origin: 'https://box.example' }, URL, addEventListener() {}, setInterval() {}, setTimeout() {} });
  vm.runInContext(read('core/single-app-session.js'), ctx); await new Promise(setImmediate);
  // An opaque frame, as the browser gives it: contentDocument is null and every read through the WindowProxy throws.
  const proxy = new Proxy({}, { get(_, k) { reads.push(String(k)); throw Object.assign(new Error('Blocked a frame with origin "null"'), { name: 'SecurityError' }); } });
  if (boundary) { Object.defineProperty(frame, 'contentWindow', { get: () => proxy }); Object.defineProperty(frame, 'contentDocument', { get: () => null }); }
  return { p, frame, window, document, attached, reads, store, setStep: s => { serviceStep = s; } };
}

test('boundary on: the pinned app frame is sandboxed without same-origin and attached to the app services', async () => {
  const s = await session({ boundary: true });
  assert.equal(s.frame.getAttribute('sandbox'), SANDBOX);
  assert.ok(!s.frame.getAttribute('sandbox').split(/\s+/).includes('allow-same-origin'));
  assert.equal(s.attached.length, 1, 'Back, appearance and dictation go through WizAppServices.attach (and so WizBrowserBoundary)');
  assert.equal(s.attached[0].f, s.frame);
});

test('boundary on: a load never reads the opaque frame and does not report the app unavailable', async () => {
  const s = await session({ boundary: true });
  s.frame.events.load();
  assert.deepEqual(s.reads, [], 'nothing read through the opaque frame on load');
  assert.equal(s.document.title, 'Wisdom');
  assert.equal(s.attached.length, 1, 'still mounted (unavailable() would have detached and cleared the window)');
  assert.ok(!s.document.getElementById().children.some(c => c.className === 'single-unavailable'));
});

test('boundary on: Back is the app\'s (pending) and repeated root Back stays inside Wizard', async () => {
  const s = await session({ boundary: true });
  s.frame.events.load();
  assert.equal(s.window.__wosNativeBack(), 'app');
  s.setStep('notReady');
  assert.equal(s.window.__wosNativeBack(), 'root', 'no client yet: the history fallback cannot read the frame and stays put');
  assert.equal(s.window.__wosNativeBack(), 'root');
});

test('boundary off: the pinned app frame is exactly as before', async () => {
  const s = await session({ boundary: false });
  assert.equal(s.frame.hasAttribute('sandbox'), false);
  s.frame.contentWindow = { location: { href: 'https://box.example/wisdom/' }, history: { state: null }, document: {}, addEventListener() {} };
  s.frame.events.load();
  assert.equal(s.document.title, 'Wisdom', 'the same-origin load path still runs');
});

test('boundary on: link sheet and voice frames are covered by the box switch', () => {
  assert.match(read('core/links.js'), /if \(window\.WizBrowserBoundary\?\.enabled\) frame\.setAttribute\('sandbox', window\.WizBrowserBoundary\.sandbox\);/);
  assert.match(read('core/app-services.js'), /const wanted = window\.WizBrowserBoundary\?\.enabled \? new Map\(\) :/);
});

// The offline copy of the shell or a pinned app (app-session.html) has no token. core/browser-boundary.js still turns on
// when this device remembers the box turned the boundary on (core/shell-token.js keeps that mark).
function boundary({ shellToken = false, mark = null, framed = false } = {}) {
  const g = { setTimeout, clearTimeout, crypto: globalThis.crypto, JSON, Promise, Object, String, Map, Set };
  g.window = g; g.top = framed ? {} : g;
  if (shellToken) g.WizShellBoundary = { on: true };
  g.localStorage = mark === 'throws' ? { getItem() { throw new Error('denied'); } } : { getItem: k => (k === 'wos.browser-boundary.v1' ? mark : null) };
  g.addEventListener = () => {}; g.document = { activeElement: null };
  vm.createContext(g); vm.runInContext(read('core/browser-boundary.js'), g);
  return g.WizBrowserBoundary;
}

test('offline copy: the remembered mark turns the frame sandbox on without a token; nothing else does', () => {
  assert.equal(boundary({ mark: '1' })?.enabled, true);
  assert.equal(boundary({ mark: '1' }).sandbox, SANDBOX);
  assert.equal(boundary({ shellToken: true })?.enabled, true);
  assert.equal(boundary(), undefined, 'no token, no mark: off as before');
  assert.equal(boundary({ mark: '0' }), undefined);
  assert.equal(boundary({ mark: 'throws' }), undefined);
  assert.equal(boundary({ mark: '1', framed: true }), undefined, 'never inside a frame');
  const html = read('app-session.html');
  assert.ok(html.indexOf('<script src="core/browser-boundary.js"></script>') > 0, 'the offline pinned-app page loads it');
  assert.ok(html.indexOf('core/browser-boundary.js') < html.indexOf('core/single-app-session.js') && html.indexOf('core/browser-boundary.js') < html.indexOf('core/links.js'));
  assert.match(read('core/offline-session-config.js'), /core\/browser-boundary\.js/, 'and it is in the offline copy');
});
