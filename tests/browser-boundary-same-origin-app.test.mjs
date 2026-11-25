// Browser owner boundary (humanitylabs-org/telegram#68): TG style is a second view of the shell's own chats and reads,
// opens and sends them through the shell page's WizLive/WosChat/WosModels, which a sealed (opaque) window cannot reach,
// so it opened blank (and, with CORS on its files, said "Open Telegram from Wizard"). Decided on that issue (option A):
// its window stays same-origin like Store and Setup, only by installed app id AND the repo it was installed from, and
// only for pages under its own path. Every other app, and a TG style from anywhere else, stays sealed.
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
const TG_REPO = 'humanitylabs-org/telegram';

function boundary({ on = true, repos = { 'tg-style': TG_REPO } } = {}) {
  const g = { setTimeout, clearTimeout, crypto: globalThis.crypto, JSON, console, Promise, Object, String, Map, Set };
  g.window = g; g.top = g; g.URL = URL; g.location = { href: ORIGIN + '/wizard-os-home/', origin: ORIGIN };
  g.WizShellBoundary = on ? { on: true } : undefined;
  g.WizCore = { appRepo: id => repos[id] || '' };
  g.localStorage = { getItem: () => null };
  g.addEventListener = () => {}; g.removeEventListener = () => {}; g.document = { activeElement: null };
  vm.createContext(g); vm.runInContext(read('web/core/browser-boundary.js'), g);
  return g.WizBrowserBoundary;
}

const TG = { id: 'tg-style', name: 'TG style', url: '/tg-style/' }, NOTES = { id: 'notes', name: 'Notes', url: '/notes/' };

test('sameOriginApp: only TG style from its own listing, only pages under its own path', () => {
  const B = boundary();
  assert.equal(B.sameOriginApp('tg-style', '/tg-style/'), true);
  assert.equal(B.sameOriginApp('tg-style', '/tg-style/index.html?x=1'), true);
  assert.equal(B.sameOriginApp('tg-style'), true, 'no url: its own home');
  assert.equal(B.sameOriginApp('tg-style', '/notes/'), false, 'not another app\'s path');
  assert.equal(B.sameOriginApp('tg-style', '/tg-style/../wizard/v1/chats'), false, 'never an owner route by ..');
  assert.equal(B.sameOriginApp('tg-style', '/tg-style/%2e%2e/wizard/'), false, 'nor by an encoded ..');
  assert.equal(B.sameOriginApp('tg-style', '/tg-style//x'), false);
  assert.equal(B.sameOriginApp('tg-style', 'https://evil.example/tg-style/'), false, 'never another site');
  assert.equal(B.sameOriginApp('notes', '/notes/'), false, 'every other app stays sealed');
  for (const id of ['constructor', '__proto__', 'hasOwnProperty', '', null, undefined]) assert.equal(B.sameOriginApp(id, '/tg-style/'), false, String(id));
  for (const repo of ['', 'someone/telegram', 'humanitylabs-org/telegram-fork', 'local/tg-style'])
    assert.equal(boundary({ repos: { 'tg-style': repo } }).sameOriginApp('tg-style', '/tg-style/'), false, `installed from ${repo || 'nowhere known'}: sealed`);
  assert.equal(B.sameOriginPage(ORIGIN + '/tg-style/'), true);
  assert.equal(B.sameOriginPage(ORIGIN + '/notes/'), false);
  assert.equal(boundary({ on: false }), undefined, 'boundary off: nothing is defined, every window is as before');
});

test('frameAttributes: TG style\'s window is same-origin with the boundary on; Notes and a TG style from elsewhere stay sealed', () => {
  assert.equal(boundary().frameAttributes('/tg-style/', 'tg-style'), '');
  assert.match(boundary().frameAttributes('/notes/', 'notes'), new RegExp(`^sandbox="${SANDBOX}"`));
  assert.match(boundary().frameAttributes('/tg-style/', 'notes'), new RegExp(`^sandbox="${SANDBOX}"`), 'another app at its path');
  assert.match(boundary({ repos: { 'tg-style': 'someone/else' } }).frameAttributes('/tg-style/', 'tg-style'), new RegExp(`^sandbox="${SANDBOX}"`));
  assert.match(boundary().frameAttributes('/tg-style/'), new RegExp(`^sandbox="${SANDBOX}"`), 'no app id: sealed');
});

test('the guard keeps TG style same-origin on its own pages and seals it the moment it lands anywhere else', () => {
  const B = boundary();
  const listeners = [], attrs = new Map();
  const loc = { href: ORIGIN + '/tg-style/', origin: ORIGIN, pathname: '/tg-style/' };
  const el = {
    tagName: 'IFRAME', isConnected: true, src: '/tg-style/',
    contentWindow: { get location() { return loc; }, postMessage() {} },
    hasAttribute: n => attrs.has(n), getAttribute: n => attrs.get(n) ?? null, setAttribute: (n, v) => attrs.set(n, v),
    addEventListener: (n, fn) => listeners.push(fn), removeEventListener() {}, closest: () => null, getClientRects: () => [1],
  };
  B.attach(el, { home: '/tg-style/' });
  assert.equal(attrs.has('sandbox'), false);
  Object.assign(loc, { href: ORIGIN + '/tg-style/index.html', pathname: '/tg-style/index.html' }); for (const fn of listeners) fn({});
  assert.equal(attrs.has('sandbox'), false, 'its own page stays same-origin');
  Object.assign(loc, { href: ORIGIN + '/wizard/v1/chats', pathname: '/wizard/v1/chats' }); for (const fn of [...listeners]) fn({});
  assert.equal(attrs.get('sandbox'), SANDBOX, 'anywhere else: reloaded sealed');
});

