// Links open the app's own window (wizard-os issue 650, switch wizard/app-windows, off by default).
// The real home-screen-policy.js, deeplink.js and android-relay.js run in a vm with a stand-in Android bridge: which
// links open an app's own window, with which page, and that the main page copies the switch to the Android app. The
// native rules are JVM tests (android/app/src/test/.../AppWindowsPolicyTest.java); the wiring is checked from source.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { launcherFixture } from './launcher-fixture.mjs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { withWebParts } from './fixtures/web-parts.mjs';
import { switchOnFreshDevice } from './fixtures/r6B-switch.mjs';

const read = p => withShellParts(withWebParts(readFileSync(new URL('../' + p, import.meta.url), 'utf8')));
const SWITCH = 'wizard/app-windows';
const ORIGIN = 'https://wizard.example';
const APPS = [
  { id: 'wizard-health', name: 'Health', kind: 'wizard', url: '/wizard-health/' },
  { id: 'messenger', name: 'Messenger', kind: 'wizard', url: '/messenger/' },
  { id: 'messenger-labs', name: 'Labs', kind: 'wizard', url: '/messenger/labs/' },
  { id: 'files', name: 'Files', kind: 'system', url: '/files/' },
  { id: 'wizard', name: 'Chats', kind: 'wizard', url: '/wizard-os-home/chats/' },
];

function fixture({ on = false, native = true, answer = true, session = '' } = {}) {
  const switches = [], opens = [], timers = [], observers = [], winListeners = {};
  const root = { dataset: { tweaks: on ? 'wizard/desktop-chats ' + SWITCH : 'wizard/desktop-chats' }, setAttribute() {} };
  const href = ORIGIN + '/wizard-os-home/' + (session ? '?app-session=' + session : '');
  const c = { URL, URLSearchParams, console, JSON, Date, Proxy, Reflect, location: new URL(href),
    document: { readyState: 'complete', hidden: false, documentElement: root, body: { appendChild() {} }, querySelectorAll: () => [],
      createElement: () => ({}), getElementById: () => null, addEventListener() {} },
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe() {} },
    navigator: {}, dispatchEvent() {}, CustomEvent: class {}, localStorage: { getItem: () => null, setItem() {} },
    setInterval() {}, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    addEventListener: (n, f) => (winListeners[n] ||= []).push(f) };
  c.window = c;
  c.WizCore = { apps: () => ({ APPS, APP: Object.fromEntries(APPS.map(a => [a.id, a])) }) };
  if (native) c.WizardOSNative = { appWindowsSwitch: v => switches.push(v), openAppWindow: (id, path, name) => { opens.push([id, path, name]); return answer; } };
  vm.createContext(c);
  for (const f of ['web/core/home-screen-policy.js', 'web/core/deeplink.js', 'web/core/android-relay.js']) vm.runInContext(read(f), c);
  const flip = v => { root.dataset.tweaks = v ? 'wizard/desktop-chats ' + SWITCH : 'wizard/desktop-chats'; for (const o of observers) o.fn([]); };
  const settle = () => { for (const t of timers.filter(t => t.ms === 5000)) t.fn(); };
  const experience = () => { for (const f of winListeners['wos:experience'] || []) f(); };
  return { c, R: c.WizAndroidRelay, switches, opens, flip, settle, experience };
}

test('the main page copies the switch to the Android app: off only once the switches settle, on at once', () => {
  const off = fixture();
  assert.deepEqual(off.switches, []);
  off.settle();
  assert.deepEqual(off.switches, [false]);
  const on = fixture({ on: true });
  assert.deepEqual(on.switches, [true]);
  on.flip(false); assert.deepEqual(on.switches, [true]);
  on.experience(); assert.deepEqual(on.switches, [true, false]);
  on.flip(true); assert.deepEqual(on.switches, [true, false, true]);
});

test('an app window never sets the switch (it never sees the shell switches)', () => {
  const f = fixture({ session: 'wizard-health' });
  f.settle(); f.experience();
  assert.deepEqual(f.switches, []);
});

