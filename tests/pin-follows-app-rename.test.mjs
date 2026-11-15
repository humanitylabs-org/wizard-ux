// ux#1471 (James's phone, 15 Nov 2026): a home-screen pin made while Search was `search-preview` showed "App unavailable"
// after the box renamed it to `wizard-search` (wizard.md `renamed_from: [search-preview]`). The registry now resolves
// an installed app's declared earlier ids, so the single-app session mounts the renamed app; a gone id still fails.
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

const search = { id: 'wizard-search', name: 'Search', url: '/wizard-search/', source: 'apps.json', renamed_from: ['old-search', 'notes', '../x', 'wizard-search'] };
const notes = { id: 'notes', name: 'Notes', url: '/notes/', source: 'apps.json' };

test('an installed app answers to the ids it declares in renamed_from, never shadowing an installed app', () => {
  const r = registry([search, notes]);
  assert.equal(r.APP['old-search'], r.APP['wizard-search']);
  assert.equal(r.APP.notes.id, 'notes', 'a declared old id that another installed app still has stays that app');
  assert.equal(r.APP['../x'], undefined);
  assert.equal(r.APPS.filter(a => a.id === 'wizard-search').length, 1, 'no second tile for the old id');
  assert.equal(registry([{ ...search, source: 'launcher.json' }]).APP['old-search'], undefined, 'only installed apps (apps.json) declare renames');
});

test('the Search pin made as search-preview resolves before the box list carries renamed_from', () => {
  const r = registry([{ id: 'wizard-search', name: 'Search', url: '/wizard-search/', source: 'apps.json' }]);
  assert.equal(r.APP['search-preview'], r.APP['wizard-search']);
});

async function session(pinned, apps) {
  const r = registry(apps);
  const params = new URLSearchParams({ 'app-session': pinned });
  const pwin = {};
  const pctx = vm.createContext({ window: pwin, document: { documentElement: { setAttribute() {} } }, location: { origin: 'https://box.example', search: '?' + params }, URL, URLSearchParams, Object, Proxy, Reflect, localStorage: { getItem: () => null, setItem() {} } });
  vm.runInContext(read('core/home-screen-policy.js'), pctx);
  let frame = null, attached = null, hosted = null; const texts = [];
  function el(tag) { return { tag, dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {} }, children: [], setAttribute() {}, addEventListener() {},
    set textContent(v) { texts.push(v); }, appendChild(c) { this.children.push(c); if (c.tag === 'iframe') frame = c; }, append(...c) { this.children.push(...c); }, replaceChildren() { this.children = []; } }; }
  const host = el('host');
  const document = { documentElement: el('html'), getElementById: () => host, addEventListener() {}, createElement: el, title: '' };
  const window = { WizHomeScreenPolicy: pwin.WizHomeScreenPolicy, WizCore: { apps: () => r, appsLoaded: () => Promise.resolve() }, WosSelMenu: { back: () => false },
    WizAppServices: { attach: (f, o) => { attached = o; return () => {}; }, guardBack() {} },
    WizChatsHost: { create: o => { hosted = o; return { bind() {}, forget() {}, isHosted: () => false }; } } };
  const ctx = vm.createContext({ window, document, localStorage: { getItem: () => null, setItem() {} }, location: { origin: 'https://box.example' }, URL, addEventListener() {}, setInterval() {}, setTimeout() {} });
  vm.runInContext(read('core/single-app-session.js'), ctx); await new Promise(setImmediate);
  return { frame, attached, texts, hostThreadAppId: hosted?.win('single-app')?.appId };
}

test('a pin made under a renamed app id mounts the renamed app with its current id', async () => {
  const s = await session('old-search', [search]);
  assert.ok(s.frame, 'the app frame is mounted');
  assert.equal(s.frame.src, '/wizard-search/');
  assert.equal(s.attached.appId, 'wizard-search');
  assert.equal(s.hostThreadAppId, 'wizard-search', 'hosted Chats threads are checked against the current id');
  assert.ok(!s.texts.includes('App unavailable'));
});

test('a pin for an app no installed app claims still shows App unavailable', async () => {
  const s = await session('gone-app', [search]);
  assert.equal(s.frame, null);
  assert.ok(s.texts.includes('App unavailable'));
});

test('an offline-declared app is published for offline pins under its earlier ids too', async () => {
  const puts = [];
  const caches = { open: async () => ({ match: async () => null, put: async (u, r) => puts.push(await r.text()) }) };
  const window = {};
  const ctx = vm.createContext({ window, globalThis: null, caches, Response: class { constructor(b) { this.b = b; } text() { return this.b; } }, navigator: {}, URL });
  ctx.globalThis = ctx;
  vm.runInContext(read('core/offline-session.js'), ctx);
  const offline = ctx.WizOfflineSession || window.WizOfflineSession;
  await offline.publish([{ id: 'wizard-search', source: 'apps.json', homeScreen: { offline: true }, renamedFrom: ['old-search'] }, { id: 'plain', source: 'apps.json', renamedFrom: ['old-plain'] }]);
  assert.deepEqual(JSON.parse(puts[0]).ids, ['old-search', 'wizard-search']);
});
