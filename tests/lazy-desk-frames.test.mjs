// Lazy desk frames: opening the shell with many restored desks (Miguel's synced workspace has ~20, one app each)
// must not load every app at once. Only the desk in view, plus the last desks used on this device, get their app's
// page on open; any other desk's app loads the first time that desk comes into view, and stays loaded after.
// Runs the real phone part (web/app-windows.js) and the real desktop mountWin/wake code on the small DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createDocument } from './fixtures/mini-dom.mjs';
import { between, block } from './fixtures/source-slice.mjs';

const memStore = (seed = {}) => { const m = { ...seed }; return { m, get: (k, d) => (k in m ? m[k] : d), set: (k, v) => { m[k] = v; } }; };

function phone({ count = 6, idx = 0, recent = [] } = {}) {
  const doc = createDocument();
  doc.body.innerHTML = '<div class="nebula"></div><div id="track"></div>';
  const track = doc.querySelector('#track');
  const W = {}, desks = [{ id: 'home', home: true, wins: [], focus: null }];
  for (let i = 1; i < count; i++) { W['w' + i] = { id: 'w' + i, app: 'frame', appId: 'app' + i }; desks.push({ id: 'd' + i, wins: ['w' + i], focus: 'w' + i }); }
  const appVars = { W, desks, idx };
  const store = memStore({ recentDesks: recent });
  const window = { WizCore: {}, WosAgents: { titlebar: () => '' }, WosBoundView: { badge: () => '' } };
  const watched = [];
  const ctx = vm.createContext({ window, document: doc });
  vm.runInContext(fs.readFileSync(new URL('../web/app-windows.js', import.meta.url), 'utf8'), ctx);
  const $ = (s, r = doc) => r.querySelector(s), $$ = (s, r = doc) => r.querySelectorAll(s);
  const APP = {}; for (let i = 1; i < count; i++) APP['app' + i] = { id: 'app' + i, name: 'App ' + i, url: `/app${i}/` };
  let parts; parts = window.WizCore.appParts.windows({ $, $$, agentApp: () => ({}), agentWin: () => false, APP, appVars, CHATS: {}, esc: s => String(s), HOME: 0,
    ico: () => '', LIVE: null, MAXW: 4, OUTBOX: null, parkDesks: () => parts.wakeDesk(), /* app.js parkDesks ends with wakeDesk() */ refreshModes: [], RELOAD_BTN: '', renderChats: () => {}, store,
    syncImmersive: () => {}, track, winApp: w => APP[w.appId] });
  // The real frame markup (web/app-frame.js renderFrame) is what the windows hold; a stub with the same <iframe> shape.
  parts.bindLate({ closeWin() {}, paintHome() {}, renderApp: () => '', renderDots() {}, renderEmpty: () => '', renderHome: () => '', renderMoons() {}, rideSettings() {}, syncReviewChip() {},
    renderFrame: w => `<div class="frame-wrap loading"><div class="frame-loading" role="status"></div><iframe class="appframe" data-own-app="${w.appId}" src="/${w.appId}/"></iframe><div class="frame-fallback"></div></div>`,
    watchFrames: el => watched.push(el.dataset.win) });
  parts.buildDesks();
  const frames = () => [...track.querySelectorAll('iframe')].map(f => f.getAttribute('src'));
  const go = n => { appVars.idx = n; parts.placeTrack(0, true); parts.syncDesks(); }; // goDesk: placeTrack, then scheduleParking → parkDesks
  return { parts, appVars, store, track, frames, go, watched };
}

test('phone: only the desk in view mounts its app frame on open', () => {
  const s = phone({ count: 21, idx: 0 });
  assert.deepEqual(s.frames(), [], 'Home in view: no app on any of the 20 restored desks loads');
  assert.equal(s.track.querySelectorAll('.wbody[data-lazy-frame]').length, 20, 'every window waits for its desk');
  assert.equal(s.track.querySelectorAll('.win').length, 20, 'the windows themselves are all there (titles, desk dots, sync)');
  assert.ok(s.track.querySelector('.win[data-win="w5"] .frame-loading'), 'a waiting window shows the same loading veil as a loading app');
});

