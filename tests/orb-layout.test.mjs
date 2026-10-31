// Orb desktop (Miguel, 31 Oct 2026): the miguel/orb-shell tweak wears the built-in Orb layout on the desktop only.
// These tests hold its contract:
//   - phone: the tweak changes nothing (no layout, no files);
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

test('phone: Orb desktop changes nothing (no layout, no layout files)', async () => {
  const f = fixture({ shell: 'phone' });
  await f.mount('miguel/orb-shell');
  assert.ok(f.host.tweakState.includes('miguel/orb-shell'));
  assert.equal(f.host.layout, 'classic'); assert.equal(f.doc.documentElement.dataset.layout, undefined);
  assert.ok(!f.doc.head.children.some(l => /layouts\//.test(l.href || '')), 'no layout css on the phone');
  await f.clear();
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
  assert.deepEqual(Object.keys(api.desk).sort(), ['emptyHome', 'home', 'look']);
  assert.deepEqual(Object.keys(api.voice).sort(), ['cancel', 'command', 'dictate', 'state', 'talk', 'tap']);
  assert.deepEqual(Object.keys(api.panel).sort(), ['back', 'claim', 'close', 'dock', 'state']); assert.ok(Object.isFrozen(api.panel));
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
  for (const k of ['sessions', 'apps', 'desk', 'voice', 'mount', 'panel']) assert.equal(api[k], undefined, k);
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
  // one at a time: the one before is kept for a quiet Back; the panel lives outside the desks (never synced)
  assert.match(fn('panelOpen'), /panelDrop\(prev\.id, \{ swap: true \}\)/); assert.match(fn('panelOpen'), /back = \[\.\.\.back, keep\]\.slice\(-PANEL_BACK\)/);
  assert.ok(!fn('panelOpen').includes('ws[') && !fn('panelOpen').includes('.wins'), 'no desk is touched');
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
  const js = strip('web/layouts/orb/layout.js'), styles = strip('web/layouts/orb/styles.js');
  for (const [file, src] of [['layout.js', js], ['styles.js', styles]])
    for (const banned of ['localStorage', 'sessionStorage', 'fetch(', 'XMLHttpRequest', '__wux', '__wos', 'setTimeout', 'setInterval', 'textarea', 'contenteditable', 'querySelector', 'getElementById', 'Math.random'])
      assert.ok(!src.includes(banned), `${file} uses ${banned}`);
  assert.match(js, /api\.env\.shell !== 'desktop'/);
  // The approved concept's scene: its sky drawn in canvas; the orb is a Style × a Colour (seven styles drawn in-house in
  // styles.js, nine colours), kept per device, reactive to the take and the level; live previews in the picker.
  assert.match(js, /import \{ STYLES, renderer, mix \} from '\.\/styles\.js';/);
  const ids = [...styles.match(/export const STYLES = Object\.freeze\(\[([\s\S]*?)\]\);/)[1].matchAll(/\['([a-z]+)', '[A-Za-z ]+'\]/g)].map(m => m[1]);
  assert.deepEqual(ids, ['glass', 'oracle', 'plasma', 'swarm', 'holo', 'glitch', 'chrome', 'marble', 'sun', 'blackhole', 'crystal', 'aurora', 'planet']);
  for (const id of ids) assert.match(styles, new RegExp(`function ${id}\\(`), `${id} has its own drawing`);
  assert.match(js, /const COLOURS = \[\['nebula', 'Nebula'\], .*\['arctic', 'Arctic'\],\n    \['marble', 'Marble'\], \['obsidian', 'Obsidian'\], \['bronze', 'Bronze'\], \['royal', 'Royal'\], \['crimson', 'Crimson'\], \['cyber', 'Cyber'\], \['sunset', 'Sunset'\], \['ocean', 'Ocean'\], \['skin', 'Skin accent'\]\];/);
  const tcss = read('web/tweaks/miguel/orb-shell/tweak.css');
  for (const id of ['nebula', 'ember', 'tide', 'gold', 'mono', 'emerald', 'rose', 'arctic', 'marble', 'obsidian', 'bronze', 'royal', 'crimson', 'cyber', 'sunset', 'ocean']) assert.match(tcss, new RegExp(`--ob-look-${id}: #[0-9a-f]{6}, #[0-9a-f]{6}, #[0-9a-f]{6}, #[0-9a-f]{6};`));
  assert.match(js, /function drawSky\(/); assert.match(js, /api\.storage\.set\('style', styleId\); api\.storage\.set\('colour', colourId\);/);
  assert.match(js, /if \(!has\(STYLES, styleId\)\) styleId = legacy === 'oracle' \? 'oracle' : 'glass';/, 'the v3 look carries over');
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
  assert.match(js, /const seed = reduced \? 977 : boltSeed/); assert.match(js, /if \(!reduced\) \{ const u = /, 'the running spark only with motion');
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
  assert.match(js, /let badgeMap = api\.apps\.badges\(m => \{ badgeMap = m; for \(const s of sats\) paintBadge\(s\.el, s\.id\); \}\);/);
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

test('Desks | Orbs switch: desktop only, switches only its own author\'s tweak, through the device tweak mix', async () => {
  const src = read('web/tweaks/miguel/orb-switch/tweak.js');
  // two equal views, named Desks and Orbs (Miguel, 31 Oct 2026); the tweak ids stay, so devices keep their choice
  assert.match(src, /side\(false, 'Desks'\), orb = side\(true, 'Orbs'\)/); assert.ok(!/'Classic'|'Orb'\)/.test(src));
  assert.equal(JSON.parse(read('web/tweaks/miguel/orb-shell/manifest.json')).name, 'Orbs view'); assert.equal(JSON.parse(read('web/tweaks/miguel/orb-switch/manifest.json')).name, 'Desks | Orbs switch');
  assert.match(src, /api\.settings\.toggleTweak\(ORB\)/); assert.match(src, /api\.slot\.mount\('bar-center', box/);
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

test('Orbs view: hold ⌥ for app letters — never a key the desktop binds, stable per app, every app gets one', async () => {
  const { ALT_TAKEN, SHIFT_TAKEN, assignKeys, keyOf } = await import(new URL('web/layouts/orb/keys.js', root));
  // every ⌥ letter in the desktop's key table is reserved; a binding that ignores ⇧ reserves ⌥⇧ too
  const desk = read('web/desktop/desktop.js'), on = desk.slice(desk.indexOf('  function onKey('), desk.indexOf("  addEventListener('keydown', e => onKey(e), true);"));
  for (const line of on.split('\n')) for (const m of line.matchAll(/code === 'Key([A-Z])'/g)) {
    assert.ok(ALT_TAKEN.includes(m[1]), `⌥${m[1]} is the desktop's`);
    const shiftToo = !/!shift/.test(line) && (/alt && shift/.test(line) || /^    if \((alt && )?code === 'Key/.test(line));   // top-level ⌥ bindings with no ⇧ guard
    if (shiftToo) assert.ok(SHIFT_TAKEN.includes(m[1]), `⌥⇧${m[1]} is the desktop's`);
  }
  const apps = ['Files', 'Messenger', 'Mail', 'Music', 'Money', 'Movies', 'Health', 'Home Assistant', 'Backup', 'Calendar', 'Contacts', 'Podcasts', 'Profiles', 'Wisdom', 'YouTube Music', 'Shopping', 'Sniper', 'Search', 'Setup', 'Pages', 'Troubleshooter', 'Morning Report', 'Card Benefits', 'Carlos CRM (demo)', 'Maverick Command', 'Zzz']
    .map((name, i) => ({ id: 'a' + i, name }));
  const k = assignKeys(apps);
  assert.equal(Object.keys(k).length, apps.length, 'every app has a key');
  assert.equal(new Set(Object.values(k)).size, apps.length, 'no two apps share one');
  for (const v of Object.values(k)) { const shift = v.startsWith('⇧'), l = v.slice(-1); assert.ok(shift ? !SHIFT_TAKEN.includes(l) : !ALT_TAKEN.includes(l), v); }
  assert.equal(assignKeys([{ id: 'm', name: 'Messenger' }]).m, 'E', 'Messenger: the first free letter of its name'); assert.equal(k.a0, 'E', 'Files: F, I, L are the desktop\'s, so E');
  const again = assignKeys([{ id: 'new', name: 'Echo' }, ...apps], k);
  for (const a of apps) assert.equal(again[a.id], k[a.id], 'an app keeps its letter when another arrives');
  assert.equal(keyOf({ code: 'KeyE', shiftKey: false }), 'E'); assert.equal(keyOf({ code: 'KeyB', shiftKey: true }), '⇧B'); assert.equal(keyOf({ code: 'Digit1' }), null);
  const js = read('web/layouts/orb/layout.js');
  assert.match(js, /api\.after\(350, \(\) => \{ if \(altDown\) showKeys\(true\); \}\)/); assert.match(js, /api\.storage\.set\('keys', keyMap\);/);
  assert.match(js, /api\.listen\(hint, 'click', \(\) => api\.apps\.search\(\)\);/, 'the pill opens the shell\'s own search');
  assert.match(desk, /openPalette: \(\) => palToggle\('all'\),/);
});
