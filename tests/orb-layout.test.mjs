// Orb desktop (Miguel, 31 Oct 2026): the miguel/orb-shell tweak wears the built-in Orb layout.
// These tests hold its contract:
//   - phone (experimental): the same layout, Home only (layouts/orb/phone.js; guards in tests/orb-phone-home.test.mjs);
//   - desktop: the layout gets the shell's own lists and actions (Working / Ready rows, Snooze / Done through Chats'
//     threadAct, quick apps, Home, Settings › Look) and nothing else; every handle dies with the layout;
//   - turning the tweak off (or a load where it is no longer on) brings the classic desktop straight back;
//   - its CSS can only ever apply to the desktop shell wearing the Orb layout; no second composer, no raw storage.
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
  vm.runInNewContext(read('web/core/skin-host.js'), ctx);
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

test('phone: Orbs wears the same Orb layout (its phone part draws Home only); off gives the stock phone back', async () => {
  const f = fixture({ shell: 'phone' });
  await f.mount('miguel/orb-shell');
  assert.ok(f.host.tweakState.includes('miguel/orb-shell'));
  assert.equal(f.host.layout, 'orb'); assert.equal(f.doc.documentElement.dataset.layout, 'orb');
  await f.clear();
  assert.equal(f.host.layout, 'classic'); assert.equal(f.doc.documentElement.dataset.layout, undefined);
  assert.ok(!f.doc.head.children.some(l => /layouts\//.test(l.href || '')), 'no layout css left on the phone');
});

test('desktop: on wears the Orb layout, off brings the classic desktop back', async () => {
  const f = fixture({ shell: 'desktop' });
  await f.mount('miguel/orb-shell');
  assert.equal(f.host.layout, 'orb'); assert.equal(f.doc.documentElement.dataset.layout, 'orb');
  assert.ok(f.doc.head.children.some(l => /layouts\/orb\/layout\.css/.test(l.href || '')));
  await f.clear();
  assert.equal(f.host.layout, 'classic'); assert.equal(f.doc.documentElement.dataset.layout, undefined);
  assert.ok(!f.doc.head.children.some(l => /layouts\//.test(l.href || '')), 'layout css removed');
});

test('a stored Orb layout that no tweak wears any more goes back to Classic once tweaks load', async () => {
  const f = fixture({ shell: 'desktop' });
  f.host.setLayout('orb'); assert.equal(f.host.layout, 'orb');
  await f.host.loadTweaks(['miguel/hidden-pin'], f.slots, { teamAuthors: ['miguel'] });
  assert.equal(f.host.layout, 'classic'); assert.equal(f.doc.documentElement.dataset.layout, undefined);
  await f.clear();
});

test('the layout gets the shell\'s own threads, actions, apps and Home; nothing more; all dead after Classic', async () => {
  const D = desk();
  D.host.attach(D.adapter); D.host.setLayout('orb'); await settle();
  const api = D.api; assert.ok(api, 'layout set up');
  assert.ok(Object.isFrozen(api) && Object.isFrozen(api.sessions) && Object.isFrozen(api.apps) && Object.isFrozen(api.desk) && Object.isFrozen(api.voice));
  assert.deepEqual(Object.keys(api.sessions).sort(), ['act', 'list', 'open', 'openList']);
  assert.deepEqual(Object.keys(api.apps).sort(), ['all', 'badges', 'list', 'logo', 'open', 'search']);
  assert.deepEqual(Object.keys(api.desk).sort(), ['classic', 'emptyHome', 'home', 'look']);
  assert.deepEqual(Object.keys(api.voice).sort(), ['ask', 'cancel', 'command', 'dictate', 'onCommand', 'state', 'talk', 'tap']);
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
  assert.equal(api.sessions.act('r1', 'restore'), false, 'only Snooze and Done'); assert.equal(api.sessions.act('', 'done'), false);
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
  assert.equal(api.apps.list().length, 0); assert.equal(D.calls.length, n, 'stale handles are inert');
  assert.equal(D.ls._['wos.layout'], undefined, 'nothing left stored');
});

test('skins and tweaks never get the layout-only lists or the command take', async () => {
  const f = fixture({ shell: 'desktop' }); let api;
  f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  await f.host.loadTweaks(['miguel/orb-shell'], f.slots, { teamAuthors: ['miguel'] });
  for (const k of ['sessions', 'apps', 'desk', 'voice', 'mount', 'panel', 'keys']) assert.equal(api[k], undefined, k);
  await f.clear();
});

test('the desktop adapter routes Snooze / Done through Chats\' own threadAct and feeds the orb voice and level', () => {
  const src = read('web/desktop/desktop.js');
  assert.match(src, /sessionAct: \(sid, act\) => \{[^}]*CHATS\.threadAct\(/);
  assert.match(src, /CHATS\.threadActions\(s\)\.filter\(a => a === 'snooze' \|\| a === 'done'\)/);
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
  assert.match(src, /leaveOnSend: id => !!\(globalThis\.WosSkinHost\?\.panelMode && panelDocked && panel\?\.id === id\),/);
  assert.match(read('web/core/chats.js'), /!\(isNew \|\| PHONE\(\) \|\| H\.leaveOnSend\?\.\(wid\)\)\) return false;/);
  // the keys reach the docked Chats over Home: ⌥↓/⌥↑ (also with its list folded behind a thread), ⌥→/⌥← on its thread
  assert.match(fn('stepReady'), /const atHome = homeOpen && !\(globalThis\.WosSkinHost\?\.panelMode && panelWins\(\)\.some\(mainChats\)\);/);
  assert.match(src, /const chatOpen = \(\) => \{ const f = focused\(\); return \(!homeOpen \|\| !!\(globalThis\.WosSkinHost\?\.panelMode && panelHas\(f\?\.id\)\)\) && f\?\.app/);
  assert.match(css, /@keyframes panel-in-left \{ from \{ transform: translateX\(calc\(-100% - 24px\)\); \}/);
  // it slides in from the right, a replacement settles in place, closing slides it away; reduced motion: none
  assert.match(css, /\.panel-layer \{ position: absolute; inset: 0; z-index: 140; pointer-events: none; \}/);
  assert.match(css, /@keyframes panel-in \{ from \{ transform: translateX\(calc\(100% \+ 24px\)\); \}/);
  assert.match(css, /\.panel-layer > \.win\.panel\[data-panel="app"\] \{ width: min\(1120px/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.panel-layer > \.win\.panel \{ animation: none !important; \} \}/);
});

test('Orb layout files: desktop-scoped CSS only, no second composer, no raw storage or network', () => {
  const css = read('web/layouts/orb/layout.css').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@property[^{]*\{[^}]*\}/g, '');
  const rules = [...css.matchAll(/([^{}@]+)\{[^{}]*\}/g)].map(m => m[1].trim()).filter(sel => sel && !/^(to|from|\d+%)$/.test(sel));
  assert.ok(rules.length > 40);
  for (const sel of rules) for (const part of sel.split(/,(?![^(]*\))/)) {
    const p = part.trim();
    assert.ok(p.startsWith('html[data-shell="desktop"][data-layout="orb"]'), `unscoped selector: ${p}`);
  }
  const strip = f => read(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const js = strip('web/layouts/orb/layout.js'), styles = strip('web/layouts/orb/styles.js'), shared = strip('web/layouts/orb/shared.js');
  for (const [file, src] of [['layout.js', js], ['styles.js', styles], ['shared.js', shared], ['phone.js', strip('web/layouts/orb/phone.js')]])
    for (const banned of ['localStorage', 'sessionStorage', 'fetch(', 'XMLHttpRequest', '__wux', '__wos', 'setTimeout', 'setInterval', 'textarea', 'contenteditable', 'querySelector', 'getElementById', 'Math.random'])
      assert.ok(!src.includes(banned), `${file} uses ${banned}`);
  assert.match(js, /api\.env\.shell !== 'desktop'/);
  // The approved concept's scene: its sky drawn in canvas; the orb is a Style × a Colour (seven styles drawn in-house in
  // styles.js, nine colours), kept per device, reactive to the take and the level; live previews in the picker.
  assert.match(js, /import \{ STYLES, RETIRED, renderer, mix \} from '\.\/styles\.js';/);
  // v7: eight shader styles at Plasma's quality bar (Miguel: "better 8 excellent than 13 mediocre"); each its own
  // fragment shader, one shared WebGL context, canvas-2D Plasma / Glass / Oracle when WebGL is missing.
  const ids = [...styles.match(/export const STYLES = Object\.freeze\(\[([\s\S]*?)\]\);/)[1].matchAll(/\['([a-z]+)', '[A-Za-z ]+'\]/g)].map(m => m[1]);
  assert.deepEqual(ids, ['plasma', 'glass', 'oracle', 'chrome', 'marble', 'sun', 'planet', 'blackhole']);
  for (const id of ids.filter(i => i !== 'oracle')) assert.match(styles, new RegExp(`\\n  ${id}: \``), `${id} has its own shader`);
  assert.match(styles, /FRAG\.oracle = FRAG\.glass;/); assert.match(styles, /getContext\('webgl', \{/); assert.match(styles, /function plasma2d\(/); assert.match(styles, /function glass2d\(/);
  assert.match(styles, /const CAP = 640;/, 'frame cost capped'); assert.match(styles, /if \(cost > 12 && q > \.4\) \{ q = Math\.max\(\.4, q \* \.8\);/, 'a slow GPU renders fewer pixels');
  assert.deepEqual([...styles.match(/export const RETIRED = Object\.freeze\(\[([^\]]*)\]\)/)[1].matchAll(/'([a-z]+)'/g)].map(m => m[1]), ['swarm', 'holo', 'glitch', 'crystal', 'aurora']);
  assert.ok(!/function (swarm|holo|glitch|crystal|aurora|bust|headSDF)\(/.test(styles), 'retired styles are gone');
  assert.match(js, /import \{ COLOURS, has, lookOf, palettes, starsFor, paintSky, A, regular, orbitApps as orbitList, glyphOf, colourOf, hash, boltPainter \} from '\.\/shared\.js';/, 'one look, sky, satellite list and bolt for both shells');
  assert.match(shared, /export const COLOURS = \[\['nebula', 'Nebula'\], .*\['arctic', 'Arctic'\],\n  \['marble', 'Marble'\], \['obsidian', 'Obsidian'\], \['bronze', 'Bronze'\], \['royal', 'Royal'\], \['crimson', 'Crimson'\], \['cyber', 'Cyber'\], \['sunset', 'Sunset'\], \['ocean', 'Ocean'\], \['skin', 'Skin accent'\]\];/);
  const tcss = read('web/tweaks/miguel/orb-shell/tweak.css');
  for (const id of ['nebula', 'ember', 'tide', 'gold', 'mono', 'emerald', 'rose', 'arctic', 'marble', 'obsidian', 'bronze', 'royal', 'crimson', 'cyber', 'sunset', 'ocean']) assert.match(tcss, new RegExp(`--ob-look-${id}: #[0-9a-f]{6}, #[0-9a-f]{6}, #[0-9a-f]{6}, #[0-9a-f]{6};`));
  assert.match(js, /function drawSky\(t, lv\) \{ paintSky\(sx, /); assert.match(shared, /export function paintSky\(/); assert.match(js, /api\.storage\.set\('style', styleId\); api\.storage\.set\('colour', colourId\);/);
  assert.match(js, /let \{ styleId, colourId \} = lookOf\(api\);/);
  assert.match(shared, /if \(!has\(STYLES, styleId\)\) styleId = legacy === 'oracle' \? 'oracle' : RETIRED\.includes\(styleId\) \? 'plasma' : 'glass';/, 'the v3 look carries over; a retired style becomes Plasma');
  assert.match(js, /api\.orb\.onLevel\(/); assert.match(js, /api\.on\('voice', onVoice\)/);
  assert.match(js, /popOff = api\.back\.push\(\(\) => openPop\(false\)\)/, 'Esc folds the picker first');
  assert.match(js, /if \(!pop\.hidden && \(frameN\+\+ & 1\)\) previews\(t\);/, 'previews only while the picker is open');
  // No desks: the layout holds the panel and docks the stock Chats list. v6: THE ORB NEVER MOVES: its centre is the
  // screen's centre whatever is open (never recentred into the free space, never dimmed behind a panel); an open chat
  // only lets it step down in size where it stands so the column fits beside it.
  assert.match(js, /api\.panel\.claim\(\);/); assert.match(js, /api\.panel\.dock\(!folded\);/);
  assert.match(js, /cx = W \/ 2;\n/); assert.ok(!/cx \+?= \(?cxTarget/.test(js) && !js.includes('cxTarget'), 'the orb is never eased to another spot');
  assert.match(js, /scene\.style\.setProperty\('--ob-cx', Math\.round\(cx\) \+ 'px'\)/);
  assert.match(js, /const k = chat \? clamp\(\(W \/ 2 - chatR - GAP\) \/ r, \.45, 1\) : 1;/);
  assert.ok(!/:is\(\.ob-orbwrap, \.ob-field\) \{ opacity/.test(read('web/layouts/orb/layout.css')), 'the orb is never dimmed behind a panel');
  // The interconnection: an open app's satellite pins between the orb and its panel; electric bolts in the orb's colour
  // run orb → app → panel edge (and orb → chat column), drawn on the sky canvas in the same ~30 fps loop; reduced
  // motion = one still line (fixed seed, no spark).
  assert.match(js, /const want = pinId && s\.id === pinId \? 1 : 0;/); assert.match(js, /s\.el\.classList\.toggle\('is-pinned', k > \.5\);/);
  assert.match(js, /bolt\(cx \+ R, cy, s\.x - half, s\.y, t, pin, seed \+ 23, P\);/); assert.match(js, /bolt\(s\.x \+ half, s\.y, G\.appL, cy, t, pin, seed \+ 41, P\);/);
  assert.match(js, /if \(bolts\.chat\) bolt\(cx - R, cy, G\.chatR, cy,/);
  assert.match(js, /const seed = reduced \? 977 : boltSeed/); assert.match(shared, /if \(!reduced\) \{ const u = /, 'the running spark only with motion');
  // one bolt drawing for both shells (shared.js), never a copy in either
  assert.match(js, /const \{ bolt, glowAt \} = boltPainter\(sx, reduced\);/); assert.match(shared, /export function boltPainter\(sx, reduced\) \{/);
  for (const src of [js, strip('web/layouts/orb/phone.js')]) assert.ok(!/function (jag|bolt|glowAt)\(/.test(src), 'no forked bolt code');
  assert.match(js, /placeSats\(dt\);\n    drawBolts\(t, dt\);/);
  assert.match(js, /const awake = !!home && !doc\.hidden;/, 'asleep off Home and in hidden tabs');
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.ok(!js.includes('paper-shaders') && !existsSync(new URL('web/layouts/orb/vendor', root)), 'no vendored code');
  // Apps: round satellites on two tilted orbits with depth; their own logo, else a designed glyph; never a letter tile.
  assert.match(js, /ring: i % 2 \? 1 : 1\.32/); assert.match(js, /const depth = Math\.sin\(s\.a\)/);
  assert.match(js, /api\.apps\.logo\(a\.id\)/);
  // Clean marks: no glass plate behind an app (logo or glyph alone); the shell's own count badge on each, live; no
  // name label under the orb.
  const sl = read('web/layouts/orb/layout.css'), satRule = sl.match(/\] \.ob-sat \{([^}]*)\}/)[1];
  assert.match(satRule, /background: none;/); assert.ok(!/backdrop-filter|border: 1px|box-shadow/.test(satRule), 'no container behind the app');
  assert.match(js, /let badgeMap = api\.apps\.badges\(m => \{ badgeMap = m; paintApps\(\); for \(const s of sats\) paintBadge\(s\.el, s\.id\); \}\);/);
  assert.ok(!js.includes("'ob-name'") && !sl.includes('.ob-name'), 'no agent name label in orb mode'); assert.match(js, /sgi sg-\$\{glyphOf\(a\)\}/); assert.ok(!js.includes("'sgi sgl"), 'no letter sigils drawn');
  // Conversations: the stock Chats list docked (no pills of its own any more); it folds to a strip with the Ready count,
  // kept per device, and ⌥\ toggles it.
  assert.ok(!js.includes('ob-th') && !js.includes('MAX_ROWS'), 'no second list under the orb');
  assert.match(js, /api\.storage\.set\('folded', folded\);/); assert.match(js, /e\.code === 'Backslash'/);
  assert.match(js, /badge\.textContent = n \? String\(n\) : '';/);
  const lcss = read('web/layouts/orb/layout.css');
  assert.match(lcss, /\.panel-layer > \.win\.panel\[data-dock\] \{\n  top: 0; left: 0; bottom: 0; width: var\(--ob-col-w\);/, 'full height, flush left');
  assert.match(lcss, /\.panel-layer > \.win\.panel\[data-side="beside"\] \{\n  z-index: 2; top: 0; bottom: 0; left: var\(--ob-beside-left, var\(--ob-col-w\)\); right: auto; width: var\(--ob-chat-w\);/, 'a chat: a column right beside the list');
  assert.match(lcss, /\.panel-layer > \.win\.panel\[data-side="right"\] \{ z-index: 2; width: var\(--ob-app-w\);/, 'an app: the right third');
  assert.match(lcss, /\.ob-dock \{\n  position: absolute; left: 50%; bottom: 22px; transform: translateX\(-50%\);/, 'search pill and Look on the orb\'s axis at the bottom');
  // The hint names the shell's real keys (⌥V new voice chat, ⌥N new chat; Right ⌘ in the Mac app).
  assert.match(js, /native \? 'Right ⌘' : mod \+ 'V'/); assert.match(js, /el\('kbd', '', \{ text: mod \+ 'Space' \}\)/, 'the search pill names ⌥Space');
  const m = JSON.parse(read('web/tweaks/miguel/orb-shell/manifest.json'));
  assert.deepEqual(m.capabilities, ['layout']);
  const prof = JSON.parse(read('web/tweaks/miguel/profile.json'));
  assert.ok(prof.tweaks.includes('miguel/orb-shell') && prof.off.includes('miguel/orb-shell'), 'listed under Miguel, off by default');
});

test('apps.logo: the Store logo route, placeholders mean no logo, bad ids never fetch', async () => {
  const D = desk(); const asked = [];
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  D.ctx.fetch = async url => { asked.push(String(url)); return { ok: true, headers: { get: () => 'image/png' }, blob: async () => ({ size: png.length, arrayBuffer: async () => png.buffer }) }; };
  D.ctx.crypto = globalThis.crypto; D.ctx.AbortSignal = AbortSignal; D.ctx.Uint8Array = Uint8Array; D.ctx.URL.createObjectURL = () => 'blob:logo';
  D.host.attach(D.adapter); D.host.setLayout('orb'); await settle();
  assert.equal(await D.api.apps.logo('files'), 'blob:logo');
  assert.equal(await D.api.apps.logo('files'), 'blob:logo'); assert.equal(asked.length, 1, 'one read per app per page');
  assert.match(asked[0], /\/wizard-os-home\/store-data\/logo\/files$/);
  assert.equal(await D.api.apps.logo('../x'), null); assert.equal(asked.length, 1);
  assert.ok(read('web/core/skin-host.js').includes("'59b4d70aa80ab18cd3bcfa0e998d2f1b570bd86c2edac5be588f4a64626675c6'"), 'the template logo means no logo');
  D.host.setLayout('classic'); await settle();
});

test('Desks | Orbs switch: desktop bar and phone Home, switches only its own author\'s tweak, through the device tweak mix', async () => {
  const src = read('web/tweaks/miguel/orb-switch/tweak.js');
  // two equal views, named Desks and Orbs (Miguel, 31 Oct 2026); the tweak ids stay, so devices keep their choice
  assert.match(src, /side\(false, 'Desks'\), orb = side\(true, 'Orbs'\)/); assert.ok(!/'Classic'|'Orb'\)/.test(src));
  assert.equal(JSON.parse(read('web/tweaks/miguel/orb-shell/manifest.json')).name, 'Orbs view'); assert.equal(JSON.parse(read('web/tweaks/miguel/orb-switch/manifest.json')).name, 'Desks | Orbs switch');
  assert.match(src, /api\.settings\.toggleTweak\(ORB\)/); assert.match(src, /if \(desk\) api\.slot\.mount\('bar-center', box, -10\);\n  else api\.slot\.mount\('home-main', box, -20\);/);
  const host = read('web/core/skin-host.js');
  assert.match(host, /toggleTweak\(id\) \{\n\s+if \(!trusted \|\| a\.dead\) throw/);
  assert.match(host, /!id\.startsWith\(a\.id\.split\('\/'\)\[0\] \+ '\/'\)\) return Promise\.resolve\(false\)/, 'own author only');
  assert.match(host, /window\.WosExperience\?\.toggle\?\.\(id\)/);
  const f = fixture({ shell: 'desktop' }); let api;
  f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  await f.host.loadTweaks(['miguel/orb-switch'], f.slots, { teamAuthors: ['miguel'] });
  const asked = []; f.ctx.window.WosExperience = { toggle: async id => { asked.push(id); } };
  assert.equal(await api.settings.toggleTweak('wizard/two-orbs'), false, 'never another author\'s tweak');
  assert.equal(await api.settings.toggleTweak('miguel/orb-shell'), true); assert.deepEqual(asked, ['miguel/orb-shell']);
  await f.clear();
  const css = read('web/tweaks/miguel/orb-switch/tweak.css');
  assert.match(css, /html\[data-shell="desktop"\]:not\(\[data-layout="orb"\]\) \.os-side\.is-classic/, 'the lit side follows what is really worn');
});

test('bar-center: a core slot in the middle of the desktop bar; the clock steps aside while it holds anything', () => {
  const html = read('web/desktop.html');
  assert.match(html, /<div class="bar-c">\s*<div class="bar-center" data-slot="bar-center"><\/div>\s*<button id="clock"/);
  assert.ok(JSON.parse(read('web/core/slots.json')).slots['bar-center'], 'in the slot contract');
  const css = read('web/desktop/desktop.css');
  assert.match(css, /\.bar-center:empty \{ display: none; \}/); assert.match(css, /\.bar-center:not\(:empty\) ~ #clock \{ display: none; \}/);
  assert.match(css, /html\.voice-on \.bar-center \{ visibility: hidden; \}/, 'out of the voice pill\'s way');
});

test('the Orb desktop opens threads in the stock window (no card override)', () => {
  assert.ok(!read('web/desktop/desktop.js').includes('--desktop-window-max-height'));
  assert.ok(!read('web/layouts/orb/layout.css').includes('--desktop-window-max'));
});

test('Orbs view: hold the LEFT ⌥ for bare app letters — only while held, one plain letter each, stable, collision-free', async () => {
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
  const js = read('web/layouts/orb/layout.js'), desk = read('web/desktop/desktop.js');
  // armed only by the physical left ⌥ with no other key; any other key, the release or a blur drops it at once
  assert.match(js, /if \(isLeftAlt\(e\) && !e\.repeat && !e\.metaKey && !e\.ctrlKey && !e\.shiftKey\) \{ altHeld = true; altCancel\?\.\(\); altCancel = api\.after\(HOLD_MS,/);
  assert.match(js, /if \(keysOn && e\.altKey && !e\.metaKey && !e\.ctrlKey && !e\.shiftKey\) \{\n        const k = keyOf\(e\), id = k && byKey\.get\(k\);\n        if \(id\) \{ dropHold\(\); if \(!e\.repeat\) api\.apps\.open\(id\); return true; \}/, 'a letter wins only while they show');
  assert.match(js, /up\(e\) \{ if \(isLeftAlt\(e\) \|\| e\.key === 'Alt'\) dropHold\(\); \}/); assert.match(js, /api\.listen\(globalThis, 'blur', dropHold\);/);
  assert.match(js, /kc\.textContent = k; kc\.hidden = !k;/, 'bare letters on the satellites'); assert.match(js, /api\.storage\.set\('keys',/);
  // the layout sees keys before the desktop's own ⌥ bindings (app frames too), and owns the hold overlay
  assert.match(desk, /if \(globalThis\.WosSkinHost\?\.key\?\.\(e\)\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); return; \}/);
  assert.match(desk, /e\.code !== 'AltLeft' \|\| e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| window\.WosSkinHost\?\.holdKeys\) return;/);
  assert.equal((desk.match(/keyHints\.up\(e\); window\.WosSkinHost\?\.keyUp\?\.\(e\);/g) || []).length, 2, 'releases from the page and from app frames');
  assert.match(desk, /openPalette: \(\) => palToggle\('all'\),/);
});

test('Orbs view keys: ⌥\\ list open/folded, ⌥⇧\\ wide, ⌥⇧C chat column, ⌥⇧A app panel; never a desktop binding; in the ⌥/ guide', () => {
  const js = read('web/layouts/orb/layout.js'), desk = read('web/desktop/desktop.js');
  const on = desk.slice(desk.indexOf('  function onKey('), desk.indexOf("  addEventListener('keydown', e => onKey(e), true);"));
  assert.ok(!/Backslash/.test(on), '⌥\\ is free on the desktop');
  for (const line of on.split('\n')) for (const m of line.matchAll(/code === 'Key([CA])'/g)) assert.match(line, /!shift/, `⌥⇧${m[1]} is free on the desktop`);
  assert.match(js, /if \(alt && e\.code === 'Backslash'\) \{ if \(!e\.repeat\) \{ if \(e\.shiftKey\) widen\(!maxed\); else if \(maxed\) widen\(false\); else fold\(!folded\); \} return true; \}/);
  assert.match(js, /api\.panel\.close\(e\.code === 'KeyC' \? 'chat' : 'app'\)/);
  assert.match(js, /api\.storage\.set\('listMax', maxed\)/); assert.match(js, /const listW = wide \? Math\.round\(Math\.max\(D\.list, W \/ 2 - r - GAP\)\)/, 'wide = up to the orb\'s edge; the orb stays put');
  assert.match(js, /api\.keys\.guide\(\(\) => \[/); assert.match(desk, /for \(const h of window\.WosSkinHost\?\.keyChips\?\.\(\) \|\| \[\]\) if \(vis\(h\.el\)\) chip\(/);
  assert.match(desk, /panelCloseKind: kind => \{ const w = kind === 'app' \? panelAppW\(\) : kind === 'chat' \? panelChat\(\) : null; return w \? panelClose\(\{ id: w\.id \}\) : false; \},/);
});

test('Orbs view command take: the orb\'s own state and caption; results instead of toasts; a miss offers ↵ ask the agent', async () => {
  const D = desk(); const seen = [];
  D.adapter.askAgent = text => { D.calls.push(['ask', text]); return true; };
  D.host.attach(D.adapter); D.host.setLayout('orb'); await settle();
  const api = D.api;
  assert.equal(D.host.commandUi, false);
  const off = api.voice.onCommand(r => seen.push(r)); assert.equal(D.host.commandUi, true, 'the shell skips its toast while a layout draws it');
  D.host.commandResult({ result: 'miss', text: 'make me a sandwich' }); assert.equal(seen[0].result, 'miss'); assert.ok(Object.isFrozen(seen[0]));
  assert.equal(api.voice.ask('  make me a sandwich '), true); assert.equal(api.voice.ask(''), false);
  assert.deepEqual(D.calls.filter(c => c[0] === 'ask'), [['ask', 'make me a sandwich']]);
  off(); assert.equal(D.host.commandUi, false);
  const keys = []; api.keys.on({ down: e => { keys.push(e.code); return e.code === 'KeyQ'; }, hold: true });
  assert.equal(D.host.holdKeys, true); assert.equal(D.host.key({ code: 'KeyQ' }), true); assert.equal(D.host.key({ code: 'KeyZ' }), false);
  D.host.setLayout('classic'); await settle();
  assert.equal(D.host.holdKeys, false, 'released with the layout'); assert.equal(D.host.key({ code: 'KeyQ' }), false); assert.equal(D.host.commandUi, false);
  const src = read('web/desktop/desktop.js'), js = read('web/layouts/orb/layout.js'), css = read('web/layouts/orb/layout.css');
  assert.match(src, /const owned=!!window\.WosSkinHost\?\.commandUi, said=ev=>window\.WosSkinHost\?\.commandResult\?\.\(ev\);/);
  assert.match(src, /if\(window\.WosSkinHost\?\.commandUi\)\{const app=ok&&\/open\|launch\|app\/\.test\(cmd\.action\)\?findApp\(cmd\.app\|\|cmd\.target\)\?\.id\|\|'':'';window\.WosSkinHost\.commandResult\(\{result:ok\?'done':'miss'/);
  assert.match(src, /commandSaid\(ok,cmd,it\.text,music\);return ok\?'local':'none';/, 'the real take and the QA seam share one result path');
  assert.match(src, /else toast\(ok\?'⚡':'!',ok\?'Command handled on-device':'No command matched · nothing sent',2600\);/, 'other layouts keep the toast');
  assert.match(src, /rootCls\.toggle\('voice-cmd', commandTake && st !== 'idle'\)/); assert.match(css, /\.voice-cmd :is\(#voicePill, #voiceGlow\) \{ display: none !important; \}/);
  assert.match(src, /askAgent: text => \{ void ask\(text, 'an orb command with no local match, sent on as a message', null, null, true\); return true; \},/);
  assert.match(js, /else if \(r\.result === 'miss'\) say\('No command for ' \+ \(q \|\| 'that'\), \{ ask: String\(r\.text \|\| ''\)\.trim\(\)/);
  assert.match(js, /if \(pendingAsk && e\.key === 'Enter' && !e\.altKey && !e\.metaKey && !e\.ctrlKey && !e\.shiftKey && !typingIn\(e\.target\)\) \{ askNow\(\); return true; \}/);
  assert.match(js, /drawOrb\(ox, orbCv\.width, frameOf\(t, level, modeOf\(voice\), flash, blink, colourId, cmdK\)\);/, 'the orb draws the command state');
  assert.match(js, /p\.started = Promise\.resolve\(api\.voice\.command\(\)\)/, 'holding the orb is the same command take');
  assert.match(read('web/core/commands.js'), /const isMessageTake = \(kind, typed = false\) => !typed && kind !== 'command';/, 'a tap is still a message');
});

test('Orbs view satellites are status: running apps (closing only hides; Close quits) and regular apps with a count', () => {
  const js = read('web/layouts/orb/layout.js'), shared = read('web/layouts/orb/shared.js'), desk = read('web/desktop/desktop.js'), css = read('web/desktop/desktop.css');
  assert.match(js, /const orbitApps = \(\) => orbitList\(api, badgeMap\);/, 'the shared list (the phone floats the same one)');
  assert.match(shared, /export const regular = a => !a\.system && !a\.dev && !a\.connector && !a\.agent;/);
  assert.match(shared, /return all\.filter\(a => run\.has\(a\.id\) \? !a\.agent && !a\.connector : regular\(a\) && \(badgeMap\[a\.id\] \|\| 0\) > 0\)/);
  assert.match(desk, /system: !!AK\?\.isSystem\?\.\(a\), dev: !!AK\?\.inDev\?\.\(a\), connector: !!AK\?\.isConnector\?\.\(a\), agent: !!a\.agent \|\| a\.kind === 'chats'/, 'the shell\'s own kinds, no list of ids');
  assert.match(js, /api\.panel\.park\(true\);/); assert.match(js, /item\('Close', \(\) => \{ api\.panel\.quit\(a\.id\);/);
  assert.match(desk, /const wasApp = panelApp\?\.id === w\.id, park = wasApp && \(panelParks \|\| panelDeskApp\(w\)\) && !quit;/);
  assert.match(desk, /if \(park\) panelPark\(w\.id\); else if \(wasApp && panelDeskApp\(w\)\) \{ panelDeskClose\(w\.id\); panelApp = null; \}/, 'Close closes its desk');
  assert.match(desk, /trackOpenApps\?\.\(\(\) => \[\.\.\.ws\.flatMap\(d => d\.wins\)/, 'a hidden app is a desk window: it still counts as open (its mic and audio keep going)');
  assert.match(desk, /for \(const w of panelWins\(\)\) if \(!panelDeskApp\(w\) \|\| wsOf\(w\.id\) < 0\) panelDrop\(w\.id, \{ swap: true \}\);/, 'turning the layout off keeps the desks\' apps (the Desks view shows them)');
  assert.match(css, /\.panel-layer > \.win\.panel\.panel-parked \{ animation: panel-park 380ms cubic-bezier\(\.4, 0, \.7, \.2\) both; pointer-events: none; visibility: hidden; \}/);
});

test('Orbs view: the list, chat and app panels resize from thin grips, kept per device, never overlapping', () => {
  const js = read('web/layouts/orb/layout.js'), css = read('web/layouts/orb/layout.css');
  assert.match(js, /const limits = \(\) => \(\{ list: \[260, 520\], chat: \[Math\.min\(360, W \* \.45\), Math\.max\(360, W \* \.45\)\], app: \[Math\.min\(360, W \* \.6\), Math\.max\(360, W \* \.6\)\] \}\);/);
  assert.match(js, /if \(C \+ A > room\) \{ C = Math\.max\(lim\.chat\[0\], room - A\);/, 'never overlapping');
  assert.match(js, /el\('div', 'ob-grip', \{ role: 'separator', 'aria-orientation': 'vertical', tabindex: '0'/, 'keyboard-reachable separators');
  assert.match(js, /function save\(\) \{ api\.storage\.set\('widths', sized\); \}/); assert.match(js, /api\.listen\(g, 'dblclick', \(\) => \{ delete sized\[id\]; save\(\); aim\(\); \}\);/);
  assert.match(js, /cx = W \/ 2;\n/, 'the orb stays at the centre');
  assert.match(css, /\.ob-grip \{\n  position: absolute; top: 0; bottom: 0; width: 10px; margin-left: -5px; cursor: col-resize;/);
});

test('Orbs view satellites stay minimal (Miguel, v8): just the mark, a dot not a ring, a clean count dot, bare letters; the search pill opens any app', () => {
  const js = read('web/layouts/orb/layout.js'), css = read('web/layouts/orb/layout.css');
  assert.doesNotMatch(js + css, /ob-sat-ring|is-all/, 'no ring around a running app and no All apps satellite');
  assert.match(css, /\.ob-sat\[data-run="hidden"\] \.ob-sat-run \{/, 'running out of sight = a tiny dot under the mark');
  assert.match(css, /\.ob-sat-run \{[^}]*width: 4px; height: 4px;/);
  const badge = /\.ob-sat-badge \{([^}]*)\}/.exec(css)[1];
  assert.doesNotMatch(badge, /0 0 0 \dpx/, 'the count dot has no ring');
  for (const sel of ['.ob-sat-key {', '.ob-keyrow-i b {']) { const i = css.indexOf(sel); assert.ok(i > 0, sel); assert.doesNotMatch(css.slice(i, css.indexOf('}', i)), /background: var\(--ob-glass|border: 1px/, sel + ' is a bare letter, no keycap'); }
  assert.match(js, /el\('span', 'ob-search-l', \{ text: 'Search apps or ask…' \}\)/);
  assert.match(js, /api\.listen\(hint, 'click', \(\) => api\.apps\.all\(\)\);/, 'the pill opens the launcher in its apps-first mode');
  assert.match(js, /all apps: ' \+ MK \+ 'O'/, 'its tooltip names ⌥O');
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

test('opt-in for everyone: both Orbs tweaks are listed under Miguel, never catalog defaults; no migration turns them on', async () => {
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  for (const id of ['miguel/orb-shell', 'miguel/orb-switch']) {
    assert.ok(cat.tweaks.includes(id), id + ' is in the catalog (Settings › Look › Tweaks › Miguel)');
    assert.ok(!cat.defaults.includes(id), id + ' is not a catalog default: nobody\'s desktop changes until they turn it on');
  }
  const exp = read('web/core/experience.js');
  assert.ok(!/orb-shell|orb-switch/.test(exp), 'no migration on main turns either on for anyone');
});

test('Orbs view alone is never a dead end: the scene offers Back to the Desks view (turns off the tweak wearing it)', async () => {
  const src = read('web/layouts/orb/layout.js');
  assert.match(src, /'Back to the Desks view'/); assert.match(src, /api\.desk\.classic\(\)/);
  const f = fixture({ shell: 'desktop' }); let L = null;
  f.host._test.setImporter(async url => url.includes('/layouts/') ? { default: a => { L = a; return () => {}; } } : { default: api => api.layout.use('orb') });
  await f.mount('miguel/orb-shell'); await settle();
  assert.equal(f.host.layout, 'orb'); assert.ok(L, 'layout set up');
  const asked = []; f.ctx.window.WosExperience = { toggle: async id => { asked.push(id); } };
  assert.equal(await L.desk.classic(), true); assert.deepEqual(asked, ['miguel/orb-shell'], 'the same device switch as Settings › Look');
  await f.clear();
  assert.equal(await L.desk.classic(), false, 'inert once the layout is gone'); assert.deepEqual(asked, ['miguel/orb-shell']);
});
