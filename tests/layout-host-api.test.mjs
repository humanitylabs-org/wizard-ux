import { runWithChatsModel } from './fixtures/chats-list-model.mjs';
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
  runWithChatsModel(read('web/core/skin-host.js'), ctx);
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
  assert.deepEqual(Object.keys(api.sessions).sort(), ['act', 'archiveOrder', 'channelBack', 'channelFeed', 'channelFeedOpen', 'channelNew', 'channelPost', 'channelView', 'channels', 'chats', 'list', 'newChat', 'open', 'openList', 'order', 'ownList', 'setOrder', 'setWorkingOrder', 'workingOrder']);
  assert.deepEqual(Object.keys(api.apps).sort(), ['all', 'back', 'badgeText', 'badges', 'close', 'get', 'homeScreen', 'inset', 'kinds', 'list', 'logo', 'open', 'openAny', 'openDesk', 'openLink', 'path', 'routeOpens', 'search', 'store']);
  assert.deepEqual(Object.keys(api.desk).sort(), ['attention', 'classic', 'emptyHome', 'home', 'look', 'setting', 'settings']);
  assert.deepEqual(Object.keys(api.voice).sort(), ['ask', 'cancel', 'command', 'dictate', 'onCommand', 'reply', 'state', 'talk', 'tap']);
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
  assert.equal(api.sessions.act('r1', 'delete'), false, 'only the row sheet\'s own actions (Snooze, Done, Mark unread, Restore, Pin, Rename)'); assert.equal(api.sessions.act('', 'done'), false);
  api.sessions.open('r1'); api.sessions.openList('ready'); api.sessions.openList('archive');
  assert.deepEqual({ ...api.apps.badges() }, {}, 'no counts without the shell nav'); assert.ok(Object.isFrozen(api.apps.badges()));
  assert.equal(api.apps.list()[0].id, 'files'); api.apps.open('files'); api.apps.all(); api.desk.home(); api.desk.look();
  assert.equal(api.voice.command(), 'voice'); api.voice.talk();
  assert.equal(D.host.emptyHome, false); api.desk.emptyHome(); assert.equal(D.host.emptyHome, true, 'closing a desk\'s last window goes Home');
  assert.equal(api.route().home, true);
  const mount = { nodeType: 1, remove() { D.mounted.splice(D.mounted.indexOf(this), 1); } }; api.mount(mount); assert.equal(D.mounted.length, 1, 'mounted on the desktop stage');
  assert.deepEqual(D.calls, [['snooze', 'r1'], ['done', 'r1'], ['open', 'r1'], ['list', 'ready'], ['app', 'files'], ['picker'], ['home'], ['settings', 'look'], ['command'], ['talk']]);
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
  const f = fixture({ shell: 'desktop' }); let api;
  f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  await f.host.loadTweaks(['miguel/ai-apps'], f.slots, { teamAuthors: ['miguel'] });
  for (const k of ['sessions', 'apps', 'desk', 'voice', 'mount', 'panel', 'keys']) assert.equal(api[k], undefined, k);
  await f.clear();
});

