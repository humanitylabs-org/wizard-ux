import { runWithChatsModel, modelContext } from './fixtures/chats-list-model.mjs';
import { between, block, recorder, runRecording } from './fixtures/source-slice.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade, parseCss } from './fixtures/mini-css.mjs';
// The desktop layout host API (core/skin-host.js + desktop.js), kept from tests/orb-layout.test.mjs when the Orb view
// went (wizard-ux issue 1338). The Orb view was its first user; AI apps (the one desktop layout left) still wears it:
//   - a layout gets the shell's own lists and actions (Working / Ready rows, Snooze / Done through Chats' threadAct,
//     apps, Home, Settings › Look) and nothing else; every handle dies with the layout;
//   - skins and tweaks never get the layout-only lists; the panel mode, keys and bound-view hooks stay in desktop.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { fixture } from './fixtures/tweaks.mjs';
import { coreFeatures } from './fixtures/core-features.mjs';
import { withSkinHostParts } from './fixtures/skin-host-parts.mjs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withDesktopParts } from './fixtures/desktop-parts.mjs';
import { desktopKeys } from './fixtures/desktop-keys-harness.mjs';
import { keysGuide } from './fixtures/keys-guide-harness.mjs';
import { desktopBoot, desktopPart } from './fixtures/q1-desktop-boot.mjs';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const settle = () => new Promise(r => setTimeout(r, 15));

function desk({ layout = null } = {}) {
  const mounted = [], links = [], calls = [];
  const el = tag => ({ tag, nodeType: 1, dataset: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() { for (const l of [links, mounted]) { const i = l.indexOf(this); if (i >= 0) l.splice(i, 1); } } });
  const stage = { appendChild(n) { mounted.push(n); } };
  const ls = { _: {}, getItem(k) { return this._[k] ?? null; }, setItem(k, v) { this._[k] = String(v); }, removeItem(k) { delete this._[k]; } };
  if (layout) ls._['wos.layout'] = layout;
  const ctx = {
    console: { warn() {}, log() {} }, URL, URLSearchParams, location: { search: '' }, Date, Promise, Set, Map, Object, Array, JSON, Math, Error, String, Blob, structuredClone,
    setTimeout, clearTimeout, navigator: { userAgent: 'Mozilla/5.0 (Macintosh)' }, matchMedia: () => ({ matches: false }),
    requestAnimationFrame: fn => setTimeout(fn, 0), cancelAnimationFrame: id => clearTimeout(id), localStorage: ls,
    document: { baseURI: 'https://wizard.test/wizard-os-home/', documentElement: { dataset: { shell: 'desktop' } }, createElement: el, head: { appendChild(n) { links.push(n); } }, querySelector: () => null, getElementById: () => null, addEventListener() {} },
  };
  ctx.window = ctx; ctx.window.WosSkin = { current: 'obsidian', list: [], pkgOf: () => null }; ctx.module = { exports: {} };
  runWithChatsModel(withSkinHostParts(read('web/core/skin-host.js')), ctx);
  const host = ctx.window.WosSkinHost; let api = null;
  host._test.setImporter(async () => ({ default: a => { api = a; return () => calls.push(['teardown']); } }));
  const rows = { working: [{ id: 'w1', title: 'Working one', kind: 'working', actions: [] }], ready: [{ id: 'r1', title: 'Ready one', kind: 'ready', needs: true, actions: ['snooze', 'done'] }] };
  const adapter = {
    route: () => ({ view: 'desk', thread: null, desk: 0, home: true }), back() {}, openList() {}, openThread: id => calls.push(['open', id]), goDesk() {}, deskCount: () => 1,
    root: () => null, dock: () => null, locked: () => false, toast() {}, mountHost: () => stage,
    voiceState: () => ({ state: 'idle' }), talk: () => calls.push(['talk']), voiceTap() {}, command: () => { calls.push(['command']); return 'voice'; },
    sessionList: () => rows, sessionAct: (id, act) => { calls.push([act, id]); return true; }, openSessions: kind => calls.push(['list', kind]),
    apps: () => [{ id: 'files', name: 'Files', icon: '<span class="ic sgt"></span>' }], openApp: id => { calls.push(['app', id]); return true; }, openPicker: () => calls.push(['picker']),
    home: () => calls.push(['home']), openSettings: page => calls.push(['settings', page]),
    panelMode: on => calls.push(['panelMode', on]), panelClose: (...w) => { calls.push(['panelClose', ...w]); return true; }, panelBack: () => { calls.push(['panelBack']); return true; },
    panelDock: on => { calls.push(['panelDock', on]); return true; },
    panelState: () => ({ kind: 'thread', title: 'Ready one', width: 484, back: 0 }),
  };
  return { host, ctx, mounted, links, calls, adapter, ls, get api() { return api; } };
}

