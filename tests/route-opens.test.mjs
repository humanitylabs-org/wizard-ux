// One left/right open model (Miguel, 4 Nov 2026, AI apps round 21): a layout may place every open the shell starts by
// itself (a notification's Open, a link tapped in a reply, a launcher pick, an app's Reply / chat, the view bound beside
// a thread) through the layout API's apps.routeOpens. Guards:
//   - nobody holding it = stock: routeOpen() answers null and the shell runs its own go, byte for byte (Desks, Orb, Apps);
//   - a holder sees (kind, detail, go), its go() result comes back as { value }; opens it starts while it runs are never
//     routed again (no loop); teardown releases it; shows(desk) admits an app's Reply on a desk shown beside the chat;
//   - every shell entry point asks it first on both shells, with the stock path as go (source pins);
//   - bound-view: the auto-opened view beside a thread asks 'beside' first and opens nothing when told so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const settle = () => new Promise(r => setTimeout(r, 15));

function hostWorld() {
  const el = tag => ({ tag, nodeType: 1, dataset: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() {} });
  const ls = { _: {}, getItem(k) { return this._[k] ?? null; }, setItem(k, v) { this._[k] = String(v); }, removeItem(k) { delete this._[k]; } };
  const ctx = {
    console: { warn() {}, log() {} }, URL, URLSearchParams, location: { search: '' }, Date, Promise, Set, Map, Object, Array, JSON, Math, Error, String, Blob, structuredClone,
    setTimeout, clearTimeout, navigator: { userAgent: 'Mozilla/5.0 (Macintosh)' }, matchMedia: () => ({ matches: false }),
    requestAnimationFrame: fn => setTimeout(fn, 0), cancelAnimationFrame: id => clearTimeout(id), localStorage: ls,
    document: { baseURI: 'https://wizard.test/wizard-os-home/', documentElement: { dataset: { shell: 'desktop' } }, createElement: el, head: { appendChild() {} }, querySelector: () => null, getElementById: () => null, addEventListener() {} },
  };
  ctx.window = ctx; ctx.window.WosSkin = { current: 'obsidian', list: [], pkgOf: () => null }; ctx.module = { exports: {} };
  vm.runInNewContext(read('web/core/skin-host.js'), ctx);
  const host = ctx.window.WosSkinHost, calls = []; let api = null;
  host._test.setImporter(async () => ({ default: a => { api = a; return () => calls.push(['teardown']); } }));
  const adapter = {
    route: () => ({ view: 'desk', thread: null, desk: 0, home: true }), back() {}, openList() {}, openThread() {}, goDesk() {}, deskCount: () => 1,
    root: () => null, dock: () => null, locked: () => false, toast() {}, mountHost: () => ({ appendChild() {} }), voiceState: () => ({ state: 'idle' }),
    apps: () => [], openApp: () => true, panelMode() {},
    showAppPath: (id, path) => { calls.push(['path', id, path]); return true; }, openLinkDesk: (url, title) => { calls.push(['link', url, title]); return true; },
  };
  return { host, adapter, calls, get api() { return api; } };
}

test('off (no layout holds it): every open is stock; the hooks answer null / false', () => {
  const H = hostWorld(); H.host.attach(H.adapter);
  let ran = 0;
  assert.equal(H.host.routeOpen('app', { id: 'files', path: '' }, () => { ran++; return true; }), null, 'stock: the caller opens it');
  assert.equal(H.host.routeOpen('draft', { from: 'files' }), null);
  assert.equal(ran, 0, 'routeOpen never runs the stock go itself: the caller does, exactly as before');
  assert.equal(H.host.routeShows(3), false, 'no layout shows a desk beside the chat');
});

