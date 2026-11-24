// One left/right open model (Miguel, 4 Nov 2026, AI apps round 21): a layout may place every open the shell starts by
// itself (a notification's Open, a link tapped in a reply, a launcher pick, an app's Reply / chat, the view bound beside
// a thread) through the layout API's apps.routeOpens. Guards:
//   - nobody holding it = stock: routeOpen() answers null and the shell runs its own go, byte for byte (Desks);
//   - a holder sees (kind, detail, go), its go() result comes back as { value }; opens it starts while it runs are never
//     routed again (no loop); teardown releases it; shows(desk) admits an app's Reply on a desk shown beside the chat;
//   - every shell entry point asks it first on both shells, with the stock path as go (each entry point run);
//   - bound-view: the auto-opened view beside a thread asks 'beside' first and opens nothing when told so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withSkinHostParts } from './fixtures/skin-host-parts.mjs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { between, block } from './fixtures/source-slice.mjs';
import { holder, runHeld, callsOf } from './fixtures/r8B-route.mjs';
import { withParts } from './fixtures/chats-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';

const root = new URL('../', import.meta.url);
const read = p => withShellParts(readFileSync(new URL(p, root), 'utf8'));
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
  vm.runInNewContext(withSkinHostParts(read('web/core/skin-host.js')), ctx);
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
  const H = hostWorld(); H.host.attach(H.adapter); H.host.setLayout('ai-apps'); await settle();
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

test('a routed app can place its original checked opener on a desk exactly once', async () => {
  const H = hostWorld(); H.host.attach(H.adapter); H.host.setLayout('ai-apps'); await H.host.whenLayoutReady();
  H.adapter.openAppDesk = (id, place) => { assert.equal(id, 'app-store'); return place(3); };
  H.api.apps.routeOpens({ open(kind, d, go) { H.api.apps.openDesk(d.id, go); go(7); return true; } });
  const placed = [];
  const result = H.host.routeOpen('app', { id: 'app-store' }, desk => { placed.push(desk); return true; });
  assert.deepEqual(placed, [3]); assert.equal(result.value, true);
  H.host.setLayout('classic'); await H.host.whenLayoutReady();
  assert.equal(H.api.apps.openDesk('app-store', () => assert.fail('stale API')), false);
});

test('the layout API lists the new app hooks (and only layouts get them)', async () => {
  const H = hostWorld(); H.host.attach(H.adapter); H.host.setLayout('ai-apps'); await settle();
  for (const k of ['routeOpens', 'path', 'openLink']) assert.equal(typeof H.api.apps[k], 'function', k);
  H.host.setLayout('classic'); await settle();
});