test('a link to a page of an installed Wizard app asks for that app\'s window at that page', () => {
  const f = fixture({ on: true });
  assert.equal(f.R.appLink(ORIGIN + '/wizard-health/day?d=1#sleep'), true);
  assert.equal(f.R.appLink('/messenger/'), true);
  assert.equal(f.R.appLink('/messenger/labs/x'), true, 'the longest app address wins');
  assert.deepEqual(f.opens, [['wizard-health', '/wizard-health/day?d=1#sleep', 'Health'], ['messenger', '/messenger/', 'Messenger'], ['messenger-labs', '/messenger/labs/x', 'Labs']]);
});

test('a shell link naming an app (…/wizard-os-home/?open=<id>) opens that app at its own start', () => {
  const f = fixture({ on: true });
  assert.equal(f.R.appLink('/wizard-os-home/?open=wizard-health'), true);
  assert.deepEqual(f.opens, [['wizard-health', '', 'Health']]);
});

test('Wizard\'s own pages, other sites, system apps and unknown pages are left to the old way', () => {
  const f = fixture({ on: true });
  for (const href of ['/wizard-os-home/', '/wizard-os-home/?session=abc', '/wizard-os-home/?view=chats', '/wizard-os-home/chats/x',
    '/wizard-os-home/?open=files', '/wizard-os-home/?open=nope', 'https://elsewhere.example/wizard-health/', '/files/x', '/not-an-app/',
    '/wizard-health%2f../x', 'javascript:alert(1)']) assert.equal(f.R.appLink(href), false, href);
  assert.deepEqual(f.opens, []);
});

test('switch off (the Android app answers false) or no bridge: the link keeps its old way', () => {
  const off = fixture({ answer: false });
  assert.equal(off.R.appLink('/wizard-health/'), false);
  assert.equal(off.opens.length, 1);
  const browser = fixture({ native: false });
  assert.equal(browser.R.appLink('/wizard-health/'), false);
  assert.equal(browser.R.openAppWindow('wizard-health'), false);
});

test('inside an app\'s own window, its own links stay in it; other apps open their windows', () => {
  const f = fixture({ on: true, session: 'messenger' });
  assert.equal(f.R.appLink('/messenger/chat/1'), false);
  assert.equal(f.R.appLink('/wizard-health/'), true);
  assert.deepEqual(f.opens, [['wizard-health', '/wizard-health/', 'Health']]);
});

test('openAppWindow (a notification\'s Open) checks the app and that the page lies inside it', () => {
  const f = fixture({ on: true });
  assert.equal(f.R.openAppWindow('wizard-health'), true);
  assert.equal(f.R.openAppWindow('wizard-health', '/wizard-health/day'), true);
  assert.equal(f.R.openAppWindow('wizard-health', '/messenger/'), false, 'a page of another app');
  assert.equal(f.R.openAppWindow('wizard-health', 'https://elsewhere.example/wizard-health/'), false);
  assert.equal(f.R.openAppWindow('files'), false, 'not a Wizard app');
  assert.equal(f.R.openAppWindow('nope'), false);
  assert.deepEqual(f.opens, [['wizard-health', '', 'Health'], ['wizard-health', '/wizard-health/day', 'Health']]);
});