test('on: the layout places opens; go() is the stock way and its value comes back; no loop; released on teardown', async () => {
  const H = hostWorld(); H.host.attach(H.adapter); H.host.setLayout('orb'); await settle();
  const api = H.api; assert.ok(api?.apps?.routeOpens, 'layouts get apps.routeOpens');
  const seen = []; let inner = 'unset';
  const off = api.apps.routeOpens({
    open(kind, d, go) {
      seen.push([kind, { ...d }]); assert.ok(Object.isFrozen(d), 'details are read-only');
      if (kind === 'beside') return true;
      if (kind === 'app') { inner = H.host.routeOpen('app', { id: d.id }, () => 'nested'); return true; }
      if (kind === 'draft') { go(); go(); return true; }
      return false;
    },
    shows: desk => desk === 4,
  });
  assert.equal(typeof off, 'function');
  assert.deepEqual({ ...H.host.routeOpen('beside', { url: '/x/' }, () => assert.fail('no view beside the thread')) }, { value: undefined });
  assert.ok(H.host.routeOpen('app', { id: 'files', path: '/files/a' }));
  assert.equal(inner, null, 'an open the layout starts while placing one takes the stock way (never routed again)');
  let n = 0; const r = H.host.routeOpen('draft', { from: 'files' }, () => { n++; return { kind: 'unsent-draft' }; });
  assert.equal(n, 1, 'go runs once however often it is called'); assert.equal(r.value.kind, 'unsent-draft', 'the stock receipt comes back');
  assert.equal(H.host.routeOpen('link', { url: '/p', app: '' }, () => true), null, 'false = not placed: the caller opens it the stock way');
  assert.deepEqual(seen.map(s => s[0]), ['beside', 'app', 'draft', 'link']);
  assert.equal(H.host.routeShows(4), true); assert.equal(H.host.routeShows(2), false);
  // the narrow helpers it places them with
  assert.equal(api.apps.path('files', '/files/a?x=1'), true); assert.equal(api.apps.path('Bad Id', '/x'), false); assert.equal(api.apps.path('files', ''), false);
  assert.equal(api.apps.openLink('/p/q', 'Q'), true);
  assert.deepEqual(H.calls.filter(c => c[0] !== 'teardown'), [['path', 'files', '/files/a?x=1'], ['link', '/p/q', 'Q']]);
  // teardown: back to stock
  H.host.setLayout('classic'); await settle();
  assert.equal(H.host.routeOpen('app', { id: 'files' }, () => true), null, 'off again: stock'); assert.equal(H.host.routeShows(4), false);
  assert.equal(api.apps.path('files', '/files/b'), false, 'stale handles are inert');
});

test('the layout API lists the new app hooks (and only layouts get them)', async () => {
  const H = hostWorld(); H.host.attach(H.adapter); H.host.setLayout('orb'); await settle();
  for (const k of ['routeOpens', 'path', 'openLink']) assert.equal(typeof H.api.apps[k], 'function', k);
  H.host.setLayout('classic'); await settle();
});

test('every shell entry point asks the layout first, with the stock path as its go (desktop)', () => {
  const src = read('web/desktop/desktop.js');
  const R = "window.WosSkinHost?.routeOpen?.(";
  // a notification's Open (inboxAct 'app' -> WizOpenApp), the Morning button, the launcher, commands: WizOpenApp / openApp
  assert.match(src, /const go = \(\) => !!newWin\(\{ app: 'frame', appId: id, url: rel, workflow: true, returnWid: ws\[cur\]\.focus \}\);\n\s*\/\/[^\n]*\n\s*const r = window\.WosSkinHost\?\.routeOpen\?\.\('app', \{ id, path: rel \}, go\); if \(r\) return true;\n\s*return go\(\);/);
  assert.ok(src.includes(`if (a.url && a.kind !== 'chats' && opts.ws == null && !opts.fresh && ${R}'app', { id: a.id, path: '' }, () => openApp(a, opts))) return true;`), 'openApp: an app (never a given desk) where the layout shows apps');
  // a link tapped in a reply (chats.js H.openLink -> openAppLink)
  assert.ok(src.includes(`const r = ${R}'link', { url, title: String(title || ''), app: a ? a.id : '' }, go); if (r) return true;`));
  // a page link anywhere in the shell (core/links.js: a reply's link no app owns, a link inside an app)
  assert.ok(src.includes(`return ${R}'link', { url, title: String(title || ''), app: o ? o.id : '' }, go) ? true : go(); },`));
  // an app's Reply and its chats: the main Chats wherever it is; admitted on a desk the layout shows
  assert.ok(src.includes(`const r = ${R}'draft', { from: a.id }, () => go(true));`));
  assert.ok(src.includes(`const r = ${R}'thread', { sid, from: a.id }, () => threadFromApp(sid, opts)); return r ? r.value === true : CHATS.openHosted(w.id, f, sid, opts);`));
  assert.ok(src.includes("|| (pal.hidden && !CHATS.isHosted(w.id) && !!window.WosSkinHost?.routeShows?.(wsOf(w.id)))"));
  assert.match(src, /showAppPath: \(id, path\) =>[\s\S]{0,400}appAt\(rel\)\?\.id !== id\) return false;/, 'only a page the app itself owns');
  assert.match(src, /openLinkDesk: \(url, title\) =>[\s\S]{0,300}u\.origin !== location\.origin\) return false;/, 'same-origin links only');
});

