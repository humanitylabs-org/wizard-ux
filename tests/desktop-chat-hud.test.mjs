// Heads-up chat (HUD) on the desktop: a Chats window floats over every desk and Home and puts it back on desktop 1 (no orb, no other options).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const js = read('web/desktop/desktop.js'), html = read('web/desktop.html'), css = read('web/desktop/desktop.css');

test('Chats windows get a float button beside ✕; other windows do not', () => {
  assert.match(js, /w\.app === 'chats' \? `<button data-wact="hud" title="Float over every desk \(\$\{MOD\}P\)"/);
  assert.match(js, /if \(act === 'hud'\) return hudOn\(id\);/);
  assert.match(js, /if \(act === 'close' && hud\?\.id === id\) return hudClose\(\);\s*\n\s*if \(act === 'close'\) return closeWin\(id\);/);
  // Borderless frames hide title-bar buttons except ✕: the float button is re-shown next to it.
  assert.match(css, /html\[data-skin-frame="borderless"\] \.wbar > \[data-wact\^="hud"\] \{[^}]*display: grid/);
});

test('the HUD window lives outside the desks: never pruned at boot, never synced, never tiled', () => {
  assert.match(js, /if \(id !== hud\?\.id && !ws\.some\(d => d\.wins\.includes\(id\)\)\) delete W\[id\];/);
  assert.match(js, /store\.set\('hud', hud\)/);
  // Workspace sync reads desk windows only, so the HUD stays on this device.
  assert.match(js, /read: \(\) => \(\{ desks: ws\.map\(d => \(\{ id: d\.id, wins: d\.wins\.map\(id => W\[id\]\)\.filter\(Boolean\) \}\)\) \}\)/);
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

test('two controls only: float over every desk, and back to desktop 1 (Miguel: no minimize, no orb, no put-back-here)', () => {
  assert.doesNotMatch(js, /hud-min|hud-dock|hudFold|hudOrb|code === 'KeyB'/);
  assert.doesNotMatch(html, /hudOrb|<script src="orb\.js">/);
  const bar = js.slice(js.indexOf('function barHtml('), js.indexOf('return `<div class="wbar" data-drag>', js.indexOf('function barHtml(')));
  assert.deepEqual([...bar.matchAll(/data-wact="([^"]+)"/g)].map(m => m[1]), ['hud-home', 'close']);
});

test('keys, voice and chat actions follow the keyboard into the HUD; desk routes never reuse it (Codex P1/P2)', () => {
  assert.match(js, /const focused = \(\) => hudHasFocus\(\) \? W\[hud\.id\] : homeOpen \? null : W\[ws\[cur\]\.focus\] \|\| null;/);
  assert.match(js, /function closeWin\(id, internal = false\) \{\n\s*if \(hud\?\.id === id\) \{ hudClose\(\); return; \}/);
  assert.match(js, /function focusWin\(id, \{ scroll = true \} = \{\}\) \{\n\s*if \(hud\?\.id === id\) \{ hudFocus\(\); return; \}/);
  assert.match(js, /return Object\.values\(W\)\.find\(w => w\.id !== hud\?\.id && fn\(w\)\) \|\| null;/);
  assert.match(js, /function toNewChat\(wid, why\) \{\n\s*const w = W\[wid\]; if \(hud\?\.id === wid \|\|/);
});

test('the heads-up chat is fully opaque (James: floating text panels are solid)', () => {
  const rule = css.match(/\.win\.hud \{[^}]*\}/)[0];
  assert.doesNotMatch(rule, /backdrop-filter/);
});

test('⌥P floats the chat over every desk and, floating, puts it back on desktop 1; the 1 button does the same', () => {
  assert.match(js, /if \(alt && !shift && code === 'KeyP'\) return hit\(\(\) => \{ if \(!e\.repeat\) \{ closePalette\(\{ restore: false \}\); hudKey\(\); \} \}\);/);
  assert.match(js, /<button data-wact="hud-home" title="Back to desktop 1 \(\$\{MOD\}P\)"/);
  assert.match(js, /if \(act === 'hud-home'\) return hudDock\(\{ to: 0 \}\);/);
  const dock = js.slice(js.indexOf('function hudDock('), js.indexOf('function hudKey('));
  assert.match(dock, /const t = Number\.isInteger\(to\) && ws\[to\] \? to : cur;/);
  assert.match(dock, /if \(t !== cur\) \{ save\(\); render\(\); goWs\(t\); \}/);
  const key = js.slice(js.indexOf('function hudKey('), js.indexOf('function hudClose('));
  assert.match(key, /if \(hud\) return hudDock\(\{ to: 0 \}\);/);
  assert.match(js, /\['P', 'Float chat', /);
  assert.match(css, /html\[data-skin-frame="borderless"\] \.wbar > \[data-wact="hud-home"\]/);
});

test('⌥P floats the Chats window on this desk whichever agent it belongs to; it never borrows another desk\'s agent window', () => {
  const src = js.slice(js.indexOf('function hudKey('), js.indexOf('function hudClose('));
  for (const kind of ['main', 'host-profile', 'container', 'restricted']) {
    const here = { id: 'h', app: 'chats', thread: 't-' + kind, ...(kind === 'main' ? {} : { agent: kind }) };
    const app = { id: 'a', app: 'frame', appId: 'files' }, away = { id: 'm', app: 'chats', thread: 'main-away' };
    const W = { h: here, a: app, m: away }, calls = [];
    const ctx = { W, ws: [{ wins: ['a', 'h'], focus: 'a' }, { wins: ['m'] }], cur: 0, homeOpen: false, hud: null,
      focused: () => W.a, mainChats: w => !!(w && w.app === 'chats' && !w.agent), findWin: fn => Object.values(W).find(fn) || null,
      newWin: () => { calls.push('new'); return { id: 'n' }; }, hudOn: id => { calls.push('on:' + id); return true; },
      hudDock: () => calls.push('dock'), hudFocus: () => calls.push('focus'), hudHasFocus: () => false };
    vm.runInNewContext(src + '\nhudKey();', ctx);
    assert.deepEqual(calls, ['on:h'], kind + ': floats the window on this desk, touching only its own thread');
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