test('phone: a hidden desk mounts its frame the first time it is shown, and keeps it', () => {
  const s = phone({ count: 6, idx: 0 });
  s.go(3);
  assert.deepEqual(s.frames(), ['/app3/'], 'shown desk loads its app, the others still wait');
  assert.ok(s.watched.includes('w3'), 'the woken frame is watched like any app frame (services, back, parking)');
  const f = s.track.querySelector('iframe');
  s.go(1); s.go(3);
  assert.deepEqual(s.frames().sort(), ['/app1/', '/app3/'], 'the second desk shown loads too, the rest still wait');
  assert.equal(s.track.querySelector('.win[data-win="w3"] iframe'), f, 'a loaded app is never reloaded by coming back');
  assert.deepEqual([...s.store.m.recentDesks], ['d3', 'd1', 'home'], 'the desks used are remembered, most recent first, at most three');
});

test('phone: the desk in view plus the recently used desks load on open, nothing else', () => {
  const s = phone({ count: 8, idx: 5, recent: ['d5', 'd2', 'd7', 'd1'] });
  assert.deepEqual(s.frames().sort(), ['/app2/', '/app5/', '/app7/'], 'in view + the two used before it (the list keeps three)');
});

function desktop({ count = 6, cur = 0, homeOpen = false, recent = [] } = {}) {
  const src = fs.readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
  const doc = createDocument(); doc.body.innerHTML = '<div id="stage"></div>';
  const stage = doc.querySelector('#stage');
  const W = {}, ws = [];
  for (let i = 0; i < count; i++) { W['w' + i] = { id: 'w' + i, app: 'frame', appId: 'app' + i, url: `/app${i}/` }; ws.push({ id: 'd' + i, wins: ['w' + i], focus: 'w' + i }); }
  const store = memStore({ recentDesks: recent }), watched = [];
  const ctx = vm.createContext({ document: doc, window: {}, globalThis: {}, W, ws, cur, homeOpen, store, stage, watched,
    $$: (s, r = doc) => r.querySelectorAll(s), wsOf: id => ws.findIndex(d => d.wins.includes(id)), panelHas: () => false,
    winTitle: w => w.appId, threadShown() {}, CHATS: {}, panelDeskApp: () => false, markThreadSeen() {},
    watchFrame: (f, el) => watched.push(el.dataset.win),
    winHtml: w => `<header></header><div class="wbody"><iframe data-own-app="${w.appId}" src="${w.url}"></iframe><div class="frame-fallback"></div></div>` });
  const code = between(src, '  const RECENT_KEEP = 3;', '  function mountWin(w, host) {') + block(src, '  function mountWin(w, host) {')
  vm.runInContext(code + '\n;globalThis.api = { mountWin, wakeAll: wakeShown, setCur: (c, h) => { cur = c; homeOpen = !!h; } };', ctx);
  ws.forEach(d => d.wins.forEach(id => ctx.globalThis.api.mountWin(W[id], stage)));
  const frames = () => [...stage.querySelectorAll('iframe')].map(f => f.getAttribute('src'));
  return { api: ctx.globalThis.api, frames, store, stage, watched };
}

test('desktop: restored desktops out of view mount no frame until shown', () => {
  const s = desktop({ count: 20, cur: 4 });
  s.api.wakeAll();
  assert.deepEqual(s.frames(), ['/app4/'], 'only the desktop in view loads');
  s.api.setCur(11); s.api.wakeAll();
  assert.deepEqual(s.frames().sort(), ['/app11/', '/app4/'], 'a desktop gets its app the first time it is shown');
  assert.ok(s.watched.includes('w11'), 'the woken frame is watched like any other');
  assert.deepEqual([...s.store.m.recentDesks], ['d11', 'd4']);
});

test('desktop: Home open on boot loads only the recently used desktops', () => {
  const s = desktop({ count: 10, cur: 3, homeOpen: true, recent: ['d7', 'd3'] });
  s.api.wakeAll();
  assert.deepEqual(s.frames().sort(), ['/app3/', '/app7/']);
  const t = desktop({ count: 10, cur: 3, homeOpen: true });
  t.api.wakeAll();
  assert.deepEqual(t.frames(), [], 'fresh device on Home: nothing loads behind it');
});