test('every shell entry point asks the layout first, with the stock path as its go (phone)', () => {
  const src = read('web/app.js');
  const R = "window.WosSkinHost?.routeOpen?.(";
  assert.ok(src.includes(`return ${R}'app', { id, path: rel }, go) ? true : go();`), 'WizOpenApp with a page');
  assert.ok(src.includes(`if (!path) { const r = ${R}'app', { id, path: '' }, () => openApp(x)); return r ? true : openApp(x); }`), 'WizOpenApp');
  assert.ok(src.includes(`return ${R}'app', { id, path: '' }, go) ? true : go(); },`), "a chat's app button (H.openApp)");
  assert.ok(src.includes(`const routed = ${R}'link', { url: rel, title: '', app: targetApp ? targetApp.id : '' }, () => linkDesk(u, rel, srcId));`));
  assert.ok(src.includes(`const r = ${R}'draft', { from: a.id }, go);`)); assert.ok(src.includes(`const r = ${R}'thread', { sid, from: a.id },`));
  assert.match(src, /showAppPath: \(id, path\) =>[\s\S]{0,400}appAt\(rel\)\?\.id !== id\) return false;/);
  // chats.js: an app's thread brings its agent and item along wherever it opens (one helper, over the app or the main Chats)
  const ch = read('web/core/chats.js');
  assert.match(ch, /if \(!prepThread\(sid, opts\)\) return false;\n\s*if \(hosted\.has\(wid\)\) closeHosted\(wid\);/);
  assert.match(ch, /openHosted, prepThread, closeHosted,/);
});

test('bound view: asks the layout first; told so, nothing opens beside the thread; stock opens it as before', () => {
  const run = holder => {
    const opened = [], ctx = { URL, location: { href: 'https://wizard.test/wizard-os-home/', origin: 'https://wizard.test' }, window: {} };
    ctx.window.WizCore = { deeplink: null }; ctx.window.WosSkinHost = holder;
    vm.runInNewContext(read('web/core/bound-view.js'), ctx);
    const a = { getAttribute: () => '/files/report', hasAttribute: () => false, closest: () => null };
    const msg = { textContent: 'see the report', querySelectorAll: () => [a] };
    const el = { querySelectorAll: s => s === '.ch-msgs .msg.a' ? [msg] : [], querySelector: () => null };
    const w = { id: 'c1', app: 'chats', thread: 's1' };
    const B = ctx.window.WosBoundView.create({ windows: () => [w], win: () => w, findApp: () => null, APP: {}, appAt: () => ({ id: 'files', name: 'Files' }), linkTitle: () => 'Page', title: () => 'Chat',
      visible: () => true, close() {}, reload() {}, open: obj => opened.push(obj.url) });
    B.shown('c1', el); return opened;
  };
  assert.deepEqual(run(undefined), ['/files/report'], 'stock: the view opens beside its thread');
  assert.deepEqual(run({ routeOpen: () => null }), ['/files/report'], 'nobody holding it: stock');
  const asked = [];
  assert.deepEqual(run({ routeOpen: (k, d) => { asked.push([k, d.url, d.app]); return { value: undefined }; } }), [], 'held: no view beside the thread');
  assert.deepEqual(asked, [['beside', '/files/report', 'files']]);
});
