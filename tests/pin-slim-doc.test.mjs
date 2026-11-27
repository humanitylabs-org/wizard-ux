// wizard-ux issue 1584: a pinned app (home-screen icon) loaded the whole phone shell, about 120 scripts, before its
// app could start. core/pin-doc.js (first script of index.html, on for everyone since the switch wizard/pin-slim-doc
// was removed) stops the page and builds the pinned-app host from the same release: every stylesheet in order, only
// the scripts needed to open the app, the rest once the app has loaded; and Wizard's first server read starts from
// the page head. In any page that is not a pinned session, nothing changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createDocument } from './fixtures/mini-dom.mjs';

const read = path => readFileSync(new URL('../web/' + path, import.meta.url), 'utf8');
const WORN = 'wizard/sent-threads';
const INDEX = read('index.html');

function indexFiles() {
  return [...INDEX.matchAll(/<(script|link)\b[^>]*?\b(?:src|href)="([^"]+)"[^>]*>/g)].map(m => m[2])
    .filter(f => /\.(js|css)$/.test(f) && f !== 'core/pin-doc.js');
}

// A small DOM: enough for pin-doc.js (head, meta, created elements, appended scripts that "load" on demand).
function page({ search = '?app-session=wizard-search', pathname = '/wizard-os-home/', worn = [], release = '', body = null } = {}) {
  const head = [], scripts = [], log = [];
  const el = tag => ({ tag, dataset: {}, attrs: {}, children: [], setAttribute(k, v) { this.attrs[k] = v; }, append(...c) { this.children.push(...c); } });
  const html = { dataset: {}, children: [], append(c) { this.children.push(c); } };
  const document = {
    documentElement: html, body, baseURI: 'https://box.example' + pathname,
    head: { append(n) { head.push(n); if (n.tag === 'script') scripts.push(n); } },
    querySelector: s => s === 'meta[name="wos-release"]' && release ? { content: release } : null,
    createElement: el,
  };
  const store = new Map([['wos.tweaks.expect', JSON.stringify(worn)]]);
  const fetches = [];
  const window = { stop: () => log.push('stop'), fetch: (u, o) => { fetches.push([u, o]); return Promise.resolve({ ok: true, u }); }, dispatchEvent: () => true };
  const ctx = vm.createContext({ window, document, location: { search, pathname }, localStorage: { getItem: k => store.get(k) ?? null },
    URL, URLSearchParams, CustomEvent: class { constructor(t) { this.type = t; } }, console });
  vm.runInContext(read('core/pin-doc.js'), ctx);
  // Scripts "run" in order when asked to; each load fires onload.
  const run = async n => { for (const s of scripts.slice(0, n)) if (!s.ran) { s.ran = true; s.onload?.(); await null; } };
  const runAll = async () => { for (let i = 0; i < 5; i++) { await run(scripts.length); await new Promise(setImmediate); } };
  const P = window.WizPinDoc;
  return { window, html, head, scripts, log, fetches, run, runAll, P, FILES: JSON.parse(JSON.stringify(P.FILES)) };
}
const files = p => p.scripts.map(s => new URL(s.src).pathname.replace('/wizard-os-home/', ''));