test('the top shell arms TG style\'s own fetch (shell token on owner calls); never another app page', async () => {
  const SRC = readFileSync(new URL('../web/core/shell-token.js', import.meta.url), 'utf8');
  const TOKEN = 'ab'.repeat(32);
  const calls = [];
  const meta = { getAttribute: () => TOKEN, remove() {} };
  const top = { fetch: () => Promise.resolve('ok'), XMLHttpRequest: class {} };
  top.top = top;
  vm.runInNewContext(SRC, { window: top, document: { querySelector: () => meta }, localStorage: { getItem() {}, setItem() {}, removeItem() {} },
    location: { href: ORIGIN + '/wizard-os-home/', origin: ORIGIN }, URL, Headers, Request });
  top.WizBrowserBoundary = { sameOriginPage: href => href.startsWith(ORIGIN + '/tg-style/') };
  const frame = path => {
    const native = (input, init) => { calls.push({ path, input, init }); return Promise.resolve('ok'); };
    const u = new URL(ORIGIN + path);
    return { fetch: native, native, XMLHttpRequest: class {}, Headers, Request, top, location: { href: u.href, origin: u.origin, pathname: u.pathname } };
  };
  const tg = frame('/tg-style/'), notes = frame('/notes/');
  assert.equal(top.WizShellBoundary.armFrame(tg), true);
  assert.equal(top.WizShellBoundary.armFrame(notes), false);
  assert.equal(notes.fetch, notes.native);
  await tg.fetch('/wizard/v1/thread-items?thread=x');
  await tg.fetch('api/features');
  assert.deepEqual(calls.map(c => new Headers(c.init?.headers).get('x-wizard-shell-token')), [TOKEN, null]);
});

// The pinned single-app session (web/core/single-app-session.js), run for real with the shell's home-screen policy.
function policy(id) {
  const window = {};
  const ctx = vm.createContext({ window, document: { documentElement: { setAttribute() {} } }, location: { origin: 'https://box.example', search: '?app-session=' + id }, URL, URLSearchParams, Object, Proxy, Reflect });
  launcherFixture(ctx); vm.runInContext(readFileSync(new URL('../web/core/home-screen-policy.js', import.meta.url), 'utf8'), ctx);
  return window.WizHomeScreenPolicy;
}
async function pinned({ B, app }) {
  const frames = [];
  function el(tag) {
    return { tag, dataset: {}, attrs: {}, style: { setProperty() {} }, classList: { add() {}, remove() {} }, children: [], events: {},
      setAttribute(k, v) { this.attrs[k] = String(v); }, hasAttribute(k) { return k in this.attrs; }, getAttribute(k) { return this.attrs[k] ?? null; },
      appendChild(child) { this.children.push(child); if (child.tag === 'iframe') frames.push(child); }, replaceChildren() { this.children = []; }, append() {},
      addEventListener(type, fn) { this.events[type] = fn; }, remove() {}, get isConnected() { return true; } };
  }
  const host = el('host'), document = { documentElement: el('html'), getElementById: () => host, addEventListener() {}, createElement: el, title: '' };
  const window = { WizHomeScreenPolicy: policy(app.id), WizCore: { apps: () => ({ APP: { [app.id]: { ...app, kind: 'wizard' } } }), appsLoaded: () => Promise.resolve() }, WosSelMenu: { back: () => false },
    WizAppServices: { attach: () => () => {}, guardBack() {}, back: () => 'pending' } };
  if (B) window.WizBrowserBoundary = B;
  const store = new Map(), localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), get length() { return store.size; }, key: n => [...store.keys()][n] ?? null };
  const location = { origin: ORIGIN, href: ORIGIN + '/wizard-os-home/?app-session=' + app.id, search: '?app-session=' + app.id, replace() {} };
  const ctx = vm.createContext({ window, document, localStorage, location, history: { state: null, replaceState() {} }, URL, URLSearchParams, addEventListener() {}, setInterval() {}, setTimeout() {} });
  vm.runInContext(readFileSync(new URL('../web/core/single-app-session.js', import.meta.url), 'utf8'), ctx); await new Promise(setImmediate);
  return frames;
}

test('pinned TG style is same-origin under the boundary; pinned Notes stays sealed', async () => {
  const tg = await pinned({ B: boundary(), app: TG });
  assert.equal(tg.length, 1); assert.equal(tg[0].hasAttribute('sandbox'), false);
  const notes = await pinned({ B: boundary(), app: NOTES });
  assert.equal(notes[0].getAttribute('sandbox'), SANDBOX);
  const other = await pinned({ B: boundary({ repos: { 'tg-style': 'someone/else' } }), app: TG });
  assert.equal(other[0].getAttribute('sandbox'), SANDBOX);
});