// The real link code (core/links.js) in a vm, with a stand-in Android relay that takes links to Health.
function linkPaths() {
  const calls = [], origin = 'https://wizard.example';
  class El {
    constructor() { this.handlers = {}; this.nodes = {}; this.style = {}; this.classList = { add() {}, remove() {}, contains: () => false, toggle: () => false }; this.contentWindow = { location: { replace() {} } }; }
    setAttribute() {} appendChild() {} remove() {} querySelector(q) { return this.nodes[q] ||= new El(); } addEventListener(n, fn) { (this.handlers[n] ||= []).push(fn); } click() { calls.push(['download', this.href]); }
  }
  const document = { body: new El(), createElement: () => new El() };
  const w = { open: url => calls.push(['browser', url]), WizConfig: { raw: {}, localURL: (h, b) => new URL(h, b) },
    WizAndroidRelay: { appLink: href => (calls.push(['relay', href]), href.includes('/wizard-health/')) },
    WizCore: { deeplink: { route: href => (calls.push(['route', href]), true), isOwn: () => false, parse: () => null } } };
  vm.runInNewContext(readFileSync(new URL('../web/core/links.js', import.meta.url), 'utf8'), { window: w, location: new URL(origin + '/wizard-os-home/'), navigator: { userAgent: 'fixture', userActivation: { isActive: true } },
    localStorage: { getItem: () => null, setItem() {} }, document, URL, console, setTimeout, clearTimeout, performance: { now: () => 0 }, Date, JSON, Object, Set });
  const L = w.WizLinks.mount({ readerApp: () => null, asWindow: path => (calls.push(['window', path]), true) });
  const chat = new El(); w.WizLinks.intercept(chat, L);
  const doc = new El(); w.WizLinks.guardFrame({ document: doc, location: new URL(origin + '/search/'), open() {}, frameElement: {} }, '/search/', L);
  const click = (root, href) => {
    const a = { ownerDocument: document, getAttribute: k => (k === 'href' ? href : null), hasAttribute: () => false, closest: q => (q === '[data-mi]' || q === '[data-chats]' ? null : {}) };
    const e = { button: 0, target: { closest: () => a }, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    for (const fn of root.handlers.click || []) fn(e);
    return e;
  };
  return { calls, w, chat, doc, click, follow: href => w.WizLinks.follow(null, href) };
}

test('every link path asks first: chat links, links in app frames, sandboxed app links, notification Open, ?open= intents', () => {
  const health = 'https://wizard.example/wizard-health/day', notes = 'https://wizard.example/notes/';
  // A chat link, a link in an app frame and a followed link (a sandboxed app's link.open): the relay first ...
  for (const [name, run] of [['chat', f => f.click(f.chat, '/wizard-health/day')], ['app frame', f => f.click(f.doc, '/wizard-health/day')], ['follow', f => f.follow(health)]]) {
    const f = linkPaths(); run(f);
    assert.deepEqual(f.calls, [['relay', health]], `${name}: the app's own window takes it, nothing else runs`);
    // ... and a link it does not take goes on to the usual route.
    const g = linkPaths(); if (name === 'chat') g.click(g.chat, '/notes/'); else if (name === 'app frame') g.click(g.doc, '/notes/'); else g.follow(notes);
    assert.deepEqual(g.calls, [['relay', notes], ['route', notes]], `${name}: asked before the deeplink route`);
  }
  // Notification Open (core/skin-host-tweaks.js): the app's own window first, the shell's openApp only when it declines.
  const host = read('web/core/skin-host.js'), at = host.indexOf('      open(id) {'), end = host.indexOf('\n      },\n', at);
  const opened = [], relay = [];
  const ctx = vm.createContext({ a: { dead: false }, URL, location: new URL('https://wizard.example/wizard-os-home/'),
    window: { WosBell: { item: id => ({ notes: { app: 'notes', open: '/notes/page/2' }, plain: { app: 'notes' } })[id] }, WizOpenApp: (...x) => (opened.push(x), true),
      WizAndroidRelay: { openAppWindow: (app, path) => (relay.push([app, path]), app === 'notes' && path === '/notes/page/2') }, WizCore: { apps: () => ({ APPS: [{ id: 'notes', url: '/notes/' }] }) } } });
  vm.runInContext(`this.api = {\n${host.slice(at, end + 8)}\n};`, ctx);
  assert.equal(ctx.api.open('notes'), true);
  assert.deepEqual(relay, [['notes', '/notes/page/2']]); assert.deepEqual(opened, [], 'its own window took it');
  assert.equal(ctx.api.open('plain'), true);
  assert.deepEqual(relay.at(-1), ['notes', '']); assert.deepEqual(opened, [['notes']], 'declined: the shell opens the app');
  // ?open= intents (web/app.js deeplink handlers' app()): the app's own window first.
  const app = read('web/app.js'), ai = app.indexOf('    app(id, srcEl) {'), ae = app.indexOf('\n    },\n', ai);
  const shown = [], asked = [];
  const actx = vm.createContext({ APP: { notes: { id: 'notes' } }, W: {}, appVars: { W: {} }, findApp: () => null, fromOf: () => null, openApp: a => shown.push(a.id), Promise,
    window: { WizAndroidRelay: { openAppWindow: id => (asked.push(id), id === 'health') }, WizCore: { appsLoaded: () => null } } });
  vm.runInContext(`this.h = {\n${app.slice(ai, ae + 7)}\n};`, actx);
  actx.h.app('health'); actx.h.app('notes');
  assert.deepEqual(asked, ['health', 'notes']); assert.deepEqual(shown, ['notes']);
});

// The real single-app-session.js (an app's own window) in a vm, as tests/browser-boundary-other-frames.test.mjs runs it.
async function appWindow(search) {
  const box = 'https://box.example';
  const pw = {}, pctx = vm.createContext({ window: pw, document: { documentElement: { setAttribute() {} } }, location: { origin: box, search }, URL, URLSearchParams, Object, Proxy, Reflect });
  launcherFixture(pctx); vm.runInContext(read('web/core/home-screen-policy.js'), pctx);
  let frame; const replaced = [];
  function el(tag) {
    return { tag, dataset: {}, attrs: {}, style: { setProperty() {} }, classList: { add() {}, remove() {} }, children: [], events: {},
      setAttribute(k, v) { this.attrs[k] = String(v); }, hasAttribute(k) { return k in this.attrs; }, getAttribute(k) { return this.attrs[k] ?? null; },
      appendChild(child) { this.children.push(child); if (child.tag === 'iframe') frame = child; }, replaceChildren() { this.children = []; }, append() {},
      addEventListener(type, fn) { this.events[type] = fn; }, remove() {}, get isConnected() { return true; } };
  }
  const host = el('host'), document = { documentElement: el('html'), getElementById: () => host, addEventListener() {}, createElement: el, title: '' };
  const app = { id: 'wisdom', name: 'Wisdom', kind: 'wizard', url: '/wisdom/' };
  const window = { WizHomeScreenPolicy: pw.WizHomeScreenPolicy, WizCore: { apps: () => ({ APP: { wisdom: app } }), appsLoaded: () => Promise.resolve() },
    WizAppServices: { attach: () => () => {}, guardBack() {}, back: () => 'pending' } };
  const store = new Map();
  const ctx = vm.createContext({ window, document, localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem() {} },
    location: { origin: box, href: box + '/wizard-os-home/' + search, search }, URL, URLSearchParams,
    history: { state: null, replaceState: (st, t, u) => replaced.push(u) }, addEventListener() {}, setInterval() {}, setTimeout() {} });
  vm.runInContext(read('web/core/single-app-session.js'), ctx); await new Promise(setImmediate);
  return { frame: () => frame, window, replaced, go: p => window.__wosSessionGo(p) };
}