test('the layout gets the shell\'s own threads, actions, apps and Home; nothing more; all dead after Classic', async () => {
  const D = desk();
  D.host.attach(D.adapter); D.host.setLayout('ai-apps'); await settle();
  const api = D.api; assert.ok(api, 'layout set up');
  assert.ok(Object.isFrozen(api) && Object.isFrozen(api.sessions) && Object.isFrozen(api.apps) && Object.isFrozen(api.desk) && Object.isFrozen(api.voice));
  assert.deepEqual(Object.keys(api.sessions).sort(), ['act', 'archiveOrder', 'channelBack', 'channelFeed', 'channelFeedOpen', 'channelNew', 'channelPost', 'channelView', 'channels', 'chats', 'chatsView', 'list', 'newChat', 'open', 'openList', 'order', 'ownList', 'setOrder', 'setWorkingOrder', 'workingOrder']);
  assert.deepEqual(Object.keys(api.apps).sort(), ['all', 'back', 'badgeText', 'badges', 'close', 'get', 'homeScreen', 'inset', 'kinds', 'list', 'logo', 'open', 'openAny', 'openDesk', 'openLink', 'path', 'routeOpens', 'search', 'store']);
  assert.deepEqual(Object.keys(api.desk).sort(), ['attention', 'classic', 'emptyHome', 'home', 'look', 'setting', 'settings']);
  assert.deepEqual(Object.keys(api.voice).sort(), ['ask', 'cancel', 'command', 'dictate', 'onCommand', 'onTap', 'reply', 'state', 'talk', 'tap']);
  assert.deepEqual(Object.keys(api.panel).sort(), ['back', 'claim', 'close', 'dock', 'park', 'quit', 'running', 'state']); assert.ok(Object.isFrozen(api.panel));
  assert.deepEqual(Object.keys(api.keys).sort(), ['guide', 'on']); assert.ok(Object.isFrozen(api.keys));
  assert.equal(D.host.panelMode, false);
  assert.equal(api.panel.dock(true), false, 'docking needs the panel first');
  api.panel.claim(); assert.equal(D.host.panelMode, true, 'no desks while the layout holds the panel');
  assert.equal(JSON.stringify(api.panel.state()), JSON.stringify({ kind: 'thread', title: 'Ready one', width: 484, back: 0 })); assert.equal(api.panel.close(), true); assert.equal(api.panel.back(), true);
  assert.equal(api.panel.dock(true), true); assert.equal(api.panel.dock(0), true);
  assert.deepEqual(D.calls.splice(0), [['panelMode', true], ['panelClose'], ['panelBack'], ['panelDock', true], ['panelDock', false]]);
  assert.equal(typeof api.orb.ready, 'function');
  const L = api.sessions.list(); assert.equal(L.ready[0].id, 'r1'); L.ready[0].title = 'changed';
  assert.equal(api.sessions.list().ready[0].title, 'Ready one', 'a copy, never the shell\'s rows');
  assert.equal(api.sessions.act('r1', 'snooze'), true); assert.equal(api.sessions.act('r1', 'done'), true);
  assert.equal(api.sessions.act('r1', 'move'), true, 'Move to channel… reaches the shell');
  assert.equal(api.sessions.act('r1', 'delete'), false, 'only the row sheet\'s own actions (Snooze, Done, Mark unread, Restore, Pin, Rename)'); assert.equal(api.sessions.act('', 'done'), false);
  api.sessions.open('r1'); api.sessions.openList('ready'); api.sessions.openList('archive');
  assert.deepEqual({ ...api.apps.badges() }, {}, 'no counts without the shell nav'); assert.ok(Object.isFrozen(api.apps.badges()));
  assert.equal(api.apps.list()[0].id, 'files'); api.apps.open('files'); api.apps.all(); api.desk.home(); api.desk.look();
  assert.equal(api.voice.command(), 'voice'); api.voice.talk();
  assert.equal(D.host.emptyHome, false); api.desk.emptyHome(); assert.equal(D.host.emptyHome, true, 'closing a desk\'s last window goes Home');
  assert.equal(api.route().home, true);
  const mount = { nodeType: 1, remove() { D.mounted.splice(D.mounted.indexOf(this), 1); } }; api.mount(mount); assert.equal(D.mounted.length, 1, 'mounted on the desktop stage');
  assert.deepEqual(D.calls, [['snooze', 'r1'], ['done', 'r1'], ['move', 'r1'], ['open', 'r1'], ['list', 'ready'], ['app', 'files'], ['picker'], ['home'], ['settings', 'look'], ['command'], ['talk']]);
  D.host.setLayout('classic'); await settle();
  assert.equal(D.mounted.length, 0, 'own nodes removed'); assert.deepEqual(D.calls.slice(-2), [['teardown'], ['panelMode', false]], 'the desks come back once it is off');
  assert.equal(D.host.panelMode, false);
  assert.equal(D.host.emptyHome, false, 'desks behave as before once it is off');
  const n = D.calls.length;
  assert.equal(api.sessions.list(), null); assert.equal(api.sessions.act('r1', 'done'), false); api.apps.open('files'); api.desk.home(); api.voice.command();
  assert.equal(api.desk.attention(() => {}), null, 'the cog count is gone too');
  assert.equal(api.apps.list().length, 0); assert.equal(D.calls.length, n, 'stale handles are inert');
  assert.equal(D.ls._['wos.layout'], undefined, 'nothing left stored');
});

