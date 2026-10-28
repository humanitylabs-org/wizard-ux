// Heads-up chat (HUD) on the desktop: a Chats window floats over every desk and Home and folds into the orb.
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

test('Esc in the HUD folds it into the orb before any other navigation; the orb shows work and new replies', () => {
  const esc = js.slice(js.indexOf('function escStep('), js.indexOf('function escStep(') + 4000);
  assert.ok(esc.indexOf('if (hudHasFocus()) { hudFold(true); return \'hud\'; }') > 0);
  assert.ok(esc.indexOf('hudHasFocus()') < esc.indexOf('if (homeOpen) return \'\';'));
  assert.match(js, /const mode = busy \? 'think' : fresh \? 'done' : 'idle';/);
});

test('the folded HUD is the shared orb (orb.js), loaded before the desktop shell', () => {
  assert.match(html, /<button id="hudOrb" class="hud-orb"[^>]*hidden><canvas id="orb" class="orb"/);
  assert.ok(html.indexOf('<script src="orb.js"></script>') > 0);
  assert.ok(html.indexOf('<script src="orb.js"></script>') < html.indexOf('<script src="desktop/desktop.js"></script>'));
});

test('keys, voice and chat actions follow the keyboard into the HUD; desk routes never reuse it (Codex P1/P2)', () => {
  assert.match(js, /const focused = \(\) => hudHasFocus\(\) \? W\[hud\.id\] : homeOpen \? null : W\[ws\[cur\]\.focus\] \|\| null;/);
  assert.match(js, /function closeWin\(id, internal = false\) \{\n\s*if \(hud\?\.id === id\) \{ hudClose\(\); return; \}/);
  assert.match(js, /function focusWin\(id, \{ scroll = true \} = \{\}\) \{\n\s*if \(hud\?\.id === id\) \{ if \(!hud\.open\) hudFold\(false\); else hudFocus\(\); return; \}/);
  assert.match(js, /return Object\.values\(W\)\.find\(w => w\.id !== hud\?\.id && fn\(w\)\) \|\| null;/);
  assert.match(js, /function toNewChat\(wid, why\) \{\n\s*const w = W\[wid\]; if \(hud\?\.id === wid \|\|/);
});

test('the heads-up chat is fully opaque and its orb sleeps unless folded (James: floating text panels are solid)', () => {
  const rule = css.match(/\.win\.hud \{[^}]*\}/)[0];
  assert.doesNotMatch(rule, /backdrop-filter/);
  assert.match(js, /if \(hudOrb\) hudOrb\.hidden = !hud \|\| hud\.open;\n\s*window\.Orb\?\.sleep\?\.\(!hud \|\| hud\.open\);/);
});

test('⌥P floats / folds / opens the heads-up chat and ⌥B puts it back on desktop 1, with their own buttons and guide chips', () => {
  assert.match(js, /if \(alt && !shift && code === 'KeyP'\) return hit\(\(\) => \{ if \(!e\.repeat\) \{ closePalette\(\{ restore: false \}\); hudKey\(\); \} \}\);/);
  assert.match(js, /if \(alt && !shift && code === 'KeyB'\) return hit\(\(\) => \{ if \(!e\.repeat && hud\) \{ closePalette\(\{ restore: false \}\); hudDock\(\{ to: 0 \}\); \} \}\);/);
  assert.match(js, /<button data-wact="hud-home" title="Back to desktop 1 \(\$\{MOD\}B\)"/);
  assert.match(js, /if \(act === 'hud-home'\) return hudDock\(\{ to: 0 \}\);/);
  const dock = js.slice(js.indexOf('function hudDock('), js.indexOf('function hudKey('));
  assert.match(dock, /const t = Number\.isInteger\(to\) && ws\[to\] \? to : cur;/);
  assert.match(dock, /if \(t !== cur\) \{ save\(\); render\(\); goWs\(t\); \}/);
  const key = js.slice(js.indexOf('function hudKey('), js.indexOf('function hudClose('));
  assert.match(key, /if \(!hud\.open\) return hudFold\(false\);\s*\n\s*if \(hudHasFocus\(\)\) return hudFold\(true\);/);
  assert.match(js, /\['P', 'Float chat', /);
  assert.match(js, /\['\[data-wact="hud-min"\]', 'P'\], \['\[data-wact="hud-home"\]', 'B'\]/);
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
      hudFold: () => calls.push('fold'), hudFocus: () => calls.push('focus'), hudHasFocus: () => false };
    vm.runInNewContext(src + '\nhudKey();', ctx);
    assert.deepEqual(calls, ['on:h'], kind + ': floats the window on this desk, touching only its own thread');
    assert.equal(W.m.thread, 'main-away'); assert.equal(W.h.thread, 't-' + kind);
  }
});