test('the desktop adapter routes Snooze / Done through Chats\' own threadAct and feeds the orb voice and level', () => {
  const src = read('web/desktop/desktop.js');
  assert.match(src, /sessionAct: \(sid, act\) => \{[^}]*CHATS\.threadAct\(/);
  assert.match(src, /sessionList: \(\) => window\.WizChatsListModel\.sessionList\(/, 'one row projection');
  assert.match(read('web/core/chats-list-model.js'), /chats\.threadActions\(s, null\)\.filter\(a => \['snooze', 'done', 'restore'\]\.includes\(a\)\)/, 'Snooze / Done / Restore remain the Chats actions');
  assert.match(src, /window\.WosSkinHost\?\.voice\(st\)/); assert.match(src, /window\.WosSkinHost\?\.level\(l\)/);
  assert.match(src, /home: homeOpen \|\| !ws\[cur\]\.wins\.length/);
  assert.match(src, /removeDesktop\(d\); if \(window\.WosSkinHost\?\.emptyHome\) goHome\(\);/);
  assert.match(read('web/core/chats.js'), /KIT, threadAct, threadActions,/);
});

test('no desks: while a layout holds the panel everything opens in panels over Home; desks stay put', () => {
  const src = read('web/desktop/desktop.js'), css = read('web/desktop/desktop.css');
  const ND = 'globalThis.WosSkinHost?.panelMode';
  const fn = name => src.slice(src.indexOf(`  function ${name}(`), src.indexOf('\n  }', src.indexOf(`  function ${name}(`)) + 4);
  assert.ok(fn('newWin').includes(`if (${ND}) return panelOpen(obj);`), 'a new window goes to the panel, never to a desk');
  for (const f of ['goWs', 'reopenClosed', 'jumpBack', 'resizeFocused', 'moveWin', 'swapWin', 'stepDesk', 'stepWin', 'moveDesk', 'closeDesktop', 'hudKey'])
    assert.ok(fn(f).includes(`if (${ND}) return`), `${f} does nothing without desks`);
  assert.ok(fn('leaveHome').includes(`if (!homeOpen || ${ND}) return;`), 'Home stays in front');
  assert.ok(fn('findWin').includes(`if (${ND}) return panelWins().find(fn) || null;`), 'never a hidden desk window');
  assert.ok(fn('escStep').includes(`if (${ND} && panelWin()) return panelEsc();`), 'Esc: the panels first');
  assert.ok(fn('closeWin').includes(`if (${ND} && panelHas(id)) { panelClose({ id }); return; }`));
  // one at a time: the one before is kept for a quiet Back; a chat panel lives outside the desks (never synced), an app
  // IS a desk (v8, below)
  assert.match(fn('panelOpen'), /panelDrop\(prev\.id, \{ swap: true \}\)/); assert.match(fn('panelOpen'), /back = \[\.\.\.back, keep\]\.slice\(-PANEL_BACK\)/);
  assert.ok(!fn('panelOpen').includes('ws[') && !fn('panelOpen').includes('.wins'), 'panelOpen itself touches no desk (panelDeskShow does, for apps)');
  assert.match(fn('panelMode'), /store\.set\('panelPrevHome', homeOpen\)/); assert.match(fn('panelMode'), /if \(was === false && ws\[cur\]\.wins\.length\) \{ homeOpen = false;/);
  assert.match(src, /panelMode: on => panelMode\(!!on\),/); assert.match(src, /panelState: \(\) => \{ const c = panelChat\(\), p = panelAppW\(\), l = panelListW\(\), w = c \|\| p;/); assert.match(src, /panelDock: on => panelDock\(!!on\),/);
  assert.match(src, /home: homeOpen \|\| !ws\[cur\]\.wins\.length, panel: panelKind\(panelChat\(\) \|\| panelAppW\(\)\), panelList: !!panelListW\(\), panelApp: panelAppW\(\)\?\.appId/);
  // v6: two content panels that can be open together: a Chats window in the chat panel (docked: a column BESIDE the
  // list), anything else in the app panel on the right; each one at a time with its own Back; Esc / ✕ close the one in
  // front (the chat first), and closing an app beside an open chat gives the keyboard back to the chat.
  assert.match(fn('panelOpen'), /const isApp = obj\?\.app !== 'chats', slot = isApp \? panelApp : panel;/);
  assert.match(fn('panelOpen'), /if \(isApp\) panelApp = next; else panel = next;/);
  assert.match(fn('panelClose'), /if \(wasApp\) panelApp = null; else panel = null;/);
  assert.match(fn('panelBack'), /const slot = panelSlot\(id\) \|\| panelSlot\(panelWin\(\)\?\.id\) \|\| panel;/);
  assert.match(fn('panelMount'), /el\.dataset\.side = panelDockList\(w\) \? 'left' : slot === panel && panelDocked \? 'beside' : 'right';/);
  assert.match(src, /const panelWins = \(\) => \[panelListW\(\), panelChat\(\), panelAppW\(\)\]\.filter\(Boolean\);/);
  assert.match(src, /const folded = !!winEl\(id\)\?\.querySelector\('\.pane-list'\) && !winEl\(id\)\.querySelector\('\.pane-list'\)\.getClientRects\(\)\.length;/, '⌥↓ counts the rows of a hidden list (the chat column beside a folded list)');
  assert.match(css, /@keyframes panel-in-beside \{ from \{ opacity: 0; transform: translateX\(-100%\); \}/, 'the chat column grows out of the list');
  // v5 in thirds: docked, the stock Chats list keeps its own panel on the LEFT (never closes; dock(false) folds it);
  // a thread picked in it (click, key, new chat) is forwarded to the content panel on the right, one thing at a time
  // with a quiet Back, and that panel closes when its thread is finished (Done, Snooze, ‹, a send that leaves like the
  // phone's), giving the keyboard back to the list.
  assert.match(fn('panelForward'), /CHATS\.chatsBack\(lw\);/); assert.match(fn('panelForward'), /if \(!mainChats\(w\)\) w = panelOpen\(\{ app: 'chats', thread: null/);
  assert.match(fn('panelThreadLeft'), /panelClose\(\{ id \}\)/);
  assert.match(fn('syncChatsPane'), /if \(sid && panelList\?\.id === base\) queueMicrotask\(\(\) => panelForward\(base, sid\)\); else if \(sid && panel\?\.id === base\) panel\.held = true; else if \(!sid && panel\?\.id === base && panel\.held\) queueMicrotask\(\(\) => panelThreadLeft\(base\)\);/);
  assert.match(fn('panelClose'), /winEl\(l\.id\)\?\.focus\(\{ preventScroll: true \}\)/, 'the keyboard goes back to the list');
  assert.match(fn('panelDock'), /if \(on && !panelListW\(\)\) \{ const id = uid\(\); W\[id\] = \{ id, app: 'chats', thread: null/);
  assert.match(src, /keepThreadOpen: true/, 'desktop chat panels stay on their thread after send and state changes');
  assert.match(read('web/core/chats.js'), /!\(isNew \|\| PHONE\(\) \|\| H\.leaveOnSend\?\.\(wid\)\)\) return false;/);
  // the keys reach the docked Chats over Home: ⌥↓/⌥↑ (also with its list folded behind a thread); plain ⌥←/⌥→ stay native
  assert.match(fn('stepReady'), /const atHome = homeOpen && !\(globalThis\.WosSkinHost\?\.panelMode && panelWins\(\)\.some\(mainChats\)\);/);
  assert.match(fn('chatAct'), /homeOpen && !\(globalThis\.WosSkinHost\?\.panelMode && panelHas\(f\?\.id\)\)/, 'remaining Resolve action still reaches a docked panel over Home');
  assert.match(css, /@keyframes panel-in-left \{ from \{ transform: translateX\(calc\(-100% - 24px\)\); \}/);
  // it slides in from the right, a replacement settles in place, closing slides it away; reduced motion: none
  assert.match(css, /\.panel-layer \{ position: absolute; inset: 0; z-index: 140; pointer-events: none; \}/);
  assert.match(css, /@keyframes panel-in \{ from \{ transform: translateX\(calc\(100% \+ 24px\)\); \}/);
  assert.match(css, /\.panel-layer > \.win\.panel\[data-panel="app"\] \{ width: min\(1120px/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.panel-layer > \.win\.panel \{ animation: none !important; \} \}/);
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
  assert.equal(JSON.parse(read('web/tweaks/miguel/ai-apps/manifest.json')).name, 'Different shell view - AI apps');
  assert.equal(JSON.parse(read('web/tweaks/miguel/ai-apps/manifest.json')).view, 'AI apps', 'a shell view');
  const host = read('web/core/skin-host.js');
  assert.match(host, /toggleTweak\(id\) \{\n\s+if \(!trusted \|\| a\.dead\) throw/);
  assert.match(host, /!id\.startsWith\(a\.id\.split\('\/'\)\[0\] \+ '\/'\)\) return Promise\.resolve\(false\)/, 'own author only');
  assert.match(host, /window\.WosExperience\?\.toggle\?\.\(id\)/);
});

test('bar-center: a core slot in the middle of the desktop bar; the clock steps aside while it holds anything', () => {
  const html = read('web/desktop.html');
  assert.match(html, /<div class="bar-c">\s*<div class="bar-center" data-slot="bar-center"><\/div>\s*<button id="clock"/);
  assert.ok(JSON.parse(read('web/core/slots.json')).slots['bar-center'], 'in the slot contract');
  const css = read('web/desktop/desktop.css');
  assert.match(css, /\.bar-center:empty \{ display: none; \}/); assert.match(css, /\.bar-center:not\(:empty\) ~ #clock \{ display: none; \}/);
  assert.match(css, /html\.voice-on \.bar-center \{ visibility: hidden; \}/, 'out of the voice pill\'s way');
});

test('Orbs view apps ARE desks (Miguel, v8): one app per desk, saved and synced like desks, so looking away or a reload never closes them', async () => {
  const src = read('web/desktop/desktop.js');
  const fn = name => src.slice(src.indexOf(`  function ${name}(`), src.indexOf('\n  }', src.indexOf(`  function ${name}(`)) + 4);
  assert.match(src, /const panelDeskApp = w => !!w && \(w\.app === 'frame' \|\| w\.app === 'pages'\);/);
  assert.match(fn('panelOpen'), /if \(isApp && panelDeskApp\(obj\)\) \{/, 'an app opened over the orb goes to a desk');
  const show = fn('panelDeskShow');
  assert.match(show, /ws\.push\(\{ \.\.\.freshDesk\(\), wins: \[id\], focus: id \}\)/, 'a new app = a new desk of its own');
  assert.match(show, /Object\.values\(W\)\.find\(x => panelDeskApp\(x\) && wsOf\(x\.id\) >= 0 && same\(x\)\)/, 'an app already on a desk (any view, any device) comes back, never a second copy');
  assert.match(show, /save\(\);/, 'saved (and so synced) like any desk change');
  assert.match(src, /const panelParkedW = \(\) => globalThis\.WosSkinHost\?\.panelMode \? panelReps\(\)\.filter\(w => w\.id !== panelApp\?\.id\) : \[\];/, 'running = every desk\'s app, read from the desks (nothing in memory to lose)');
  assert.match(fn('render'), /const to = rep\?\.id === id \? lay : host/, 'a desk\'s app lives in the panel layer while the Orbs view is on (never moved again: no frame reload)');
  assert.match(fn('panelDeskClose'), /removeWin\(id\);/); assert.match(fn('panelDeskClose'), /ws\.splice\(ws\.indexOf\(d\), 1\)/, 'Close closes the desk');
  assert.ok(!/homeOpen = false/.test(fn('panelDeskClose')), 'closing an app\'s desk keeps the orb in front');
  // a desks sync round keeps them: an app desk on the shared state is placed again, nothing removed
  globalThis.window = globalThis;
  await import(new URL('web/core/workspace-sync.js', root).href + '?v8');
  const W = { wa: { id: 'wa', app: 'frame', appId: 'music' }, wb: { id: 'wb', app: 'frame', appId: 'money' } };
  const local = [{ id: 'da', wins: ['wa'], focus: 'wa' }, { id: 'db', wins: ['wb'], focus: 'wb' }];
  const shared = { desks: local.map(d => ({ id: d.id, wins: d.wins.map(id => W[id]) })) };
  const r = globalThis.WosWorkspaceSync.reconcile(local, W, JSON.parse(JSON.stringify(shared)), { fresh: id => ({ id, wins: [], focus: null }) });
  assert.deepEqual(r.removed, []); assert.deepEqual(r.desks.map(d => d.wins), [['wa'], ['wb']]);
  // a tweak reload (dispose + re-run every tweak) never blinks the panel off: that dropped every running app
  const host = read('web/core/skin-host.js');
  assert.match(host, /if \(!on && panelOn && panelHold\) return;/);
  assert.match(host, /panelHold\+\+;\n    try \{ return await loadTweaksNow\(\.\.\.args\); \} finally \{ panelHold--; panelSync\(\); \}/);
  assert.match(host, /panelHold\+\+;\n    try \{ return await loadLayoutNow\(id\); \} finally \{ panelHold--; panelSync\(\); \}/, 'and while the layout itself loads again');
  assert.match(host, /get panelMode\(\) \{ return panelOn && \(panelHold > 0 \|\| \[\.\.\.panelHolders\]\.some\(l => !l\.dead\)\); \},/);
});

test('bound views: the Orb panel\'s chat counts as visible (a linked page opens beside it)', () => {
  const js = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
  const shown = js.slice(js.indexOf('  function threadShown(wid,el) {'), js.indexOf('boundManager.shown(wid,el);'));
  assert.match(shown, /visible:id=>\(globalThis\.WosSkinHost\?\.panelMode&&panelHas\(id\)\)\|\|\(!homeOpen&&wsOf\(id\)===cur\)/);
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
  const desk = read('web/desktop/desktop.js');
  // the layout sees keys before the desktop's own ⌥ bindings (app frames too), and owns the hold overlay
  assert.match(desk, /if \(globalThis\.WosSkinHost\?\.key\?\.\(e\)\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); return; \}/);
  assert.match(desk, /e\.code !== 'AltLeft' \|\| e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| window\.WosSkinHost\?\.holdKeys\) return;/);
  assert.equal((desk.match(/keyHints\.up\(e\); window\.WosSkinHost\?\.keyUp\?\.\(e\);/g) || []).length, 3, 'releases from the page, from app frames and from sandboxed app frames (browser boundary)');
  assert.match(desk, /openPalette: \(\) => palToggle\('all'\),/);
});
