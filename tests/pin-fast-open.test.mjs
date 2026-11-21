// wizard-ux issue 1558: a pinned app (home-screen icon) waited on bootstrap -> ui-preferences -> apps in a row before
// its frame mounted, behind "Loading app…". Now (on for everyone; the wizard/pin-fast-open switch is gone) the pin
// mounts from this device's last-known app list at once, the fresh list still re-validates (rename, new URL,
// removal), and the launcher reads ui-preferences beside bootstrap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL('../web/' + path, import.meta.url), 'utf8');

function registry(apps) {
  const store = new Map([['wux.apps.v1', JSON.stringify(apps)]]);
  const win = {
    WizCore: {}, location: { origin: 'https://box.example', pathname: '/' },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
  };
  const ctx = { window: win, document: { addEventListener() {}, hidden: false }, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } },
    localStorage: win.localStorage, location: win.location, addEventListener() {}, fetch: async () => ({ ok: false }), setTimeout, clearTimeout, console };
  ctx.self = win; ctx.globalThis = ctx;
  vm.createContext(ctx); vm.runInContext(read('core/apps.js'), ctx);
  return win.WizCore.apps('mobile');
}

const search = { id: 'wizard-search', name: 'Search', url: '/wizard-search/', source: 'apps.json' };

// The real single-app-session.js with the box's list held back until `release()`.
function session(pinned, apps, tweaks) {
  const r = registry(apps);
  const params = new URLSearchParams({ 'app-session': pinned });
  const pwin = {};
  const pctx = vm.createContext({ window: pwin, document: { documentElement: { setAttribute() {} } }, location: { origin: 'https://box.example', search: '?' + params }, URL, URLSearchParams, Object, Proxy, Reflect, localStorage: { getItem: () => null, setItem() {} } });
  vm.runInContext(read('core/home-screen-policy.js'), pctx);
  const frames = []; const texts = []; const listeners = {};
  function el(tag) { return { tag, dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {} }, children: [], setAttribute() {}, addEventListener() {}, remove() {},
    set textContent(v) { texts.push(v); }, set innerHTML(v) { texts.push(v); this.children = []; },
    appendChild(c) { this.children.push(c); if (c.tag === 'iframe') frames.push(c); }, append(...c) { this.children.push(...c); }, replaceChildren() { this.children = []; } }; }
  const host = el('host');
  const html = el('html'); if (tweaks != null) html.dataset.tweaks = tweaks;
  const document = { documentElement: html, getElementById: () => host, addEventListener() {}, createElement: el, title: '' };
  let release; const loaded = new Promise(ok => { release = ok; });
  const window = { WizHomeScreenPolicy: pwin.WizHomeScreenPolicy, WizCore: { apps: () => r, appsLoaded: () => loaded }, WosSelMenu: { back: () => false },
    WizAppServices: { attach: () => () => {}, guardBack() {} },
    WizChatsHost: { create: () => ({ bind() {}, forget() {}, isHosted: () => false }) } };
  const ctx = vm.createContext({ window, document, localStorage: { getItem: () => null, setItem() {} }, location: { origin: 'https://box.example' }, URL,
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); }, setInterval() {}, setTimeout() {} });
  vm.runInContext(read('core/single-app-session.js'), ctx);
  return { r, frames, texts, host, release: async () => { release(); await new Promise(setImmediate); },
    apps: async () => { for (const fn of listeners['wizard:apps'] || []) fn(); await new Promise(setImmediate); } };
}

test('a pin whose app is in the last-known list mounts before the box answers', async () => {
  const s = session('wizard-search', [search], null);
  await new Promise(setImmediate);
  assert.equal(s.frames.length, 1, 'mounted without waiting for appsLoaded');
  assert.equal(s.frames[0].src, '/wizard-search/');
  assert.deepEqual(s.host.children.find(c => c.tag === 'article').children, [s.frames[0]], 'the frame replaced the Loading note');
  await s.release();
  assert.equal(s.frames.length, 1, 'the fresh list with the same URL keeps the mounted frame (no reload)');
});

test('with no switch worn (it was removed), a cached pin still mounts at once', async () => {
  for (const tweaks of [null, '', 'wizard/app-windows']) {
    const s = session('wizard-search', [search], tweaks);
    await new Promise(setImmediate);
    assert.equal(s.frames.length, 1, `mounted without waiting for appsLoaded (tweaks=${tweaks})`);
    await s.release();
    assert.equal(s.frames.length, 1);
  }
});

test('a first run with no cached entry still waits for the list', async () => {
  const s = session('wizard-search', [], null);
  await new Promise(setImmediate);
  assert.equal(s.frames.length, 0);
  assert.ok(!s.texts.includes('App unavailable'), 'no false "unavailable" before the box answered');
});

test('the fresh list still moves, renames and removes the cached mount', async () => {
  const s = session('wizard-search', [search], null);
  await new Promise(setImmediate);
  assert.equal(s.frames.length, 1);
  // The box now serves Search from a new URL: the next registry rebuild (wizard:apps) remounts it there.
  s.r.APP['wizard-search'] = { ...s.r.APP['wizard-search'], url: '/search-next/' };
  await s.apps();
  assert.equal(s.frames.length, 2);
  assert.equal(s.frames[1].src, '/search-next/');
  // Removed from the box: the same path shows App unavailable.
  delete s.r.APP['wizard-search'];
  await s.release();
  assert.ok(s.texts.includes('App unavailable'));
});

test('a pin under an old id (ux#1471 rename) mounts the renamed app from the cache', async () => {
  const s = session('old-search', [{ ...search, renamed_from: ['old-search'] }], null);
  await new Promise(setImmediate);
  assert.equal(s.frames.length, 1);
  assert.equal(s.frames[0].src, '/wizard-search/');
});

// launcher.js: ui-preferences is read beside bootstrap, whatever is worn.
async function launcher(tweaks) {
  const calls = [];
  let bootstrapDone; const ready = new Promise(ok => { bootstrapDone = ok; });
  const store = new Map();
  const window = { WizLauncherDefaults: { hostedThreadApps: [], displayNames: {} }, WizConfig: { ready }, dispatchEvent() {} };
  const ctx = vm.createContext({ window, document: { documentElement: { dataset: tweaks == null ? {} : { tweaks } } }, localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    fetch: async url => { calls.push(url); return { ok: false }; }, AbortSignal: { timeout: () => undefined }, Event: class { constructor(t) { this.type = t; } },
    addEventListener() {}, setTimeout, clearTimeout, Object, JSON });
  vm.runInContext(read('core/launcher.js'), ctx);
  await new Promise(setImmediate);
  const before = [...calls];
  bootstrapDone(); await window.WizLauncher.ready;
  return { before, after: calls };
}

test('the launcher asks for ui-preferences before bootstrap has answered', async () => {
  for (const tweaks of [null, '', 'wizard/pin-fast-open']) {
    const r = await launcher(tweaks);
    assert.deepEqual(r.before, ['/wizard/v1/ui-preferences'], `tweaks=${tweaks}`);
    assert.deepEqual(r.after, ['/wizard/v1/ui-preferences']);
  }
});
