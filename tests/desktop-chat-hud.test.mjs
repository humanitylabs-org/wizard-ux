// Minimized chat on the desktop: a Chats window lives on its desk or in a bubble at the bottom right that opens it on the right side of any desk (no free floating, no orb).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const js = read('web/desktop/desktop.js'), html = read('web/desktop.html'), css = read('web/desktop/desktop.css');

test('Chats windows get a Minimize button beside ✕; other windows do not; no float button (Miguel, 30 Oct 2026)', () => {
  assert.match(js, /w\.app === 'chats' \? `<button data-wact="hud-min" title="Minimize \(\$\{MOD\}M\)" aria-label="Minimize" aria-keyshortcuts="Alt\+M">\$\{MIN_ICON\}<\/button>` : ''/);
  assert.doesNotMatch(js, /data-wact="hud"[ >]|Float over every desk|act === 'hud'\)/);
  assert.match(js, /if \(act === 'hud-min'\) return hudOn\(id\);/);
  assert.match(js, /if \(act === 'close' && hud\?\.id === id\) return hudClose\(\);\s*\n\s*if \(act === 'close'\) return closeWin\(id\);/);
  // Borderless frames hide title-bar buttons except ✕: Minimize is re-shown next to it.
  assert.match(css, /html\[data-skin-frame="borderless"\] \.wbar > \[data-wact\^="hud"\] \{[^}]*display: grid/);
});

