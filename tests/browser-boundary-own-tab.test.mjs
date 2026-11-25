// Browser owner boundary (wizard-os#942): an app that can't run in a sandboxed window at all (Files, upstream File
// Browser: its sign-in lives in the page's own localStorage and cookie and it calls its own API directly) opens as its
// own browser tab instead of a blank sandboxed window. Every other app keeps its sandboxed window, and with the
// boundary off nothing changes. Checked in real Chromium against the real shell image and File Browser v2.63.23 (wizard-os#942).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { withWebParts } from './fixtures/web-parts.mjs';
import { launcherFixture } from './launcher-fixture.mjs';

const read = p => withShellParts(withWebParts(readFileSync(new URL('../' + p, import.meta.url), 'utf8')));
const ORIGIN = 'https://box.example.ts.net';
const SANDBOX = 'allow-scripts allow-forms allow-downloads';
const sliceFn = (src, start, end = '\n  }\n') => { const i = src.indexOf(start); assert.ok(i >= 0, start); const j = src.indexOf(end, i); assert.ok(j > i, start); return src.slice(i, j + end.length); };

function boundary(on = true) {
  const g = { setTimeout, clearTimeout, crypto: globalThis.crypto, JSON, console, Promise, Object, String, Map, Set };
  g.window = g; g.top = g; g.URL = URL; g.location = { href: ORIGIN + '/wizard-os-home/', origin: ORIGIN };
  g.WizShellBoundary = on ? { on: true } : undefined;
  g.localStorage = { getItem: () => null };
  g.addEventListener = () => {}; g.removeEventListener = () => {}; g.document = { activeElement: null };
  vm.createContext(g); vm.runInContext(read('web/core/browser-boundary.js'), g);
  return g.WizBrowserBoundary;
}

const FILES = { id: 'files', name: 'Files', url: '/files/' }, NOTES = { id: 'notes', name: 'Notes', url: '/notes/' };
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function render(B, which, app) {
  const window = { WizBrowserBoundary: B, WosOwnViews: null, WizReach: {} };
  const ctx = vm.createContext({ window, esc, ico: () => '', MOD: '⌥', listW: () => 300, appOf: () => app, APP: app });
  if (which === 'phone') vm.runInContext(sliceFn(read('web/app-frame.js'), '  function renderFrameCore(w, a) {') + '\nthis.html = w => renderFrameCore(w, APP);', ctx);
  else vm.runInContext(sliceFn(read('web/desktop/desktop-resize.js'), '  function bodyHtml(w) {') + '\nthis.html = bodyHtml;', ctx);
  return ctx.html({ app: 'frame', appId: app.id, url: app.url });
}

test('ownTab: only Files at its own path, only with the boundary on', () => {
  const B = boundary();
  assert.equal(B.ownTab('files', '/files/'), true);
  assert.equal(B.ownTab('files', '/files/files/Documents/'), true, 'a page inside Files');
  assert.equal(B.ownTab('files'), true, 'no url: its own home');
  assert.equal(B.ownTab('files', '/notes/'), false, 'an app called files somewhere else is not Files');
  assert.equal(B.ownTab('files', 'https://elsewhere.example/files/'), false, 'never another site');
  assert.equal(B.ownTab('notes', '/notes/'), false, 'every other app keeps its sandboxed window');
  for (const id of ['constructor', '__proto__', 'hasOwnProperty', '', null, undefined]) assert.equal(B.ownTab(id, '/files/'), false, String(id));
  assert.equal(boundary(false), undefined, 'boundary off: nothing is defined, so every window is as before');
});