test('skins and tweaks never get the layout-only lists or the command take', async () => {
  // A team tweak asking only for the layout capability (as the AI apps view's package did before issue 1352).
  const manifests = { 'miguel/layout-probe': { id: 'miguel/layout-probe', name: 'Probe', version: '1.0.0', author: 'miguel', apiVersion: 1, capabilities: ['layout'] } };
  const f = fixture({ shell: 'desktop', manifests }); let api;
  f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  await f.host.loadTweaks(['miguel/layout-probe'], f.slots, { teamAuthors: ['miguel'] });
  for (const k of ['sessions', 'apps', 'desk', 'voice', 'mount', 'panel', 'keys']) assert.equal(api[k], undefined, k);
  await f.clear();
});

test('the desktop adapter routes Snooze / Done through Chats\' own threadAct and feeds the orb voice and level', () => {
  const src = withDesktopParts(read('web/desktop/desktop.js'));
  // the adapter's sessionAct: Snooze / Done / Restore go to Chats' own threadAct on the main Chats window
  const A = runRecording(`this.sessionAct = ${block(src, '    sessionAct: (sid, act) => {').replace(/^\s*sessionAct: /, '')};`,
    { findWin: () => ({ id: 'c1', app: 'chats' }), mainChats: () => true, window: {} });
  for (const act of ['snooze', 'done', 'restore']) assert.equal(A.sessionAct('r1', act), true, act);
  assert.deepEqual(A.calls.filter(c => c[0] === 'CHATS.threadAct').map(c => c.slice(1)), [['c1', 'r1', 'snooze'], ['c1', 'r1', 'done'], ['c1', 'r1', 'restore']]);
  // the rows' Snooze / Done / Restore are exactly the ones Chats' threadActions offers
  const M = modelContext({}).WizChatsListModel;
  const rows = M.sessionList({ ready: [{ id: 'r1', status: 'completed' }] }, { live: {}, chats: { threadActions: () => ['delete', 'snooze', 'done', 'restore', 'archive'] } });
  assert.deepEqual([...rows.ready[0].actions], ['rename', 'unread', 'snooze', 'done', 'restore']);
  // the orb's voice state and level reach the layout
  const seen = [], el = () => ({ style: { setProperty() {} }, classList: { toggle() {}, add() {} }, disabled: false });
  let h; runRecording(`${block(src, '  const VOICE = C.voice({')});`, { C: { voice: x => { h = x; return { state: 'idle', elapsed: () => 0 }; } }, $: el, pill: el(), mic: el(), glow: el(),
    vMode: 'talk', commandTake: false, vReply: null, vConversation: null, vFeedback: null, vTarget: null, vNewChat: false, vChanKey: false, nativeDesktop: false,
    window: { WosCaptureTools: { awake() {} }, WosSkinHost: { voice: st => seen.push(['voice', st]), level: l => seen.push(['level', l]) } } });
  h.onState('listen'); h.onLevel(0.5);
  assert.deepEqual(seen, [['voice', 'listen'], ['level', 0.5]]);
  // route(): Home counts as open when the desk in front is empty
  const route = home => runRecording(`this.route = function ${block(src, '    route() {').trim()};`, { homeOpen: false, ws: [{ wins: home ? [] : ['w1'] }], cur: 0 }).route();
  assert.equal(route(true).home, true); assert.equal(route(false).home, false);
  // closing a desk's last window: with a layout that has no desk numbers (emptyHome), back to Home
  const close = emptyHome => {
    const C = runRecording(`${block(src, '  function closeWin(id, internal = false) {')}\nthis.closeWin = closeWin;`,
      { canLeave: () => true, hud: null, W: { a: { id: 'a' } }, ws: [{ id: 'd1', wins: [] }, { id: 'd2', wins: ['b'] }], wsOf: () => 0, window: { WosSkinHost: { emptyHome } } });
    C.closeWin('a'); return C.calls.map(c => c[0]);
  };
  assert.ok(close(true).includes('removeDesktop') && close(true).includes('goHome'));
  assert.ok(close(false).includes('removeDesktop') && !close(false).includes('goHome'), 'Classic: the desks as before');
});