test('the HUD window lives outside the desks: never pruned at boot, never synced, never tiled', () => {
  assert.match(js, /if \(id !== hud\?\.id && !ws\.some\(d => d\.wins\.includes\(id\)\)\) delete W\[id\];/);
  assert.match(js, /store\.set\('hud', hud\)/);
  // Workspace sync shows the minimized chat to other devices first on desktop 1, as a normal window.
  assert.match(js, /read: \(\) => \(\{ desks: ws\.map\(\(d, i\) => \(\{ id: d\.id, wins: \[\.\.\.\(i === 0 && hud && W\[hud\.id\] \? \[hud\.id\] : \[\]\), \.\.\.d\.wins\]/);
  // It leaves its desk when floated and goes back to the desk in front when put back.
  const on = js.slice(js.indexOf('function hudOn('), js.indexOf('function hudKeepPlace('));
  assert.match(on, /d\.wins\.splice\(i, 1\);/);
  const dock = js.slice(js.indexOf('function hudDock('), js.indexOf('function hudClose('));
  assert.match(dock, /const d = ws\[t\], at = /);
  assert.match(dock, /d\.wins\.splice\(at, 0, id\)/);
});

test('render keeps the HUD above every desk and Home; the open HUD counts as visible and keeps polling', () => {
  assert.match(js, /\$\$\('\.wsp', stage\)\.forEach\([^\n]+\n\s*hudMount\(\);/);
  assert.match(js, /visible: \(\) => \[\.\.\.\(homeOpen \? \[\] : ws\[cur\]\.wins\), \.\.\.\(hud\?\.open \? \[hud\.id\] : \[\]\)\]/);
  assert.match(js, /setInterval\(\(\) => \{ if \(document\.hidden\) return; for \(const id of \[\.\.\.ws\[cur\]\.wins, \.\.\.\(hud\?\.open \? \[hud\.id\] : \[\]\)\]\)/);
  assert.match(css, /\.hud-layer \{ position: absolute; inset: 0; z-index: 150; pointer-events: none; \}/);
});

test('two places only: on its desk, or minimized in the bubble (opens on the right side); no free-floating chat, no orb', () => {
  assert.doesNotMatch(js, /hud-dock|hudOrb|Drag to move/);
  assert.doesNotMatch(js, /code === 'KeyB'\) return hit\(\(\) => \{[^\n]*hud/i); // ⌥B never comes back as the floating chat
  assert.doesNotMatch(html, /hudOrb|<script src="orb\.js">/);
  const bar = js.slice(js.indexOf('function barHtml('), js.indexOf('return `<div class="wbar" data-drag>', js.indexOf('function barHtml(')));
  assert.deepEqual([...bar.matchAll(/data-wact="([^"]+)"/g)].map(m => m[1]), ['hud-min', 'hud-home', 'close']);
  // Open, it is always the side panel: the paint has no free-floating placement left.
  const paint = js.slice(js.indexOf('function hudPaint('), js.indexOf('function hudFocus('));
  assert.match(paint, /const side = !!hud\?\.open;/);
  assert.doesNotMatch(paint, /hud\.r\b|hud\.b\b/);
  assert.match(js, /else hud = \{ \.\.\.HUD_DEF, \.\.\.hud, open: hud\.open !== false, side: true \};/);
  // The bubble wears the chat's agent hat, like the chat title bar.
  assert.match(paint, /window\.WosAgents\.sigil\(window\.WosAgents\.titleRecord\(W\[hud\.id\]\?\.agent \|\| ''\), 'hb-sig'\)/);
});

test('minimized, the chat is a bubble at the bottom right; the bubble and ⌥M open it on the right side as a split, and minimize it again', () => {
  assert.match(js, /if \(alt && !shift && code === 'KeyM'\) return hit\(\(\) => \{ if \(!e\.repeat\) \{ closePalette\(\{ restore: false \}\); hudToggle\(\); \} \}\);/);
  assert.match(js, /b\.addEventListener\('click', \(\) => hudToggle\(\)\);/);
  assert.match(js, /else hud = \{ \.\.\.HUD_DEF, \.\.\.hud, open: hud\.open !== false/); // a minimized chat stays minimized across reloads
  assert.match(css, /\.stage\.hud-split > \.wsp, \.stage\.hud-split > \.desktop-home \{ right: var\(--hud-side, 0px\); \}/);
  assert.match(css, /html\[data-skin-frame="borderless"\] \.win\.hud \.wbar > \[data-wact="hud-min"\] \{ right:/);
  const src = js.slice(js.indexOf('function hudFold('), js.indexOf('// Back / Esc inside the side chat'));
  for (const kind of ['main', 'host-profile', 'container', 'restricted']) {
    const here = { id: 'h', app: 'chats', thread: 't-' + kind, ...(kind === 'main' ? {} : { agent: kind }) }, away = { id: 'm', app: 'chats', thread: 'main-away' };
    const calls = [];
    const ctx = { W: { h: here, m: away }, ws: [{ wins: ['h'] }, { wins: ['m'] }], cur: 0, homeOpen: false, hud: null, focused: () => here,
      mainChats: w => !!(w && w.app === 'chats' && !w.agent), findWin: () => away, newWin: () => ({ id: 'n' }),
      hudOn: id => { calls.push('on:' + id); ctx.hud = { id, open: false, side: true }; return true; },
      hudHasFocus: () => true, save() {}, render() {}, restFocus: () => calls.push('rest'), log() {}, hudFocus() {}, setTimeout: f => f(),
      CHATS: { markVisibleThreadsSeen() {} } };
    vm.runInNewContext(src + '\nhudToggle();', ctx);
    assert.deepEqual(calls, ['on:h'], kind + ': ⌥M with nothing minimized minimizes the chat in front');
    vm.runInNewContext(src + '\nhudToggle();', ctx);
    assert.deepEqual([ctx.hud.open, ctx.hud.side], [true, true], kind + ': the bubble opens it on the right side');
    vm.runInNewContext(src + '\nhudToggle();', ctx);
    assert.equal(ctx.hud.open, false, kind + ': and again minimizes it');
    assert.equal(away.thread, 'main-away'); assert.equal(here.thread, 't-' + kind);
  }
});

test('keys, voice and chat actions follow the keyboard into the HUD; desk routes never reuse it (Codex P1/P2)', () => {
  assert.match(js, /const focused = \(\) => hudHasFocus\(\) \? W\[hud\.id\] : homeOpen \? null : W\[ws\[cur\]\.focus\] \|\| null;/);
  assert.match(js, /function closeWin\(id, internal = false\) \{\n(?:\s*if \(!internal && !canLeave\(id\)\) return;\n)?\s*if \(hud\?\.id === id\) \{ hudClose\(\); return; \}/);
  assert.match(js, /function focusWin\(id, \{ scroll = true \} = \{\}\) \{\n\s*if \(hud\?\.id === id\) \{ hudFocus\(\); return; \}/);
  assert.match(js, /return Object\.values\(W\)\.find\(w => w\.id !== hud\?\.id && fn\(w\)\) \|\| null;/);
  assert.match(js, /function toNewChat\(wid, why\) \{\n\s*const w = W\[wid\]; if \(hud\?\.id === wid \|\|/);
});

test('the heads-up chat is fully opaque (James: floating text panels are solid)', () => {
  const rule = css.match(/\.win\.hud \{[^}]*\}/)[0];
  assert.doesNotMatch(rule, /backdrop-filter/);
});

test('⌥P puts the minimized chat back on desktop 1, like its 1 button; with nothing minimized it only explains ⌥M', () => {
  assert.match(js, /if \(alt && !shift && code === 'KeyP'\) return hit\(\(\) => \{ if \(!e\.repeat\) \{ closePalette\(\{ restore: false \}\); hudKey\(\); \} \}\);/);
  assert.match(js, /<button data-wact="hud-home" title="Back to desktop 1 \(\$\{MOD\}P\)"/);
  assert.match(js, /if \(act === 'hud-home'\) return hudDock\(\{ to: 0 \}\);/);
  const dock = js.slice(js.indexOf('function hudDock('), js.indexOf('function hudKey('));
  assert.match(dock, /const t = Number\.isInteger\(to\) && ws\[to\] \? to : cur;/);
  assert.match(dock, /if \(t !== cur\) \{ save\(\); render\(\); goWs\(t\); \}/);
  const key = js.slice(js.indexOf('function hudKey('), js.indexOf('function hudFold('));
  assert.match(key, /if \(hud\) return hudDock\(\{ to: 0 \}\);/);
  const calls = [];
  vm.runInNewContext(key + '\nhudKey();', { hud: null, MOD: '⌥', hudDock: () => calls.push('dock'), hudOn: () => calls.push('on'), toast: () => calls.push('toast') });
  assert.deepEqual(calls, ['toast'], 'nothing minimized: ⌥P neither floats nor moves anything');
  assert.match(js, /\['P', 'Chat back to desktop 1', /);
  assert.match(css, /html\[data-skin-frame="borderless"\] \.wbar > \[data-wact="hud-home"\]/);
});

test('Minimize takes the Chats window it is on, whichever agent it belongs to; ⌥M never borrows another desk\'s agent window', () => {
  const src = js.slice(js.indexOf('function hudToggle('), js.indexOf('// Back / Esc inside the side chat'));
  for (const kind of ['main', 'host-profile', 'container', 'restricted']) {
    const here = { id: 'h', app: 'chats', thread: 't-' + kind, ...(kind === 'main' ? {} : { agent: kind }) };
    const app = { id: 'a', app: 'frame', appId: 'files' }, away = { id: 'm', app: 'chats', thread: 'main-away', agent: 'other' };
    const W = { h: here, a: app, m: away }, calls = [];
    const ctx = { W, ws: [{ wins: ['a', 'h'], focus: 'a' }, { wins: ['m'] }], cur: 0, homeOpen: false, hud: null,
      focused: () => W.a, mainChats: w => !!(w && w.app === 'chats' && !w.agent), findWin: fn => Object.values(W).find(fn) || null,
      newWin: () => { calls.push('new'); return { id: 'n' }; }, hudOn: id => { calls.push('on:' + id); return true; } };
    vm.runInNewContext(src + '\nhudToggle();', ctx);
    assert.deepEqual(calls, ['on:h'], kind + ': minimizes the window on this desk, touching only its own thread');
    assert.equal(W.m.thread, 'main-away'); assert.equal(W.h.thread, 't-' + kind);
  }
});

test('Back / Esc in the floating chat leaves its thread even with Home or a full-screen desk behind it (Codex P2)', () => {
  const esc = js.slice(js.indexOf('function escStep('), js.indexOf('function escStep(') + 4000);
  assert.ok(esc.indexOf('const hb = hudBack(); if (hb) return hb;') > 0);
  assert.ok(esc.indexOf('hudBack()') < esc.indexOf("if (homeOpen) return '';"));
  assert.ok(esc.indexOf('hudBack()') < esc.indexOf('if (ws[cur].mono)'));
  const src = js.slice(js.indexOf('function hudBack('), js.indexOf('function hudClose('));
  for (const kind of ['main', 'host-profile', 'container', 'restricted']) {
    const w = { id: 'h', app: 'chats', thread: 't-' + kind, ...(kind === 'main' ? {} : { agent: kind }) }, other = { id: 'd', app: 'chats', thread: 'desk' }, calls = [];
    const ctx = { W: { h: w, d: other }, hud: { id: 'h', open: true }, hudHasFocus: () => true, hudFocus: () => calls.push('focus'), syncChatsPane: id => calls.push('sync:' + id),
      CHATS: { threadBack: x => { calls.push('back:' + x.id); x.thread = null; return 'thread'; } } };
    assert.equal(vm.runInNewContext(src + '\nhudBack();', ctx), 'thread', kind);
    assert.deepEqual(calls, ['back:h', 'sync:h', 'focus']); assert.equal(other.thread, 'desk');
    calls.length = 0; assert.equal(vm.runInNewContext(src + '\nhudBack();', ctx), '', kind + ': on the list Back passes through'); assert.deepEqual(calls, []);
  }
});

test('Back to desktop 1 gives Chats desktop 1 to itself and moves every other desk one to the right', () => {
  const src = js.slice(js.indexOf('function hudDock('), js.indexOf('function hudKey('));
  const run = (desks, kind = 'main') => {
    let n = 0; const calls = [];
    const ctx = { hud: { id: 'h' }, W: { h: { id: 'h', app: 'chats', thread: 't-' + kind, ...(kind === 'main' ? {} : { agent: kind }) }, a: { id: 'a', app: 'chats', thread: 'other' }, b: {} }, ws: desks, cur: 1, lastWs: 1, homeOpen: false,
      freshDesk: () => ({ id: 'dnew' + (n++), wins: [], focus: null, mono: false }), hudKeepPlace() {}, save() {}, render() {}, hudBar() {}, paintFocus() {}, paintBar() {}, focusInside() {}, log() {},
      winEl: () => null, setTimeout() {}, store: { set() {} }, goWs(i) { calls.push('go:' + i); ctx.cur = i; } };
    vm.runInNewContext(src + '\nhudDock({ to: 0 });', ctx);
    return { ctx, calls };
  };
  for (const kind of ['main', 'host-profile', 'container', 'restricted']) {
    const full = run([{ id: 'd1', wins: ['a'], focus: 'a' }, { id: 'd2', wins: ['b'], focus: 'b' }], kind);
    assert.deepEqual(full.ctx.ws.map(d => d.wins), [['h'], ['a'], ['b']], kind);
    assert.deepEqual(full.calls, ['go:0']);
    assert.equal(full.ctx.W.h.thread, 't-' + kind); assert.equal(full.ctx.W.h.agent, kind === 'main' ? undefined : kind);
    assert.equal(full.ctx.W.a.thread, 'other', kind + ': the window it displaces keeps its own thread');
  }
  const empty = run([{ id: 'd1', wins: [], focus: null }, { id: 'd2', wins: ['b'], focus: 'b' }]);
  assert.deepEqual(empty.ctx.ws.map(d => d.wins), [['h'], ['b']]);
});

test('the phone sees a minimized desktop chat as a normal Chats window on desktop 1, and syncing back keeps it minimized here', async () => {
  const sync = read('web/core/workspace-sync.js');
  const ctx = { window: {}, localStorage: { getItem() { return null; }, setItem() {} }, navigator: { userAgent: 'x' }, location: { href: 'https://x/' }, setTimeout, clearTimeout, console, fetch: async () => ({ ok: false }), document: { addEventListener() {}, visibilityState: 'visible' }, addEventListener() {} };
  ctx.globalThis = ctx; vm.runInNewContext(sync, ctx);
  const WS = ctx.window.WosWorkspaceSync; assert.ok(WS?.reconcile);
  const readSrc = js.match(/read: (\(\) => \(\{ desks: ws\.map\(\(d, i\)[^\n]+\}\)\) \}\)),\n/)[1];
  const W = { h: { id: 'h', app: 'chats', thread: 't1' }, a: { id: 'a', app: 'frame', appId: 'files' } };
  const ws = [{ id: 'd1', wins: ['a'], focus: 'a' }], hud = { id: 'h', open: false };
  const state = vm.runInNewContext(`(${readSrc})()`, { ws, W, hud });
  assert.deepEqual([...state.desks[0].wins.map(w => w.id)], ['h', 'a'], 'other devices get Chats first on desktop 1');
  const applySrc = js.slice(js.indexOf('const r = window.WosWorkspaceSync.reconcile(ws, W, state'), js.indexOf('r.removed.forEach'));
  const back = vm.runInNewContext(applySrc + '\nr', { window: { WosWorkspaceSync: WS }, ws, W, state: JSON.parse(JSON.stringify(state)), hud, freshDesk: () => ({ wins: [], focus: null }) });
  assert.deepEqual([...back.desks[0].wins], ['a'], 'and it stays minimized on this desktop');
  assert.ok(W.h, 'the chat is not removed');
});