test('an app window opens at the linked page (once, then the address forgets it), only inside the app', async () => {
  const w = await appWindow('?app-session=wisdom&app-path=' + encodeURIComponent('/wisdom/book/3?q=1#p2'));
  assert.equal(w.frame().src, 'https://box.example/wisdom/book/3?q=1#p2');
  assert.deepEqual(w.replaced, ['/wizard-os-home/?app-session=wisdom'], 'a reload never replays the link');
  const outside = await appWindow('?app-session=wisdom&app-path=' + encodeURIComponent('/messenger/x'));
  assert.equal(outside.frame().src, '/wisdom/', 'a page of another app is ignored: the app\'s own start');
  const plain = await appWindow('?app-session=wisdom');
  assert.equal(plain.frame().src, '/wisdom/');
  assert.deepEqual(plain.replaced, []);
});

test('an open app window follows a later link to one of its pages, never to anything else', async () => {
  const w = await appWindow('?app-session=wisdom');
  assert.equal(w.go('/wisdom/book/9'), true);
  assert.equal(w.frame().src, 'https://box.example/wisdom/book/9');
  for (const bad of ['/messenger/', '/wizard-os-home/', 'https://elsewhere.example/wisdom/', '/wisdom%2f../x', 42]) assert.equal(w.go(bad), false, String(bad));
  assert.equal(w.frame().src, 'https://box.example/wisdom/book/9');
});

// Not run here (wizard-ux issue 1674): this pinned Java/Swift source text and no JDK runs it in this suite. Android wiring of App windows: the admission rule itself runs in the JVM suite (AppWindowsPolicyTest).
test('the switch is in the catalog, off by default, and names its issue', async () => {
  // what Settings › Look lists on a fresh device (core/experience.js over the shipped catalog and manifest)
  const l = await switchOnFreshDevice(SWITCH);
  assert.equal(l.manifest?.id, SWITCH, 'listed');
  assert.deepEqual(l.manifest.issues, ['humanitylabs-org/wizard-os#650']);
  assert.equal(l.row?.on, false); assert.equal(l.running, false, 'off by default');
  assert.deepEqual(l.presetsRunning, [], 'no author preset turns it on');
  assert.equal(l.canTurnOn, true, 'the owner can switch it on');
});