test("pin-doc.js lists index.html's scripts and stylesheets exactly, in order", () => {
  const P = page({ search: '' });
  assert.deepEqual(P.FILES.map(([, f]) => f), indexFiles(),
    'index.html changed: add the file to FILES in web/core/pin-doc.js in the same place (e = needed to open a pinned app, x = afterwards, c = stylesheet)');
  for (const [k, f] of P.FILES) assert.equal(k === 'c', f.endsWith('.css'), `${f}: kind ${k}`);
  const mod = new Set([...INDEX.matchAll(/<script type="module" src="([^"]+)"/g)].map(m => m[1]));
  for (const [k, f] of P.FILES) if (mod.has(f)) assert.equal(k, 'm', `${f} is a module script`);
});

test('pin-doc.js runs right after shell-token.js (which must run once, first), before anything else', () => {
  const headSrc = INDEX.slice(0, INDEX.indexOf('</head>'));
  const scripts = [...headSrc.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(scripts.slice(0, 2), ['core/shell-token.js', 'core/pin-doc.js']);
  assert.equal(page({ search: '' }).FILES.filter(([k]) => k === 'h').map(([, f]) => f).join(), 'core/shell-token.js', 'only what ran above it is marked h');
  assert.doesNotMatch(read('app-session.html'), /src="core\/pin-doc\.js"/, 'the offline host never runs the slim page');
  assert.doesNotMatch(read('desktop.html'), /pin-doc/);
});

// wizard-ux issue 1694: the one-app page (app-session.html) gave an app on its own none of the chat/live services
// (WizLive, WosChat, the Chats host...), so TG style showed 'Open Telegram from Wizard'. It now loads the same
// stylesheets and scripts a pinned app gets in the shell (FILES kinds c, e, a, x, m), in index.html order.
test('app-session.html loads every stylesheet and script a pinned app gets in the shell, in order', () => {
  const html = read('app-session.html');
  const loaded = [...html.matchAll(/<(script|link)\b[^>]*?\b(?:src|href)="([^"]+)"[^>]*>/g)].map(m => m[2]);
  const { FILES } = page({ search: '' });
  // Never the phone/desktop choice (a one-app page is always this page), and never what does nothing in a session.
  const NEVER = new Set(['core/shell.js']);
  const want = FILES.filter(([k, f]) => 'caexm'.includes(k) && !NEVER.has(f)).map(([, f]) => f);
  for (const f of want) assert.ok(loaded.includes(f), `app-session.html must load ${f} (it is in core/pin-doc.js FILES)`);
  for (const [k, f] of FILES) if (k === 's' || k === 'h' || NEVER.has(f)) assert.ok(!loaded.includes(f), `app-session.html must not load ${f}`);
  assert.equal(new Set(loaded).size, loaded.length, 'each file once');
  // Scripts in the shell's order, apart from the few the offline host runs first in its head (kept as they were).
  const HEAD = ['core/browser-boundary.js', 'core/home-screen-capabilities.js', 'core/home-screen-policy.js', 'core/offline-session.js', 'core/offline-kit.js', 'core/skin-frame.js', 'core/skins.js'];
  const js = loaded.filter(f => f.endsWith('.js') && !HEAD.includes(f));
  assert.deepEqual(js, want.filter(f => f.endsWith('.js') && !HEAD.includes(f)), 'scripts in index.html order');
  assert.ok(js.indexOf('live.js') < js.indexOf('core/single-app-session.js') && js.indexOf('core/chats.js') < js.indexOf('core/single-app-session.js'),
    'WizLive and the Chats host exist before the app frame is made');
  // how the page loads them (its markup parsed into the small DOM, as the browser reads it)
  const doc = createDocument(); doc.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>[\s\S]*$/i, '');
  const script = f => doc.querySelector(`script[src="${f}"]`);
  assert.equal(script('core/thread-swipe-back.js').getAttribute('type'), 'module');
  assert.ok(script('core/experience.js').hasAttribute('defer'));
});

test('not a pinned session, or another address: nothing happens', () => {
  for (const opts of [{ search: '' }, { search: '?session=x' }, { pathname: '/wizard-os-home/app-session.html' },
    { pathname: '/wizard-os-home/desktop.html' }, { body: {} }]) {
    const p = page(opts);
    assert.equal(p.P.active, false, JSON.stringify(opts));
    assert.deepEqual(p.log, []); assert.equal(p.head.length, 0); assert.equal(p.html.dataset.pinDoc, undefined);
    assert.equal(p.P.takeBootstrap(), null);
  }
});

test('the switch is gone: a pinned session always gets the slim page, whatever the worn list holds', () => {
  for (const worn of [[], 'x', ['wizard/pin-slim-doc'], [WORN]]) {
    const p = page({ worn });
    assert.equal(p.P.active, true, JSON.stringify(worn)); assert.deepEqual(p.log, ['stop']);
    assert.equal('SWITCH' in p.P, false);
  }
  assert.equal(page({ worn: 'x' }).html.dataset.tweaks, '', 'a broken worn list paints no tweaks');
  const cat = JSON.parse(readFileSync(new URL('../web/tweaks/catalog.json', import.meta.url), 'utf8'));
  assert.ok(![...cat.tweaks, ...(cat.defaults || [])].includes('wizard/pin-slim-doc'), 'no longer a switch');
});

test('pinned session: the page stops, every stylesheet comes first in order, then only the scripts that open the app', async () => {
  const p = page({ release: 'abc123def456', worn: [WORN, 'wizard/thread-tracker'] });
  assert.equal(p.P.active, true);
  assert.deepEqual(p.log, ['stop']);
  assert.equal(p.html.dataset.pinDoc, '1');
  assert.equal(p.html.dataset.tweaks, WORN + ' wizard/thread-tracker', 'the worn tweaks are painted, so other switches still read');
  const css = p.head.filter(n => n.tag === 'link');
  assert.deepEqual(css.map(l => new URL(l.href).pathname.replace('/wizard-os-home/', '')), p.FILES.filter(([k]) => k === 'c').map(([, f]) => f));
  assert.ok(css.every(l => l.attrs.blocking === 'render' && new URL(l.href).searchParams.get('v') === 'abc123def456'), 'render-blocking, same release');
  assert.ok(p.head.indexOf(css.at(-1)) < p.head.indexOf(p.scripts[0]));
  assert.ok(p.head.some(n => n.tag === 'meta' && n.name === 'viewport'));
  const eager = p.FILES.filter(([k]) => k === 'e').map(([, f]) => f);
  assert.deepEqual(files(p), eager);
  assert.ok(eager.length < 40 && eager.at(-1) === 'core/single-app-session.js');
  assert.ok(p.scripts.every(s => s.async === false && new URL(s.src).searchParams.get('v') === 'abc123def456'));
  assert.equal(p.html.children[0].tag, 'body');
  assert.equal(p.html.children[0].children[0].id, 'device');
  for (const f of ['app.js', 'device.js', 'core/chats.js', 'live.js', 'orb.js', 'core/shell-token.js']) assert.ok(!eager.includes(f), f + ' not now');
});

test('pinned session: the rest arrives once asked, after the first scripts, once', async () => {
  const p = page();
  let arrived = false; p.P.arrived().then(() => { arrived = true; });
  await p.runAll();
  assert.equal(arrived, false, 'nothing more without asking');
  const n = p.scripts.length;
  const a = p.P.extras(), b = p.P.extras();
  assert.equal(a, b, 'asked twice, loaded once');
  await p.runAll();
  assert.equal(await a, true); assert.equal(arrived, true);
  const rest = files(p).slice(n);
  assert.deepEqual(rest, [...p.FILES.filter(([k]) => k === 'a'), ...p.FILES.filter(([k]) => k === 'x'), ...p.FILES.filter(([k]) => k === 'm')].map(([, f]) => f),
    'classic scripts in order, then the module (it reads WosSkinHost from skin-host.js when it runs)');
  assert.ok(p.FILES.some(([k]) => k === 'm'));
  assert.ok(rest.includes('core/chats.js') && rest.includes('live.js') && rest.includes('core/chats-view.js'));
  for (const f of ['app.js', 'device.js', 'pwa-install.js']) assert.ok(!files(p).includes(f), f + ' never runs in a pinned session');
  assert.equal(p.scripts.find(s => s.src.includes('thread-swipe-back')).type, 'module');
});

// wizard-ux issue 1696: an app reads parent.WizLive (and WosChat, WosModels, WizUploads, WosBell) from its first script.
test('pinned session: the services an app reads at load come first when asked, then the rest, in the same order', async () => {
  const p = page();
  await p.runAll();
  const n = p.scripts.length;
  let done = false; const s = p.P.services(); s.then(() => { done = true; });
  assert.equal(p.P.services(), s, 'asked twice, loaded once');
  await p.runAll();
  assert.equal(done, true);
  const kind = k => p.FILES.filter(([x]) => x === k).map(([, f]) => f);
  const first = files(p).slice(n);
  assert.deepEqual(first, kind('a'), 'the app services, in FILES order');
  for (const f of ['live.js', 'core/chat-kit.js', 'core/chat-models.js', 'core/uploads.js', 'core/notif-bell.js']) {
    assert.ok(first.includes(f), f + ' before the app frame');
    assert.equal(p.FILES.find(([, x]) => x === f)[0], 'a', f + ' is kind a');
  }
  for (const f of ['core/chats.js', 'core/settings.js', 'core/skin-host.js', 'core/chat-topic-emojis-data.js', 'core/chat-power.js']) assert.ok(!first.includes(f), f + ' waits until after the app');
  const e = p.P.extras(); await p.runAll(); assert.equal(await e, true);
  assert.deepEqual(files(p).slice(n), [...kind('a'), ...kind('x'), ...kind('m')], 'then the rest, each once');
});

test('pinned session: bootstrap starts at once from the page head (fetch is already the owner-header one), taken once', async () => {
  const p = page();
  assert.equal(p.fetches.length, 1);
  assert.equal(p.fetches[0][0], '/wizard/v1/bootstrap');
  assert.deepEqual({ ...p.fetches[0][1] }, { credentials: 'same-origin', cache: 'no-store' });
  const first = p.P.takeBootstrap();
  assert.ok(first && typeof first.then === 'function');
  assert.equal(p.P.takeBootstrap(), null, 'taken once');
});

test('config.js uses the read the page head started, and starts its own without it', async () => {
  const run = early => {
    const calls = [];
    const window = { addEventListener() {}, dispatchEvent() {}, WizPinDoc: early === undefined ? undefined : { takeBootstrap: () => { const p = early; early = null; return p; } } };
    const ctx = vm.createContext({ window, document: { addEventListener() {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      fetch: async u => { calls.push(u); return { ok: true, json: async () => ({ bootstrap: 2, from: 'own' }) }; },
      CustomEvent: class {}, Intl, Date, URL, console });
    ctx.self = window;
    vm.runInContext(read('core/config.js'), ctx);
    return { calls, C: window.WizConfig };
  };
  const mine = run(Promise.resolve({ ok: true, json: async () => ({ bootstrap: 2, from: 'head' }) }));
  await mine.C.ready;
  assert.deepEqual(mine.calls, [], 'no second bootstrap read');
  const own = run(undefined); await own.C.ready;
  assert.deepEqual(own.calls, ['/wizard/v1/bootstrap']);
  const none = run(null); await none.C.ready;
  assert.deepEqual(none.calls, ['/wizard/v1/bootstrap'], 'nothing started (not a pinned session): its own read');
});

// The real single-app-session.js on the slim page: no Chats host yet.
function session({ slim, host }) {
  const params = new URLSearchParams({ 'app-session': 'wisdom' });
  const pwin = {};
  vm.runInContext(read('core/home-screen-policy.js'), vm.createContext({ window: pwin, document: { documentElement: { setAttribute() {} } },
    location: { origin: 'https://box.example', search: '?' + params }, URL, URLSearchParams, Object, Proxy, Reflect, localStorage: { getItem: () => null, setItem() {} } }));
  const apps = { APP: { wisdom: { id: 'wisdom', name: 'Wisdom', url: '/wisdom/', kind: 'wizard' } }, APPS: [] };
  const frames = [], listeners = {}, opened = [], idle = [];
  function el(tag) { return { tag, dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {} }, children: [], isConnected: true, setAttribute() {}, remove() {},
    addEventListener(t, fn) { (this.on ||= {})[t] = fn; }, set textContent(v) {}, set innerHTML(v) { this.children = []; },
    appendChild(c) { this.children.push(c); if (c.tag === 'iframe') frames.push(c); }, append(...c) { this.children.push(...c); }, replaceChildren() { this.children = []; } }; }
  const html = el('html'); html.dataset.tweaks = '';
  let attached = null, arrive;
  const arrived = new Promise(ok => { arrive = ok; });
  let asked = 0, served = 0, serve;
  const services = new Promise(ok => { serve = ok; });
  const WizChatsHost = { create: () => ({ bind() {}, forget() {}, isHosted: () => false, openHosted: (...a) => { opened.push(a); return true; } }) };
  const window = { WizHomeScreenPolicy: pwin.WizHomeScreenPolicy, WizCore: { apps: () => apps, appsLoaded: () => new Promise(() => {}) },
    WizAppServices: { attach: (f, o) => { attached = o; return () => {}; }, guardBack() {} },
    requestIdleCallback: fn => idle.push(fn),
    ...(host ? { WizChatsHost } : {}),
    ...(slim ? { WizPinDoc: { active: true, services: () => { served++; return services; }, extras: () => { asked++; return arrived; }, arrived: () => arrived } } : {}) };
  const document = { documentElement: html, getElementById: () => el('host'), addEventListener() {}, createElement: el, title: '' };
  vm.runInContext(read('core/single-app-session.js'), vm.createContext({ window, document, localStorage: { getItem: () => null, setItem() {} },
    location: { origin: 'https://box.example' }, URL, addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); }, setInterval() {}, setTimeout }));
  return { frames, opened, idle, attached: () => attached, asked: () => asked, served: () => served,
    serve: async () => { serve(true); await new Promise(setImmediate); },
    arrive: async () => { window.WizChatsHost = WizChatsHost; arrive(true); await new Promise(setImmediate); } };
}