// Runs each real desktop entry point (desktop-resize.js, desktop-boot.js, desktop-frames.js) with no holder, a holder
// that runs the stock go it was given, and a holder that keeps the open (tests/fixtures/r8B-route.mjs).
const raw = p => readFileSync(new URL(p, root), 'utf8');
const rec = (calls, name, ret) => (...a) => { calls.push([name, ...a]); return typeof ret === 'function' ? ret(...a) : ret; };
const apps = rel => (rel.startsWith('/files') ? { id: 'files', name: 'Files' } : rel.startsWith('/notes') ? { id: 'notes', name: 'Notes' } : null);
test('every shell entry point asks the layout first, with the stock path as its go (desktop)', () => {
  const resize = raw('web/desktop/desktop-resize.js'), boot = raw('web/desktop/desktop-boot.js'), frames = raw('web/desktop/desktop-frames.js');
  const run = (mode, arg, code, more = {}) => { const h = holder(mode, arg), calls = []; const c = runHeld(code, { calls, newWin: rec(calls, 'newWin', { id: 'n1' }), appAt: apps, ...more(calls) }, h); return { h, c, calls, newWin: () => callsOf(c, 'newWin') }; };
  // WizOpenApp at a page (a notification's Open, the Morning button)
  const wiz = block(resize, "  window.WizOpenApp = (id, path = '') => {") + ';';
  const wizCtx = calls => ({ hostedOpenable: id => ({ id }), openApp: rec(calls, 'openApp', true), desktopVars: { ws: [{ focus: 'w1' }], cur: 0 } });
  const page = { app: 'frame', appId: 'files', url: '/files/b', workflow: true, returnWid: 'w1' };
  for (const [mode, wins] of [['none', [[page]]], ['take', [[page]]], ['keep', []]]) {
    const r = run(mode, undefined, wiz, wizCtx);
    assert.equal(r.c.window.WizOpenApp('files', '/files/b'), true, `WizOpenApp ${mode}`);
    assert.deepEqual(r.h.asked, [['app', { id: 'files', path: '/files/b' }]], `WizOpenApp ${mode}: asks first`);
    assert.deepEqual(r.newWin(), wins, `WizOpenApp ${mode}: the stock window only when stock runs`);
  }
  // openApp (launcher, commands): an app where the layout shows apps; a desk the shell was given stays stock's
  const open = block(resize, '  function openApp(a, opts = {}) {') + '\nglobalThis.openApp = openApp;';
  const files = { id: 'files', url: '/files/', kind: 'wizard' };
  for (const [mode, wins] of [['none', [[{ app: 'frame', appId: 'files' }, {}]]], ['take', [[{ app: 'frame', appId: 'files' }, { ws: 1 }]]], ['keep', []]]) {
    const r = run(mode, 1, open, () => ({ desktopVars: { ws: [{}, {}], cur: 0 } }));
    assert.equal(r.c.openApp(files), true);
    assert.deepEqual(r.h.asked, [['app', { id: 'files', path: '' }]], `openApp ${mode}: asked once (the go never asks again)`);
    assert.deepEqual(r.newWin(), wins, `openApp ${mode}`);
  }
  { const r = run('keep', 1, open, () => ({ desktopVars: { ws: [{}, {}], cur: 0 } }));
    r.c.openApp(files, { ws: 0 }); r.c.openApp({ id: 'wizard', kind: 'chats' }, {}); r.c.openApp(files, { path: '/files/x', ws: 1 });
    assert.deepEqual(r.h.asked, [], 'a given desk or Chats is never routed'); }
  { const r = run('keep', 1, open, () => ({ desktopVars: { ws: [{}, {}], cur: 0 } })); r.c.openApp(files, { path: '/files/x' });
    assert.deepEqual(r.h.asked, [['app', { id: 'files', path: '/files/x' }]], 'a spoken route\'s page rides along'); }
  // a link tapped in a reply (openAppLink)
  const link = block(resize, '  function openAppLink(url, title, setupChecked = false) {') + '\nglobalThis.openAppLink = openAppLink;';
  for (const [mode, ws] of [['none', {}], ['take', { ws: 2 }]]) {
    const r = run(mode, 2, link, () => ({ desktopVars: { ws: [{}, {}, {}] } }));
    assert.equal(r.c.openAppLink('/files/x', 'Report'), true);
    assert.deepEqual(r.h.asked, [['link', { url: '/files/x', title: 'Report', app: 'files' }]]);
    assert.deepEqual(r.newWin(), [[{ app: 'frame', appId: 'files', url: '/files/x', title: 'Files' }, ws]], `openAppLink ${mode}`);
  }
  // a page link anywhere in the shell (core/links.js asWindow)
  const links = between(boot, '  const LINKS = window.WizLinks ?', '  /* Links into installed apps') + '\nglobalThis.LINKS = LINKS;';
  for (const [mode, ws] of [['none', {}], ['take', { ws: 1 }]]) {
    const r = run(mode, 1, links, () => ({ window: { WizLinks: { mount: o => o } }, APP: {}, APPS: [], desktopVars: { ws: [{}, {}] } }));
    assert.equal(r.c.LINKS.asWindow('/notes/n1', 'Note'), true);
    assert.deepEqual(r.h.asked, [['link', { url: '/notes/n1', title: 'Note', app: 'notes' }]]);
    assert.deepEqual(r.newWin(), [[{ app: 'frame', url: '/notes/n1', title: 'Notes', preview: true, appId: 'notes' }, ws]], `asWindow ${mode}`);
  }
  // an app's Reply and its chats (WizAppServices.attach options of an app window)
  const attach = frames.split('\n').find(l => l.includes('f._appDetach = window.WizAppServices?.attach('));
  const app = (mode, arg) => { const h = holder(mode, arg), calls = []; let o = null;
    const CHATS = { openHosted: rec(calls, 'openHosted', true), openContextDraft: rec(calls, 'openContextDraft', { receipt: 1 }), renderChats() {}, isHosted: () => false };
    runHeld(attach, { calls, a: { id: 'wisdom', url: '/wisdom/' }, f: { frame: 1 }, w: { id: 'w5' }, CHATS, pal: { hidden: true }, desktopVars: { homeOpen: true, ws: [{ wins: [] }], cur: 0, W: {} }, wsOf: () => 2,
      threadFromApp: rec(calls, 'threadFromApp', true), findWin: rec(calls, 'findWin', { id: 'main' }), newWin: rec(calls, 'newWin', { id: 'c1' }), focusWin: rec(calls, 'focusWin'), setTimeout: () => 0,
      window: { WizAppServices: { attach: (_, opts) => { o = opts; return () => {}; } } } }, h);
    return { h, o, names: () => calls.map(c => c[0]).filter(n => ['newWin', 'findWin', 'focusWin', 'openContextDraft', 'openHosted', 'threadFromApp'].includes(n)) }; };
  { const n = app('none'); assert.equal(n.o.openThread('s1', { k: 1 }), true); assert.deepEqual(n.names(), ['openHosted'], 'stock: the thread over the app window');
    const t = app('take'); assert.equal(t.o.openThread('s1', { k: 1 }), true); assert.deepEqual(t.names(), ['threadFromApp'], 'held: the main Chats thread');
    assert.deepEqual(t.h.asked, [['thread', { sid: 's1', from: 'wisdom' }]]); }
  { const n = app('none'); assert.deepEqual({ ...n.o.openContextDraft('k', 'text') }, { receipt: 1 }); assert.deepEqual(n.names(), ['newWin', 'focusWin', 'openContextDraft'], 'stock: a Chats here');
    const t = app('take'); t.o.openContextDraft('k', 'text'); assert.deepEqual(t.names(), ['findWin', 'focusWin', 'openContextDraft'], 'held: the main Chats wherever it is');
    assert.deepEqual(t.h.asked, [['draft', { from: 'wisdom' }]]); }
  assert.equal(app('none').o.isVisible(), false); assert.equal(app('take', 2).o.isVisible(), true, 'admitted on a desk the layout shows'); assert.equal(app('take', 3).o.isVisible(), false);
  // the layout's own placers: only a page the app itself owns, same-origin links only
  const ad = runHeld(`globalThis.ad = {\n${between(boot, '    showAppPath: (id, path) =>', '    // The Orb and Apps views\' app sheet')}\n};`,
    { appAt: apps, framePage: () => true, findWin: () => ({ app: 'frame', appId: 'files' }), freshDesk: () => ({ wins: [] }), newWin: () => ({}), goWs() {}, desktopVars: { W: {}, ws: [{ wins: [], focus: '' }], cur: 0 } }, holder()).ad;
  assert.equal(ad.showAppPath('files', '/files/x'), true); assert.equal(ad.showAppPath('files', '/notes/x'), false, 'only a page the app itself owns');
  assert.equal(ad.showAppPath('files', 'https://elsewhere.test/files/x'), false);
  assert.equal(ad.openLinkDesk('/notes/x', 'N'), true); assert.equal(ad.openLinkDesk('https://elsewhere.test/x', 'X'), false, 'same-origin links only');
});