for (const which of ['phone', 'desktop']) {
  test(`${which}: with the boundary on Files gets an Open Files card (its own tab), not a blank sandboxed window`, () => {
    const html = render(boundary(), which, FILES);
    assert.doesNotMatch(html, /<iframe/, 'no sandboxed frame File Browser would stay blank in');
    assert.match(html, /Files opens in its own tab/);
    const a = /<a [^>]*>/.exec(html)[0];
    assert.match(a, /href="\/files\/"/); assert.match(a, /target="_blank"/); assert.match(a, /rel="noopener"/);
  });
  test(`${which}: every other app keeps its sandboxed window; with the boundary off Files is framed as before`, () => {
    const notes = render(boundary(), which, NOTES);
    assert.match(/<iframe [^>]*>/.exec(notes)[0], new RegExp(`sandbox="${SANDBOX}"`));
    assert.doesNotMatch(notes, /data-own-tab/);
    const off = render(undefined, which, FILES), tag = /<iframe [^>]*>/.exec(off)[0];
    assert.match(tag, /src="\/files\/"/); assert.doesNotMatch(tag, /sandbox=/);
    assert.doesNotMatch(off, /data-own-tab/);
  });
}

// The pinned single-app session (web/core/single-app-session.js), run for real with the shell's home-screen policy.
function policy(id) {
  const window = {};
  const ctx = vm.createContext({ window, document: { documentElement: { setAttribute() {} } }, location: { origin: 'https://box.example', search: '?app-session=' + id }, URL, URLSearchParams, Object, Proxy, Reflect });
  launcherFixture(ctx); vm.runInContext(readFileSync(new URL('../web/core/home-screen-policy.js', import.meta.url), 'utf8'), ctx);
  return window.WizHomeScreenPolicy;
}
async function pinned({ on, app }) {
  const frames = [], replaced = [];
  function el(tag) {
    return { tag, dataset: {}, attrs: {}, style: { setProperty() {} }, classList: { add() {}, remove() {} }, children: [], events: {},
      setAttribute(k, v) { this.attrs[k] = String(v); }, hasAttribute(k) { return k in this.attrs; }, getAttribute(k) { return this.attrs[k] ?? null; },
      appendChild(child) { this.children.push(child); if (child.tag === 'iframe') frames.push(child); }, replaceChildren() { this.children = []; }, append() {},
      addEventListener(type, fn) { this.events[type] = fn; }, remove() {}, get isConnected() { return true; } };
  }
  const host = el('host'), document = { documentElement: el('html'), getElementById: () => host, addEventListener() {}, createElement: el, title: '' };
  const window = { WizHomeScreenPolicy: policy(app.id), WizCore: { apps: () => ({ APP: { [app.id]: { ...app, kind: 'wizard' } } }), appsLoaded: () => Promise.resolve() }, WosSelMenu: { back: () => false },
    WizAppServices: { attach: () => () => {}, guardBack() {}, back: () => 'pending' } };
  if (on) window.WizBrowserBoundary = boundary();
  const store = new Map(), localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), get length() { return store.size; }, key: n => [...store.keys()][n] ?? null };
  const location = { origin: ORIGIN, href: ORIGIN + '/wizard-os-home/?app-session=' + app.id, replace: u => replaced.push(u) };
  const ctx = vm.createContext({ window, document, localStorage, location, URL, addEventListener() {}, setInterval() {}, setTimeout() {} });
  vm.runInContext(readFileSync(new URL('../web/core/single-app-session.js', import.meta.url), 'utf8'), ctx); await new Promise(setImmediate);
  return { frames, replaced };
}

test('pinned Files opens Files itself under the boundary; other pinned apps and boundary off keep their frame', async () => {
  const files = await pinned({ on: true, app: FILES });
  assert.ok(files.replaced.length > 0 && files.replaced.every(u => u === '/files/'), 'the pin page becomes File Browser');
  assert.equal(files.frames.length, 0, 'no sandboxed frame it would stay blank in');
  const notes = await pinned({ on: true, app: NOTES });
  assert.deepEqual(notes.replaced, []); assert.equal(notes.frames.length, 1); assert.equal(notes.frames[0].getAttribute('sandbox'), SANDBOX);
  const off = await pinned({ on: false, app: FILES });
  assert.deepEqual(off.replaced, []); assert.equal(off.frames.length, 1); assert.equal(off.frames[0].hasAttribute('sandbox'), false);
});