test('slim page: the app frame is made once the services it reads at load have run; the rest after it loaded (issue 1696)', async () => {
  const s = session({ slim: true, host: false });
  await new Promise(setImmediate);
  assert.ok(s.served() >= 1, 'the app services are asked for at once');
  assert.equal(s.frames.length, 0, 'no frame before parent.WizLive and the rest are there');
  assert.equal(s.asked(), 0, 'not the whole rest');
  await s.serve();
  assert.equal(s.frames.length, 1, 'mounted once they have run');
  assert.equal(s.asked(), 0, 'nothing more while the app is loading');
  s.frames[0].on.load();
  assert.equal(s.idle.length, 1); s.idle[0]();
  assert.equal(s.asked(), 1);
});

test('slim page: a thread the app asks for before the Chats host arrived opens once it is there', async () => {
  const s = session({ slim: true, host: false });
  await s.serve();
  assert.equal(s.attached().openThread('t1', { reply: true }), true, 'accepted');
  assert.equal(s.asked(), 1, 'first use asks for the rest');
  assert.deepEqual(s.opened, []);
  await s.arrive();
  assert.equal(s.opened.length, 1);
  assert.equal(s.opened[0][0], 'single-app'); assert.equal(s.opened[0][1], s.frames[0]); assert.equal(s.opened[0][2], 't1');
  assert.equal(s.attached().openThread('t2'), true, 'later: straight through');
  assert.equal(s.opened.length, 2);
});

test('app-session.html (no slim page): the Chats host is there from the start, as before', async () => {
  const s = session({ slim: false, host: true });
  await new Promise(setImmediate);
  assert.equal(s.attached().openThread('t1'), true);
  assert.equal(s.opened.length, 1);
  s.frames[0].on.load?.();
  assert.equal(s.idle.length, 0, 'no extra loading in the full shell');
  const none = session({ slim: false, host: false });
  await new Promise(setImmediate);
  assert.equal(none.attached().openThread('t1'), false, 'no host, no slim page: refused as before');
});