// Runs each real phone entry point (app-search.js, app-model.js, app-linkdesk.js, app-cards.js, app-agentorb.js) and the
// Chats helper an app's thread goes through (chats.js openHosted / prepThread), held and not.
test('every shell entry point asks the layout first, with the stock path as its go (phone)', () => {
  const search = raw('web/app-search.js'), model = raw('web/app-model.js'), linkdesk = raw('web/app-linkdesk.js'), cards = raw('web/app-cards.js'), orb = raw('web/app-agentorb.js');
  const run = (mode, code, more) => { const h = holder(mode), calls = []; const c = runHeld(code, { calls, appAt: apps, ...more(calls) }, h); return { h, c, calls, of: n => callsOf(c, n) }; };
  // WizOpenApp, with and without a page
  const wiz = block(search, "  window.WizOpenApp = (id, path = '') => {") + ';';
  const wizCtx = calls => ({ hostedOpenable: id => ({ id }), openApp: rec(calls, 'openApp', true), openWin: rec(calls, 'openWin', { id: 'n1' }), fromOf: () => ({ desk: 'd1', win: 'w1' }), appVars: { desks: [{ focus: 'w1' }], idx: 0 } });
  for (const [mode, n] of [['none', 1], ['take', 1], ['keep', 0]]) {
    const r = run(mode, wiz, wizCtx);
    assert.equal(r.c.window.WizOpenApp('files'), true);
    assert.equal(r.c.window.WizOpenApp('files', '/files/b'), true);
    assert.deepEqual(r.h.asked, [['app', { id: 'files', path: '' }], ['app', { id: 'files', path: '/files/b' }]], `WizOpenApp ${mode}`);
    assert.equal(r.of('openApp').length, n, `WizOpenApp ${mode}: the stock open only when stock runs`);
    assert.deepEqual(r.of('openWin'), n ? [[{ app: 'frame', appId: 'files', url: '/files/b', from: { desk: 'd1', win: 'w1', sid: '' }, workflow: true }]] : []);
  }
  // a chat's app button (H.openApp)
  const hOpen = `globalThis.ad = {\n${model.split('\n').find(l => /^\s+openApp: \(id, srcEl\) =>/.test(l))}\n};`;
  for (const [mode, n] of [['none', 1], ['take', 1], ['keep', 0]]) {
    const r = run(mode, hOpen, calls => ({ hostedOpenable: id => ({ id }), openApp: rec(calls, 'openApp', true), appVars: { W: {} } }));
    assert.equal(r.c.ad.openApp('files', null), true); assert.deepEqual(r.h.asked, [['app', { id: 'files', path: '' }]]);
    assert.equal(r.of('openApp').length, n, `H.openApp ${mode}`);
  }
  // a link tapped in a reply or an app (openLinkDesk)
  const ld = block(linkdesk, '  function openLinkDesk(href, fromEl, setupChecked = false) {') + '\nglobalThis.openLinkDesk = openLinkDesk;';
  for (const [mode, n] of [['none', 1], ['take', 1], ['keep', 0]]) {
    const r = run(mode, ld, calls => ({ linkDesk: rec(calls, 'linkDesk', true), openWin: rec(calls, 'openWin', {}), appVars: { desks: [{ focus: 'w1' }], idx: 0, W: {} } }));
    assert.equal(r.c.openLinkDesk('/files/x', null), true); assert.deepEqual(r.h.asked, [['link', { url: '/files/x', title: '', app: 'files' }]]);
    assert.equal(r.of('linkDesk').length, n, `openLinkDesk ${mode}`); if (n) assert.equal(r.of('linkDesk')[0][1], '/files/x');
  }
  { const r = run('none', ld, calls => ({ linkDesk: rec(calls, 'linkDesk', true), appVars: { desks: [{ focus: 'w1' }], idx: 0, W: {} } }));
    assert.equal(r.c.openLinkDesk('https://elsewhere.test/x', null), false); assert.deepEqual(r.h.asked, [], 'other origins never routed'); }
  // an app's Reply and its chats (WizAppServices.attach options of an app window)
  const attach = cards.split('\n').find(l => l.includes('f._appDetach = window.WizAppServices?.attach('));
  const app = mode => { const h = holder(mode), calls = []; let o = null;
    const CHATS = { openHosted: rec(calls, 'openHosted', true), prepThread: rec(calls, 'prepThread', true), openContextDraft: rec(calls, 'openContextDraft', { receipt: 1 }), renderChats() {}, isHosted: () => false };
    runHeld(attach, { calls, a: { id: 'wisdom', url: '/wisdom/' }, f: { frame: 1 }, w: { id: 'w5' }, CHATS, appVars: { desks: [{ wins: ['w5'], focus: 'w5' }], idx: 0 }, device: { classList: { contains: () => false } },
      closeSheets: rec(calls, 'closeSheets'), openWizardThread: rec(calls, 'openWizardThread'), placeApp: rec(calls, 'placeApp', { id: 'c1' }),
      window: { WizAppServices: { attach: (_, opts) => { o = opts; return () => {}; } } } }, h);
    return { h, o, names: () => calls.map(c => c[0]).filter(n => ['openHosted', 'prepThread', 'closeSheets', 'openWizardThread', 'placeApp', 'openContextDraft'].includes(n)) }; };
  { const n = app('none'); assert.equal(n.o.openThread('s1', {}), true); assert.deepEqual(n.names(), ['openHosted'], 'stock: the thread over the app window');
    const t = app('take'); assert.equal(t.o.openThread('s1', {}), true); assert.deepEqual(t.names(), ['prepThread', 'closeSheets', 'openWizardThread'], 'held: the main Chats thread, item and agent brought along');
    assert.deepEqual(t.h.asked, [['thread', { sid: 's1', from: 'wisdom' }]]); }
  for (const mode of ['none', 'take']) { const r = app(mode); assert.deepEqual({ ...r.o.openContextDraft('k', 'text') }, { receipt: 1 });
    assert.deepEqual(r.names(), ['closeSheets', 'placeApp', 'openContextDraft'], `draft ${mode}`); }
  assert.deepEqual(app('keep').h.asked, []); { const k = app('keep'); k.o.openContextDraft('k', 't'); assert.deepEqual(k.h.asked, [['draft', { from: 'wisdom' }]]); assert.deepEqual(k.names(), []); }
  // the layout's placer: only a page the app itself owns
  const ad = runHeld(`globalThis.ad = {\n${between(orb, '    showAppPath: (id, path) =>', '    phoneDesks:')}\n};`,
    { appAt: apps, framePage: () => true, deskOf: () => 0, appVars: { W: { f1: { id: 'f1', app: 'frame', appId: 'files' } }, desks: [{ focus: 'f1' }], idx: 0 } }, holder()).ad;
  assert.equal(ad.showAppPath('files', '/files/x'), true); assert.equal(ad.showAppPath('files', '/notes/x'), false); assert.equal(ad.showAppPath('files', 'https://elsewhere.test/files/x'), false);
  // chats.js: the app's thread is prepared (item, agent) before anything else, over the app or the main Chats
  const ch = withParts(read('web/core/chats.js'));
  for (const ok of [false, true]) {
    const calls = [], doc = createDocument(), container = doc.createElement('div'), frame = doc.createElement('iframe'); container.append(frame);
    const win = doc.createElement('div'); win.dataset.win = 'w'; win.append(container); doc.body.append(win);
    const c = runHeld(block(ch, '  function openHosted(wid, frame, sid, opts = {}) {') + '\nglobalThis.openHosted = openHosted;',
      { calls, W: { w: { id: 'w', appId: 'wisdom' } }, hosted: new Map([['w', {}]]), prepThread: rec(calls, 'prepThread', ok), closeHosted: rec(calls, 'closeHosted'), document: doc, getComputedStyle: () => ({ position: 'relative' }),
        window: { WizLauncher: { hasHostedThread: () => true } } }, holder());
    c.openHosted('w', frame, 's1', { k: 1 });
    assert.deepEqual(calls.map(x => x[0]).filter(n => n === 'prepThread' || n === 'closeHosted'), ok ? ['prepThread', 'closeHosted'] : ['prepThread'], `prepThread ${ok}: first, and a refusal opens nothing`);
  }
  const exp = runHeld(`globalThis.api = ${between(ch, '  return { beforeNavigate:', '\n};').replace(/^\s*return /, '')}`, { calls: [] }, holder()); // the slice ends with the object's own };
  exp.api.prepThread('s1', { k: 1 }); assert.deepEqual(callsOf(exp, 'prepThread'), [['s1', { k: 1 }]], 'Chats hands the shells its prepThread');
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