// The desktop's real panel code (no desks: a layout holds the panel) over a small desk state and a mini DOM stage.
function panels({ homeOpen = true, desks = [['a1', 'a3'], ['a2']] } = {}) {
  const src = withDesktopParts(read('web/desktop/desktop.js'));
  const doc = createDocument(), stage = doc.createElement('div'); stage.id = 'stage'; doc.body.appendChild(stage);
  const W = {}; for (const id of desks.flat()) W[id] = { id, app: 'chats', thread: null };
  const ws = desks.map((wins, i) => ({ id: 'd' + i, wins: [...wins], focus: wins[0] || null })), saved = new Map();
  const guards = ['newWin', 'goWs', 'reopenClosed', 'jumpBack', 'resizeFocused', 'moveWin', 'swapWin', 'stepDesk', 'stepWin', 'moveDesk', 'closeDesktop', 'hudKey', 'leaveHome', 'findWin', 'escStep', 'closeWin'];
  let n = 0; const calls = [], tasks = [];
  const own = { chatsBack: w => { calls.push(['CHATS.chatsBack', w.id]); w.thread = null; }, openChat: (id, sid) => { calls.push(['CHATS.openChat', id, sid]); W[id].thread = sid; } };
  const CHATS = new Proxy(own, { get: (o, k) => (k in o ? o[k] : recorder(`CHATS.${String(k)}`, calls)) });
  const ctx = runRecording(`${between(src, '  let panel = null;', '\n  let homeOpen')}
${between(src, '  const PANEL_BACK = 6;', '  function paintFocus() {')}
${guards.map(g => block(src, `  function ${g}(`)).join('\n')}
${block(src, '  function syncChatsPane(id) {')}
this.api = { ${guards.join(', ')}, panelMode, panelOpen, panelParkedW, panelDeskClose, panelClose, panelBack, panelDock, panelMount, panelForward, panelThreadLeft, syncChatsPane, panelWins,
  state: () => ({ panel, panelApp, panelList, homeOpen, ws, W }) };`, {
    W, ws, cur: 0, lastWs: 0, homeOpen, hud: null, boundManager: null, document: doc, stage, WosSkinHost: { panelMode: true }, window: { WosAgents: { refreshTitlebars() {} } },
    store: { get: (k, d) => (saved.has(k) ? saved.get(k) : d), set: (k, v) => saved.set(k, v) }, uid: () => 'p' + ++n,
    $: s => doc.querySelector(s), $$: (s, r = doc) => r.querySelectorAll(s), matchMedia: () => ({ matches: true }), canLeave: () => true,
    winEl: id => stage.querySelector(`[data-win="${id}"]`), mountWin: (w, layer) => { const el = doc.createElement('div'); el.className = 'win'; el.dataset.win = w.id; layer.appendChild(el); return el; },
    mainChats: w => w?.app === 'chats' && !w.agent, wsOf: id => ws.findIndex(d => d.wins.includes(id)), freshDesk: () => ({ id: 'new', wins: [], focus: null }),
    CHATS, queueMicrotask: f => tasks.push(f), setTimeout: f => f(), focused: () => null }, calls);
  const flush = () => { while (tasks.length) tasks.shift()(); };
  return { ...ctx.api, ctx, saved, stage, calls, flush, names: () => calls.map(c => c[0]) };
}

test('no desks: while a layout holds the panel everything opens in panels over Home; desks stay put', () => {
  const P = panels();
  const desksBefore = JSON.stringify(P.state().ws);
  // a new window goes to the panel, never to a desk
  const chat = P.newWin({ app: 'chats', thread: 't1' });
  assert.equal(P.state().panel.id, chat.id); assert.equal(JSON.stringify(P.state().ws), desksBefore, 'the desks are left as they were');
  // every desk key and desk move does nothing
  P.calls.length = 0;
  const args = { goWs: [1], moveWin: ['a1', 1], swapWin: [1], stepDesk: [1], stepWin: [1], moveDesk: [0, 1], closeDesktop: [1], resizeFocused: [1] };
  for (const g of ['goWs', 'reopenClosed', 'jumpBack', 'resizeFocused', 'moveWin', 'swapWin', 'stepDesk', 'stepWin', 'moveDesk', 'closeDesktop', 'hudKey', 'leaveHome']) {
    P[g](...(args[g] || [])); assert.equal(JSON.stringify(P.state().ws), desksBefore, g); assert.equal(P.state().homeOpen, true, `${g}: Home stays in front`);
  }
  assert.deepEqual(P.names(), [], 'nothing on the desks was touched');
  assert.equal(P.findWin(w => w.app === 'chats'), chat, 'never a hidden desk window (a1 is a Chats window on a desk)');
  // one at a time: the one before is kept for a quiet Back
  const chat2 = P.newWin({ app: 'chats', thread: 't2' });
  assert.equal(P.state().W[chat.id], undefined, 'the one before left the panel'); assert.deepEqual([...P.state().panel.back.map(b => b.thread)], ['t1']);
  // two content panels: an app opens on the right beside the chat; closing it gives the keyboard back to the chat
  const app = P.newWin({ app: 'settings' });
  assert.equal(P.state().panelApp.id, app.id); assert.equal(P.state().panel.id, chat2.id, 'the chat stays open beside it');
  P.panelMount();
  const el = id => P.stage.querySelector(`[data-win="${id}"]`);
  assert.equal(el(app.id).dataset.panel, 'app'); assert.equal(el(app.id).dataset.side, 'right'); assert.equal(el(chat2.id).dataset.panel, 'chat');
  P.calls.length = 0;
  assert.equal(P.closeWin(app.id), undefined); assert.equal(P.state().panelApp, null);
  assert.ok(P.calls.some(c => c[0] === 'focusInside' && c[1] === chat2.id), 'the keyboard goes back to the chat');
  // Esc: the panels first; Back brings the thread before
  assert.equal(P.panelBack(), true); assert.equal(P.state().W[P.state().panel.id].app, 'chats');
  assert.ok(P.calls.some(c => c[0] === 'CHATS.openChat' && c[2] === 't1'), 'Back opens the thread shown before');
  assert.equal(P.escStep(), 'panel'); assert.equal(P.state().panel, null);
  // docked: the stock Chats list on the LEFT; a thread picked there opens in the content panel beside it
  P.panelDock(true); const list = P.state().panelList; assert.ok(list);
  P.state().W[list.id].thread = 't9'; P.calls.length = 0;
  P.syncChatsPane(list.id); P.flush();
  assert.ok(P.calls.some(c => c[0] === 'CHATS.chatsBack'), 'the list goes back to listing');
  const beside = P.state().panel; assert.ok(beside && beside.id !== list.id, 'the thread opened in its own panel');
  assert.ok(P.calls.some(c => c[0] === 'CHATS.openChat' && c[1] === beside.id && c[2] === 't9'));
  P.panelMount();
  assert.equal(el(list.id).dataset.side, 'left'); assert.equal(el(beside.id).dataset.side, 'beside');
  // the thread finished (Done, Snooze, ‹): its panel closes and the keyboard goes back to the list
  P.state().W[beside.id].thread = null; P.state().panel.held = true; P.syncChatsPane(beside.id); P.flush();
  assert.equal(P.state().panel, null); assert.ok(P.state().panelList, 'the docked list never closes');
  // letting go: what was there before comes back (Home was not open)
  const Q = panels({ homeOpen: false });
  Q.panelMode(true); assert.equal(Q.state().homeOpen, true, 'Home in front while the layout holds the panel'); assert.equal(Q.saved.get('panelPrevHome'), false);
  Q.newWin({ app: 'chats', thread: 't1' }); Q.panelMode(false);
  assert.equal(Q.state().homeOpen, false, 'the desk in front comes back'); assert.equal(Q.state().panel, null); assert.equal(Q.saved.get('panelPrevHome'), null);
  // it slides in from the right (from the left: the docked list; beside it: the chat column); reduced motion: none
  const css = read('web/desktop/desktop.css');
  const layer = P.stage.querySelector('.panel-layer'); assert.ok(layer, 'the panel layer is on the stage');
  assert.equal(cascade(layer, css)['pointer-events']?.value, 'none'); assert.equal(cascade(layer, css)['z-index']?.value, '140');
  const anim = e => cascade(e, css)['animation-name']?.value || cascade(e, css).animation?.value || ''; // the later longhand wins here
  const right = Q.stage.ownerDocument.createElement('div'); right.className = 'win panel'; right.dataset.panel = 'app'; right.dataset.side = 'right'; layer.appendChild(right);
  assert.match(cascade(right, css).width?.value || '', /^min\(1120px/);
  assert.match(anim(right), /^panel-in /); assert.equal(anim(el(list.id)), 'panel-in-left');
  const col = Q.stage.ownerDocument.createElement('div'); col.className = 'win panel'; col.dataset.side = 'beside'; layer.appendChild(col); assert.equal(anim(col), 'panel-in-beside');
  assert.match(cascade(right, css, { media: m => /prefers-reduced-motion: reduce/.test(m) }).animation.value, /^none/);
  // the keyframes the cascade picked above, read from the parsed sheet (a missing one has no 'from' transform)
  const kf = name => { const i = css.indexOf(`@keyframes ${name} {`); return i < 0 ? null : parseCss(css.slice(css.indexOf('{', i) + 1, css.indexOf('}', css.indexOf('}', i) + 1) + 1)).find(r => r.selector === 'from')?.decls.transform.value ?? null; };
  assert.equal(kf('panel-in'), 'translateX(calc(100% + 24px))'); assert.equal(kf('panel-in-left'), 'translateX(calc(-100% - 24px))'); assert.equal(kf('panel-in-beside'), 'translateX(-100%)');
});

test('apps.logo: the same installed logo the Desks view shows (WizCore.appLogo), nothing fetched, bad ids refused', async () => {
  const D = desk(); const asked = [];
  D.ctx.fetch = async url => { asked.push(String(url)); throw new Error('no fetch'); };
  const url = '/wizard-os-home/store-data/app-logo/files?v=0123456789abcdef';
  D.ctx.WizCore = { ...(D.ctx.WizCore || {}), appLogo: id => ({ files: url, evil: 'https://evil.example/x.png' }[id] || '') };
  D.host.attach(D.adapter); D.host.setLayout('ai-apps'); await settle();
  assert.equal(await D.api.apps.logo('files'), url);
  assert.equal(await D.api.apps.logo('mail'), null, 'no logo: the layout draws the shared sigil');
  assert.equal(await D.api.apps.logo('evil'), null, 'only the box\'s own logo route');
  assert.equal(await D.api.apps.logo('../x'), null);
  assert.equal(asked.length, 0, 'one source for every view: no separate Store logo read');
  D.host.setLayout('classic'); await settle();
});

test('a trusted tweak may switch only its own author\'s tweaks, through the device tweak mix (api.settings.toggleTweak)', async () => {
  const aiMan = coreFeatures['miguel/ai-apps'];   // data, not source (built in since issue 1352)
  assert.equal(aiMan.name, 'Different shell view - AI apps');
  assert.equal(aiMan.view, 'AI apps', 'a shell view');
  // a package with the settings capability (the ai-apps view itself asks only for its layout)
  const manifests = { 'miguel/probe': { id: 'miguel/probe', name: 'Probe', version: '1.0.0', author: 'miguel', apiVersion: 1, capabilities: ['settings'], shells: ['desktop', 'phone'] } };
  const load = async teamAuthors => {
    const f = fixture({ shell: 'desktop', manifests }), toggled = []; let api;
    f.ctx.window.WosExperience = { toggle: id => { toggled.push(id); } };
    f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
    await f.host.loadTweaks(['miguel/probe'], f.slots, { teamAuthors });
    return { f, toggled, api };
  };
  const T = await load(['miguel']);
  assert.equal(await T.api.settings.toggleTweak('miguel/machines-home'), true);
  assert.deepEqual(T.toggled, ['miguel/machines-home'], 'switched through the device mix');
  assert.equal(await T.api.settings.toggleTweak('wizard/sent-threads'), false, 'own author only');
  assert.equal(await T.api.settings.toggleTweak('miguel/probe'), false, 'never itself');
  assert.equal(await T.api.settings.toggleTweak('miguel/../x'), false);
  assert.deepEqual(T.toggled, ['miguel/machines-home']);
  await T.f.clear();
  assert.throws(() => T.api.settings.toggleTweak('miguel/machines-home'), /Trusted settings required/, 'dead with the package');
  const U = await load([]);
  assert.equal(U.api.settings, undefined, 'an untrusted package gets no settings at all');
  assert.deepEqual(U.toggled, []);
  await U.f.clear();
});

test('bar-center: a core slot in the middle of the desktop bar; the clock steps aside while it holds anything', () => {
  const html = read('web/desktop.html'), css = read('web/desktop/desktop.css');
  const doc = createDocument(); doc.body.innerHTML = html.slice(html.indexOf('<body'), html.lastIndexOf('</body>')).replace(/^<body[^>]*>/, '');
  const slot = doc.querySelector('.bar-c > .bar-center[data-slot="bar-center"]'), clock = doc.querySelector('.bar-c > #clock');
  assert.ok(slot && clock, 'the slot and the clock share the middle of the bar'); assert.equal(slot.nextElementSibling, clock, 'the clock right after it');
  const slots = JSON.parse(read('web/core/slots.json'));   // data, not source
  assert.ok(slots.slots['bar-center'], 'in the slot contract');
  const shown = el => cascade(el, css).display?.value || '';
  assert.equal(shown(slot), 'none', 'empty: no gap in the bar'); assert.notEqual(shown(clock), 'none', 'the clock shows');
  slot.appendChild(doc.createElement('span'));
  assert.notEqual(shown(slot), 'none'); assert.equal(shown(clock), 'none', 'the clock steps aside while it holds anything');
  doc.documentElement.classList.add('voice-on');
  assert.equal(cascade(slot, css).visibility?.value, 'hidden', 'out of the voice pill\'s way');
});

// The desktop's real render() over a small desk state: where each window's element ends up (desk host or panel layer).
function renderDesks(panelMode) {
  const src = withDesktopParts(read('web/desktop/desktop.js'));
  const doc = createDocument(), stage = doc.createElement('div'); doc.body.appendChild(stage);
  const home = doc.createElement('div'); home.id = 'desktopHome'; doc.body.appendChild(home);
  const W = { wa: { id: 'wa', app: 'frame', appId: 'music' }, wc: { id: 'wc', app: 'chats' }, wb: { id: 'wb', app: 'pages', pageSlug: 'x' } };
  const ws = [{ id: 'd0', wins: ['wc', 'wa'], focus: 'wc' }, { id: 'd1', wins: ['wb'], focus: 'wb' }];
  const hosts = ws.map((d, i) => { const h = doc.createElement('div'); h.id = 'desk' + i; h.className = 'wsp'; h.dataset.desk = d.id; stage.appendChild(h); return h; });
  const layer = doc.createElement('div'); layer.id = 'panelLayer'; stage.appendChild(layer);
  const ctx = runRecording(`${between(src, '  const panelDeskApp = ', '\n')}
${between(src, '    const panelDeskRep = ', '\n')}
${block(src, '  function render() {')}
this.render = render;`, {
    W, ws, cur: 0, homeOpen: false, stage, document: doc, pal: { hidden: true }, WosSkinHost: { panelMode }, window: {},
    $: s => doc.querySelector(s), $$: (s, r = doc) => r.querySelectorAll(s), wsEl: i => hosts[i], panelLayerEl: () => layer,
    mountWin: (w, to) => { const el = doc.createElement('div'); el.className = 'win'; el.dataset.win = w.id; to.appendChild(el); return el; },
    queueMicrotask: () => {} });
  ctx.render();
  return { parentOf: id => stage.querySelector(`[data-win="${id}"]`)?.parentNode?.id || null };
}

test('Orbs view apps ARE desks (Miguel, v8): one app per desk, saved and synced like desks, so looking away or a reload never closes them', async () => {
  // the real panel code (no desks): an installed app's frame or a page opened over the orb becomes a desk of its own
  const P = panels({ desks: [['a1']] });
  P.ctx.removeWin = id => { delete P.state().W[id]; for (const d of P.state().ws) if (d.wins.includes(id)) d.wins.splice(d.wins.indexOf(id), 1); };   // the windows part's own cleanup, outside this slice
  const desksN = () => P.state().ws.length;
  const music = P.panelOpen({ app: 'frame', appId: 'music', url: '/music/' });
  assert.equal(desksN(), 2, 'a new app = a new desk of its own');
  assert.deepEqual(JSON.parse(JSON.stringify(P.state().ws[1])), { id: 'new', wins: [music.id], focus: music.id });
  assert.ok(P.names().includes('save'), 'saved (and so synced) like any desk change');
  const page = P.panelOpen({ app: 'pages', pageSlug: 'notes' }); assert.equal(desksN(), 3, 'a page is a desk too');
  const settings = P.panelOpen({ app: 'settings' }); assert.equal(desksN(), 3, 'a built-in view is no desk');
  assert.equal(P.state().panelApp.id, settings.id);
  assert.equal(P.panelOpen({ app: 'frame', appId: 'music', url: '/music/' }), music, 'an app already on a desk comes back, never a second copy');
  assert.equal(desksN(), 3);
  // running = every desk's app but the one shown, read from the desks
  assert.deepEqual(P.panelParkedW().map(x => x.id), [page.id]);
  P.ctx.WosSkinHost.panelMode = false; assert.equal(P.panelParkedW().length, 0, 'no layout holding the panel: nothing kept running'); P.ctx.WosSkinHost.panelMode = true;
  // Close closes the desk; the orb (Home) stays in front
  P.panelDeskClose(page.id);
  assert.equal(desksN(), 2, 'Close closes the desk'); assert.equal(P.state().W[page.id], undefined); assert.equal(P.state().homeOpen, true, 'closing an app\'s desk keeps the orb in front');
  // render: a desk's app lives in the panel layer while a layout holds the panel; the desk's other windows stay put
  const R = renderDesks(true), D0 = renderDesks(false);
  assert.equal(R.parentOf('wa'), 'panelLayer'); assert.equal(R.parentOf('wc'), 'desk0', 'only the desk\'s app goes to the panel');
  assert.equal(R.parentOf('wb'), 'panelLayer');
  assert.equal(D0.parentOf('wa'), 'desk0', 'Desks view: on its desk');
  // a desks sync round keeps them: an app desk on the shared state is placed again, nothing removed
  globalThis.window = globalThis;
  await import(new URL('web/core/workspace-sync.js', root).href + '?v8');
  const W = { wa: { id: 'wa', app: 'frame', appId: 'music' }, wb: { id: 'wb', app: 'frame', appId: 'money' } };
  const local = [{ id: 'da', wins: ['wa'], focus: 'wa' }, { id: 'db', wins: ['wb'], focus: 'wb' }];
  const shared = { desks: local.map(d => ({ id: d.id, wins: d.wins.map(id => W[id]) })) };
  const r = globalThis.WosWorkspaceSync.reconcile(local, W, JSON.parse(JSON.stringify(shared)), { fresh: id => ({ id, wins: [], focus: null }) });
  assert.deepEqual(r.removed, []); assert.deepEqual(r.desks.map(d => d.wins), [['wa'], ['wb']]);
  // a tweak reload (dispose + re-run every tweak) never blinks the panel off: that dropped every running app
  const H = desk(), modes = () => H.calls.filter(c => c[0] === 'panelMode').map(c => c[1]);
  let release = null;
  H.host._test.setImporter(async () => ({ default: a => { H.api0 = a; release = a.panel.claim(); return () => {}; } }));
  H.host.attach(H.adapter); H.host.setLayout('ai-apps'); await settle();
  assert.deepEqual(modes(), [true]); assert.equal(H.host.panelMode, true);
  // the layout loads again (dispose + setup): the panel holds through it
  const again = H.host.setLayout('ai-apps'); assert.equal(again, 'ai-apps');
  assert.equal(H.host.panelMode, true, 'held while the layout loads again'); await settle();
  assert.deepEqual(modes(), [true], 'never blinked off while the layout itself loaded again');
  // a tweak reload in flight: a release meanwhile turns the panel off only once the load has settled
  const reload = H.host.loadTweaks([], {}, {}); release();
  assert.deepEqual(modes(), [true], 'decided once the reload settles'); assert.equal(H.host.panelMode, true, 'held during the tweak reload');
  await reload; await settle();
  assert.deepEqual(modes(), [true, false], 'off once settled with no layout claiming it'); assert.equal(H.host.panelMode, false);
});

test('bound views: the Orb panel\'s chat counts as visible (a linked page opens beside it)', () => {
  const js = withDesktopParts(readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8'));
  const shown = js.slice(js.indexOf('  function threadShown(wid,el) {'), js.indexOf('boundManager.shown(wid,el);'));
  const visible = new Function('globalThis', 'panelHas', 'homeOpen', 'wsOf', 'cur', 'return ' + shown.match(/visible:(id=>.*?), close:/)[1]);
  const v = (panelMode, inPanel, home) => visible({ WosSkinHost: { panelMode } }, () => inPanel, home, () => 9, 0)('w');
  assert.equal(v(true, true, true), true, 'Orb: the panel chat over Home is in view');
  assert.equal(v(false, true, true), false, 'Desks: Home in front, nothing in view (unchanged)');
  assert.equal(v(true, false, true), false, 'Orb: a chat not in the panel is not in view');
});
test('layout keys (layouts/orb/keys.js, used by AI apps): hold the LEFT ⌥ for bare app letters, stable, collision-free; desktop.js hands keys to the layout first', async () => {
  const { assignKeys, keyOf, isLeftAlt, HOLD_MS } = await import(new URL('web/layouts/orb/keys.js', root));
  const apps = ['Files', 'Messenger', 'Mail', 'Music', 'Money', 'Movies', 'Health', 'Home Assistant', 'Backup', 'Calendar', 'Contacts', 'Podcasts', 'Profiles', 'Wisdom', 'YouTube Music', 'Shopping', 'Sniper', 'Search', 'Setup', 'Pages', 'Troubleshooter', 'Morning Report', 'Card Benefits', 'Carlos CRM (demo)', 'Maverick Command', 'Zzz']
    .map((name, i) => ({ id: 'a' + i, name }));
  const k = assignKeys(apps);
  assert.equal(Object.keys(k).length, apps.length, 'every app has a letter (26 apps, 26 letters)');
  assert.equal(new Set(Object.values(k)).size, apps.length, 'no two apps share one');
  for (const v of Object.values(k)) assert.match(v, /^[A-Z]$/, 'a bare letter, never ⇧ or ⌥');
  assert.equal(k.a0, 'F', 'Files: its first letter'); assert.equal(k.a2, 'A', 'Mail: M is taken, so the next letter of its name');
  const again = assignKeys([{ id: 'new', name: 'Echo' }, ...apps], k);
  for (const a of apps) assert.equal(again[a.id], k[a.id], 'an app keeps its letter when another arrives');
  assert.equal(Object.keys(assignKeys([...apps, { id: 'x', name: 'Extra' }])).length, 26, 'past 26 apps the rest get none');
  assert.equal(keyOf({ code: 'KeyE' }), 'E'); assert.equal(keyOf({ code: 'Digit1' }), null);
  assert.equal(isLeftAlt({ code: 'AltLeft', key: 'Alt' }), true); assert.equal(isLeftAlt({ code: 'AltRight', key: 'Alt' }), false, 'Right ⌥ never shows them');
  assert.equal(HOLD_MS, 300);
  // the layout sees keys before the desktop's own ⌥ bindings (the real onKey), and owns the hold overlay
  const take = desktopKeys({ WosSkinHost: { key: () => true } }), e1 = take.key('KeyN');
  assert.ok(e1.defaultPrevented && e1.stopped, 'a key the layout took is spent'); assert.deepEqual(take.names(), [], 'the desktop does nothing with it');
  const pass = desktopKeys({ WosSkinHost: { key: () => false } }); pass.key('KeyN');
  assert.ok(pass.names().length > 0, 'a key the layout leaves goes on to the desktop\'s own ⌥ bindings');
  const timers = [], g = keysGuide({ setTimeout: (f, ms) => { timers.push(ms); return timers.length; } });
  g.ctx.window.WosSkinHost = { holdKeys: true };
  g.keyHints.down({ code: 'AltLeft', key: 'Alt', altKey: true, preventDefault() {} }); assert.equal(timers.length, 0, 'a layout holding the keys owns the hold overlay');
  g.ctx.window.WosSkinHost = { holdKeys: false };
  g.keyHints.down({ code: 'AltLeft', key: 'Alt', altKey: true, preventDefault() {} }); assert.equal(timers.length, 1);
  // releases from the page and from sandboxed app frames (browser boundary) reach the layout (app frames:
  // desktop-keys-layout.test.mjs 'holding left ⌥ alone shows key hints')
  const on = {}, ups = []; let input = null;
  desktopPart('boundarykeys', { keyHints: { up: x => ups.push(['hints', x.code]), hide() {}, mine: () => false }, onKey: x => ups.push(['onKey', x.code]) },
    { WosSkinHost: { keyUp: x => ups.push(['layout', x.code]) }, WizBrowserBoundary: { keys() {}, onInput: f => { input = f; } },
      globals: { addEventListener: (t, f) => { on[t] = f; } } });
  on.keyup({ code: 'AltLeft' });
  input({ closest: () => ({ dataset: { win: 'w1' } }) }, { type: 'keyup', code: 'AltLeft', kind: 'key' });
  assert.deepEqual(ups, [['hints', 'AltLeft'], ['layout', 'AltLeft'], ['hints', 'AltLeft'], ['layout', 'AltLeft']]);
  assert.deepEqual(desktopBoot({ palToggle: (...x) => ['palette', ...x] }).adapter.openPalette(), ['palette', 'all'], 'the layout opens the stock search & launch');
});
