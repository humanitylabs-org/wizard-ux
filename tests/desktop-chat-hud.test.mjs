// Heads-up chat (HUD) on the desktop: a Chats window floats over every desk and Home and puts it back on desktop 1 (no orb, no other options).
// The real HUD code (hudOn / hudDock / hudKey / hudClose, the window bar, the stage taps, the key) runs here over
// a small desk state; anything else it calls is recorded (wizard-ux issue 1674: tests run the code).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { block, runRecording } from './fixtures/source-slice.mjs';
import { desktopKeys } from './fixtures/desktop-keys-harness.mjs';
import { keysGuide } from './fixtures/keys-guide-harness.mjs';

const read = p => withShellParts(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const js = read('web/desktop/desktop.js'), html = read('web/desktop.html'), css = read('web/desktop/desktop.css');
const lineOf = k => { const i = js.indexOf(k); assert.ok(i >= 0, k); return js.slice(js.lastIndexOf('\n', i) + 1, js.indexOf('\n', i)); };

// desks: [[ids], ...]; W from ids ('c*' are Chats windows, others apps)
function hudShell({ desks = [['c1', 'a1']], cur = 0, homeOpen = false, hud = null, panelMode = false } = {}) {
  const ids = desks.flat().concat(hud ? [hud.id] : []);
  const W = Object.fromEntries(ids.map(id => [id, { id, app: id.startsWith('c') ? 'chats' : 'frame', thread: null }]));
  const ws = desks.map((wins, i) => ({ id: 'd' + i, wins: [...wins], focus: wins[0] || null, mono: false }));
  const store = new Map(), doc = createDocument();
  const fns = ['function hudOn(', 'function hudDock(', 'function hudKey(', 'function hudClose(', 'function barHtml('].map(m => block(js, m)).join('\n');
  const ctx = runRecording(`let W = this.W0, ws = this.ws0, cur = this.cur0, lastWs = 0, homeOpen = this.home0, hud = this.hud0;
${lineOf('const HUD_DEF = ')}
${fns}
const wsOf = id => ws.findIndex(d => d.wins.includes(id));
const freshDesk = () => ({ id: 'new', wins: [], focus: null, mono: false });
${block(js, 'function findWin(fn) {')}
const mainChats = w => w?.app === 'chats' && !w.agent;
const focused = () => (homeOpen ? null : W[ws[cur].focus] || null);
this.api = { hudOn, hudDock, hudKey, hudClose, barHtml, state: () => ({ W, ws, cur, hud, homeOpen }) };`,
  { W0: W, ws0: ws, cur0: cur, home0: homeOpen, hud0: hud, globalThis: { WosSkinHost: panelMode ? { panelMode: true } : undefined }, store: { get: (k, d) => store.get(k) ?? d, set: (k, v) => store.set(k, v) },
    window: { WosAgents: { titlebar: () => '<span class="t">Chats</span>' }, WosBoundView: { badge: () => '' } }, MOD: '⌥', DESK1_ICON: '1', HUD_ICON: '◉', document: doc, setTimeout: () => 0,
    appOf: () => ({}), reloadable: () => false, ico: () => '', esc: String, winTitle: w => w.id, newWin: w => { const id = 'c-new'; W[id] = { ...w, id }; return W[id]; } });
  return { ...ctx.api, calls: ctx.calls };
}
const acts = h => [...h.matchAll(/data-wact="([^"]+)"/g)].map(m => m[1]);

test('Chats windows get a float button beside ✕; other windows do not', () => {
  const s = hudShell();
  assert.ok(acts(s.barHtml({ id: 'c1', app: 'chats' })).includes('hud'), 'Chats: float');
  assert.ok(!acts(s.barHtml({ id: 'a1', app: 'frame' })).includes('hud'), 'other windows: none');
  // the stage taps: float, and ✕ on the floating chat closes it through the leave/custody-aware close
  const tap = (act, hudId, leave = true) => {
    const c = runRecording(`this.click = ${block(js, "  stage.addEventListener('click', e => {", js.indexOf('/* ---------------- window interactions')).replace(/^\s*stage\.addEventListener\('click', /, '')};`,
      { W: { c1: { id: 'c1', app: 'chats' } }, hud: hudId ? { id: hudId } : null, canLeave: () => leave, CHATS: { isHosted: () => false } });
    c.click({ target: { closest: q => (q === '.win' ? { dataset: { win: 'c1' } } : q === '[data-wact]' ? { dataset: { wact: act } } : null) }, stopPropagation() {} });
    return c.calls.map(x => x[0]).filter(n => /^(hudOn|hudClose|hudDock|desktopHost\.close|canLeave)$/.test(n));
  };
  assert.deepEqual(tap('hud'), ['hudOn']);
  assert.deepEqual(tap('close', 'c1'), ['hudClose']); assert.deepEqual(tap('close', 'c1', false), [], 'a chat that cannot be left stays');
  assert.deepEqual(tap('close', null), ['desktopHost.close']);
  const host = vm.runInNewContext(`({ ${lineOf('close: id => { closeWin(id); return !W[id]; }').trim().replace(/,$/, '')} })`, { W: { x: 1 }, closeWin: id => {} });
  assert.equal(host.close('x'), false);
  // Borderless frames hide title-bar buttons except ✕: the float button is re-shown next to it.
  const d = createDocument(); d.documentElement.setAttribute('data-skin-frame', 'borderless');
  d.body.innerHTML = '<div class="wbar"><button data-wact="hud"></button><button data-wact="hud-home"></button></div>';
  for (const b of d.querySelectorAll('[data-wact]')) assert.equal(cascade(b, css).display?.value, 'grid', b.getAttribute('data-wact'));
});

test('the HUD window lives outside the desks: never pruned at boot, never synced, never tiled', () => {
  // boot prune
  const W = { c1: {}, gone: {}, h: {} };
  vm.runInNewContext(lineOf('if (id !== hud?.id && !ws.some(d => d.wins.includes(id))) delete W[id];'), { W, hud: { id: 'h' }, ws: [{ wins: ['c1'] }], Object });
  assert.deepEqual(Object.keys(W), ['c1', 'h']);
  // save keeps it; sync reads desk windows only
  const saved = new Map();
  runRecording(`(${lineOf("const save = () => { store.set('wins', W);").trim().replace(/^const save = /, '').replace(/;$/, '')})()`, { store: { set: (k, v) => saved.set(k, v) }, W: {}, ws: [], cur: 0, hud: { id: 'h' }, feedBase: undefined, window: {} });
  assert.deepEqual(saved.get('hud'), { id: 'h' });
  const sync = vm.runInNewContext(`({ ${lineOf('read: () => ({ desks: ws.map(').trim().replace(/,$/, '')} })`, { ws: [{ id: 'd0', wins: ['c1'] }], W: { c1: { id: 'c1' }, h: { id: 'h' } } });
  assert.deepEqual(JSON.parse(JSON.stringify(sync.read())), { desks: [{ id: 'd0', wins: [{ id: 'c1' }] }] });
  // floated: it leaves its desk; put back: it goes back beside the window in front
  const s = hudShell({ desks: [['a1', 'c1', 'a2']] });
  assert.equal(s.hudOn('c1'), true);
  assert.deepEqual(s.state().ws[0].wins, ['a1', 'a2']); assert.equal(s.state().hud.id, 'c1');
  s.hudDock();
  assert.deepEqual(s.state().ws[0].wins, ['a1', 'c1', 'a2'], 'beside the window in front'); assert.equal(s.state().hud, null);
});

test('render keeps the HUD above every desk and Home; the open HUD counts as visible and keeps polling', () => {
  // the real render(): the HUD is mounted after every desk is drawn (its layer stays on top)
  const rd = createDocument(), stage = rd.createElement('div'), order = []; rd.body.appendChild(stage);
  const home = rd.createElement('div'); home.id = 'desktopHome'; rd.body.appendChild(home);
  const hosts = [0, 1].map(i => { const h = rd.createElement('div'); h.className = 'wsp'; h.dataset.desk = 'd' + i; stage.appendChild(h); return h; });
  const R = runRecording(`${block(js, '  function render() {')}\nthis.render = render;`, { W: { a1: { id: 'a1' }, a2: { id: 'a2' } }, ws: [{ id: 'd0', wins: ['a1'] }, { id: 'd1', wins: ['a2'] }], cur: 0, homeOpen: false,
    stage, document: rd, pal: { hidden: true }, window: {}, globalThis: {}, $: q => rd.querySelector(q), $$: (q, r = rd) => r.querySelectorAll(q), wsEl: i => hosts[i],
    mountWin: (w, to) => { order.push('mount:' + w.id); const el = rd.createElement('div'); el.className = 'win'; el.dataset.win = w.id; to.appendChild(el); return el; },
    hudMount: () => order.push('hud'), queueMicrotask: () => {} });
  R.render();
  assert.deepEqual(order, ['mount:a1', 'mount:a2', 'hud'], 'mounted after the desks');
  const visible = (homeOpen, hud) => vm.runInNewContext(`({ ${lineOf('visible: () => [...(homeOpen ? [] : ws[cur].wins)').trim().replace(/,$/, '')} }).visible()`, { homeOpen, hud, ws: [{ wins: ['a1'] }], cur: 0, globalThis: {}, shownBeside: () => [] });
  assert.equal(JSON.stringify(visible(false, { id: 'h', open: true })), '["a1","h"]'); assert.equal(JSON.stringify(visible(true, { id: 'h', open: true })), '["h"]', 'over Home too');
  assert.equal(JSON.stringify(visible(false, { id: 'h', open: false })), '["a1"]');
  let tick = null; const loaded = [];
  vm.runInNewContext(lineOf("setInterval(() => { if (document.hidden) return; for (const id of [...ws[cur].wins").trim(), { setInterval: f => { tick = f; }, document: { hidden: false }, ws: [{ wins: [] }], cur: 0, hud: { id: 'h', open: true }, W: { h: { app: 'chats', thread: 't1' } }, CHATS: { isHosted: () => false, loadThread: w => loaded.push(w.thread) } });
  tick(); assert.deepEqual(loaded, ['t1'], 'the open HUD keeps polling');
  const d = createDocument(); d.body.innerHTML = '<div class="hud-layer"></div>';
  const c = cascade(d.querySelector('.hud-layer'), css);
  assert.deepEqual(['position', 'inset', 'z-index', 'pointer-events'].map(k => c[k]?.value), ['absolute', '0', '150', 'none']);
});

test('two controls only: float over every desk, and back to desktop 1 (Miguel: no minimize, no orb, no put-back-here)', () => {
  assert.doesNotMatch(js, /hud-min|hud-dock|hudFold|hudOrb/);
  assert.doesNotMatch(html, /hudOrb|<script src="orb\.js">/);
  const s = hudShell({ hud: { id: 'c9', open: true } });
  assert.deepEqual(acts(s.barHtml({ id: 'c9', app: 'chats' })), ['hud-home', 'close']);
  const b = desktopKeys(); b.key('KeyB'); assert.ok(!b.names().some(n => /^hud/.test(n)), '⌥B never comes back as the floating chat');
});

test('keys, voice and chat actions follow the keyboard into the HUD; desk routes never reuse it (Codex P1/P2)', () => {
  // (with no desks — a layout holding the panel — the panel's one window is the one in front)
  const front = (hasFocus, extra = {}) => vm.runInNewContext(`(() => { ${lineOf('const focused = () => hudHasFocus()')}\n return focused(); })()`,
    { hudHasFocus: () => hasFocus, hud: { id: 'h' }, W: { h: { id: 'h' }, a1: { id: 'a1' } }, globalThis: {}, homeOpen: false, ws: [{ focus: 'a1' }], cur: 0, panelWin: () => null, ...extra });
  assert.equal(front(true).id, 'h'); assert.equal(front(false).id, 'a1'); assert.equal(front(false, { homeOpen: true }), null);
  const run = (marker, id) => { const c = runRecording(`${block(js, marker)}\nthis.f = ${/function (\w+)/.exec(marker)[1]};`, { hud: { id: 'h' }, canLeave: () => true, globalThis: {} }); c.f(id); return c.calls.map(x => x[0]); };
  assert.deepEqual(run('function closeWin(id, internal = false) {', 'h'), ['hudClose']);
  assert.deepEqual(run('function focusWin(id, { scroll = true } = {}) {', 'h'), ['hudFocus']);
  const find = runRecording(`${block(js, 'function findWin(fn) {')}\nthis.findWin = findWin;`, { W: { h: { id: 'h', app: 'chats' }, c2: { id: 'c2', app: 'chats' } }, hud: { id: 'h' }, ws: [{ wins: [] }], cur: 0, globalThis: {}, Object }).findWin;
  assert.equal(find(w => w.app === 'chats').id, 'c2', 'the heads-up chat is never reused as a desk window');
  assert.doesNotMatch(js, /function toNewChat/);
});

test('⌥P floats the chat over every desk and, floating, puts it back on desktop 1; the 1 button does the same', () => {
  const k = desktopKeys(); k.key('KeyP'); assert.deepEqual(k.names().slice(-2), ['closePalette', 'hudKey']);
  const held = desktopKeys(); held.key('KeyP', { repeat: true }); assert.ok(!held.names().includes('hudKey'));
  // ⌥P: the Chats window on this desk floats
  const s = hudShell({ desks: [['c1', 'a1'], ['a2']], cur: 1 });
  s.state().ws[1].focus = 'a2';
  assert.equal(s.hudKey(), true); assert.equal(s.state().hud.id, 'c1', 'none on this desk: the main Chats floats');
  // floating, ⌥P puts it back on desktop 1, which it gets to itself
  s.hudKey();
  assert.deepEqual(JSON.parse(JSON.stringify(s.state().ws.map(d => d.wins))), [['c1'], ['a1'], ['a2']], 'desktop 1 to itself; the rest move one desk right');
  assert.ok(s.calls.some(c => c[0] === 'goWs' && c[1] === 0));
  // the window bar's 1 button does the same
  const b = hudShell({ hud: { id: 'c9', open: true } });
  assert.match(b.barHtml({ id: 'c9', app: 'chats' }), /<button data-wact="hud-home" title="Back to desktop 1 \(⌥P\)"/);
  const c = runRecording(`this.click = ${block(js, "  stage.addEventListener('click', e => {", js.indexOf('/* ---------------- window interactions')).replace(/^\s*stage\.addEventListener\('click', /, '')};`, { W: {}, CHATS: { isHosted: () => false } });
  c.click({ target: { closest: q => (q === '.win' ? { dataset: { win: 'c9' } } : q === '[data-wact]' ? { dataset: { wact: 'hud-home' } } : null) }, stopPropagation() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(c.calls.filter(x => x[0] === 'hudDock').map(x => x[1]))), [{ to: 0 }]);
  // the guide names it
  const f = { id: 'c1', app: 'chats', thread: null }, g = keysGuide({ focused: () => f, ws: [{ id: 'd1', wins: ['c1'] }], W: { c1: f } });
  const win = g.add('<div class="win"><div class="wbar"><button data-wact="hud"></button></div></div>'); g.ctx.winEl = () => win;
  g.show(false); assert.deepEqual(g.on('P', '[data-wact="hud"]').map(x => x.label), ['⌥ P: Float chat']);
});

test('the heads-up chat is fully opaque (James: floating text panels are solid)', () => {
  const rule = css.match(/\.win\.hud \{[^}]*\}/)[0];
  assert.doesNotMatch(rule, /backdrop-filter/);
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
  // the real desktop escStep: while the floating chat answers Back, Home, a full-screen desk or the app behind never do
  const step = (hb, env) => { const calls = []; const ctx = runRecording(`${block(js, '  function escStep() {')}\nthis.step = escStep;`, { hudBack: () => hb, globalThis: {}, ...env }, calls); return { out: ctx.step(), calls }; };
  for (const env of [{ homeOpen: true }, { homeOpen: false, ws: [{ mono: true, wins: ['a'] }], cur: 0, focused: () => ({ id: 'a', app: 'frame' }) }]) {
    const r = step('hud-thread', env);
    assert.equal(r.out, 'hud-thread', 'the floating chat walks back first');
    assert.deepEqual(r.calls.filter(c => /back|close|exit/i.test(String(c[0]))), [], 'nothing behind it moves');
  }
  assert.equal(step(null, { homeOpen: true }).out, '', 'no floating chat: Home keeps Esc as before');
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
