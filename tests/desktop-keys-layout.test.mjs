import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withDesktopParts } from './fixtures/desktop-parts.mjs';
import { desktopKeys } from './fixtures/desktop-keys-harness.mjs';
import { keysGuide } from './fixtures/keys-guide-harness.mjs';
import { between, block, runRecording } from './fixtures/source-slice.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';

// the real skins.js in a bare page (its twin table)
function shippedSkinsHost() {
  const el = () => ({ style: { setProperty() {}, removeProperty() {} }, setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, appendChild() {}, remove() {}, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, dataset: {} });
  const document = { documentElement: el(), head: el(), body: el(), createElement: el, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {} };
  const ctx = { document, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, addEventListener() {}, dispatchEvent() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    CustomEvent: class {}, Event: class {}, location: { search: '' }, URLSearchParams, setTimeout, clearTimeout, requestAnimationFrame: () => 0, console };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(readFileSync(new URL('../web/core/skins.js', import.meta.url), 'utf8'), ctx);
  return ctx;
}

const js = withDesktopParts(readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8'));
const html = readFileSync(new URL('../web/desktop.html', import.meta.url), 'utf8');

// The real key handler and the real keys guide run here (tests/fixtures/desktop-keys-harness.mjs and
// keys-guide-harness.mjs; wizard-ux issue 1674: tests run the code).
const fn = (marker, ctx = {}, name = /function (\w+)/.exec(marker)?.[1]) => runRecording(`${block(js, marker)}\nthis.${name} = ${name};`, ctx);
const lineOf = k => { const i = js.indexOf(k); assert.ok(i >= 0, k); return js.slice(js.lastIndexOf('\n', i) + 1, js.indexOf('\n', i)); };

test('holding ⌥ is the one keys guide: speak keys named and explained, no separate sheet', () => {
  assert.doesNotMatch(js, /const KEYS = \[/);
  const g = keysGuide();
  for (const [sel, key, name] of [['#micBtn', 'S', 'Talk about this'], ['#commandBtn', 'C', 'Tell the computer'], ['#dictateBtn', 'D', 'Type with your voice']])
    assert.deepEqual(g.show(false).filter(c => c.on?.matches(sel)).map(c => c.label), [`⌥ ${key}: ${name}`], sel);
  // ⌥/ (toggleKeys) pins that same guide; Escape (its watchEscape entry) closes it and returns to Settings
  const t = fn('function toggleKeys(on) {', { keyHints: g.keyHints, window: {} });
  t.toggleKeys(true);
  const el = g.document.querySelector('#keyHints');
  assert.equal(g.keyHints.pinned(), true); assert.equal(el.hidden, false); assert.ok(el.classList.contains('pinned'));
  let esc = null; const back = [];
  vm.runInNewContext(lineOf("watchEscape('keys', () => keyHints.pinned()"), { watchEscape: (...a) => { esc = a; }, keyHints: g.keyHints, toggleKeys: t.toggleKeys, returnToSettings: () => back.push('settings') });
  assert.equal(esc[0], 'keys'); assert.equal(esc[1](), true);
  esc[2](); assert.equal(g.keyHints.pinned(), false); assert.equal(el.hidden, true); assert.deepEqual(back, ['settings']);
});

test('⌥S speaks about the screen, ⌥C speaks a command, ⌥D dictates', () => {
  for (const [code, does] of [['KeyS', 'speakScreen'], ['KeyC', 'commandVoice'], ['KeyD', 'dictate']]) {
    const k = desktopKeys(), e = k.key(code);
    assert.ok(e.defaultPrevented, code); assert.equal(k.names().at(-1), does, code);
  }
  const page = keysGuide().document;
  for (const [id, key] of [['micBtn', 'Alt+S'], ['commandBtn', 'Alt+C'], ['dictateBtn', 'Alt+D']]) assert.equal(page.getElementById(id).getAttribute('aria-keyshortcuts'), key, id);
});

test('holding left ⌥ alone shows key hints; any other key or release hides them', () => {
  const timers = [], g = keysGuide({ setTimeout: (f, ms) => { timers.push([f, ms]); return timers.length; } }), el = g.document.querySelector('#keyHints');
  const ev = (code, x = {}) => ({ code, key: /^Alt/.test(code) ? 'Alt' : code, altKey: true, preventDefault() { this.prevented = true; }, ...x });
  g.keyHints.down(ev('AltLeft'));
  assert.equal(timers.at(-1)[1], 300); timers.at(-1)[0](); assert.equal(el.hidden, false, 'held: the hints show');
  g.keyHints.down(ev('KeyA')); assert.equal(el.hidden, true, 'another key hides them');
  g.keyHints.down(ev('AltLeft')); timers.at(-1)[0](); const up = ev('AltLeft'); g.keyHints.up(up);
  assert.equal(el.hidden, true); assert.ok(up.prevented, 'release hides them');
  const n = timers.length;
  for (const x of [ev('AltRight'), ev('AltLeft', { repeat: true }), ev('AltLeft', { shiftKey: true }), ev('AltLeft', { metaKey: true })]) g.keyHints.down(x);
  assert.equal(timers.length, n, 'only the left ⌥, alone and not repeating');
  // the page and every app frame hand their keyup to the guide (and the layout)
  for (const line of ["  addEventListener('keyup', e => { keyHints.up(e); window.WosSkinHost?.keyUp?.(e); }, true);", "frameWindow.addEventListener('keyup', e => { keyHints.up(e); window.WosSkinHost?.keyUp?.(e); }, true);"]) {
    const on = {}, ups = [], target = { addEventListener: (t, f, c) => { on[t] = [f, c]; } };
    vm.runInNewContext(lineOf(line).trim(), { addEventListener: target.addEventListener, frameWindow: target, keyHints: { up: e => ups.push(e) }, window: { WosSkinHost: { keyUp: e => ups.push('layout') } } });
    assert.equal(on.keyup[1], true, 'capture'); on.keyup[0]('e'); assert.deepEqual(ups, ['e', 'layout']);
  }
});

test('⌥S only sends its own kind of take', () => {
  const run = (state, extra = {}) => { const c = fn('function speakScreen() {', { VOICE: { state }, vMode: 'talk', vNewChat: false, commandTake: false, ...extra }); c.speakScreen(); return c.calls.map(x => x.join(':')); };
  assert.deepEqual(run('idle'), ['talk']);
  assert.deepEqual(run('listen'), ['talk:send'], 'its own take: sent');
  assert.deepEqual(run('paused'), ['talk:send']);
  for (const x of [{ vNewChat: true }, { commandTake: true }, { vMode: 'dictate' }]) assert.match(run('listen', x)[0], /^toast/, JSON.stringify(x));
});

test('⌥↓/⌥↑ walk Ready chats from anywhere into the message box; no ⌥←/⌥→ list hop', () => {
  for (const [code, dir] of [['ArrowDown', 1], ['ArrowUp', -1]]) { const k = desktopKeys(); k.key(code); assert.deepEqual(k.calls.at(-1), ['chatsUpDown', dir], code); }
  for (const code of ['ArrowLeft', 'ArrowRight']) { const k = desktopKeys(); const e = k.key(code); assert.deepEqual(k.calls, [], `${code}: the field's word jump`); assert.ok(!e.defaultPrevented); }
  assert.deepEqual(fn('function chatsUpDown(dir) {', {}).chatsUpDown(1), undefined);
  const up = fn('function chatsUpDown(dir) {', { stepReady: d => `step:${d}` }); assert.equal(up.chatsUpDown(-1), 'step:-1');
  // the Ready rows it walks: only the Ready section's openable rows
  const g = keysGuide(); const win = g.add('<div class="win"><div class="pane-list"><div class="ch-sec" data-sec="ready"><div class="ch-row" data-chopen="r1"></div><div class="ch-row" data-chopen="r2"></div><div class="ch-row"></div></div><div class="ch-sec" data-sec="working"><div class="ch-row" data-chopen="w1"></div></div></div></div>');
  const rows = runRecording(`${block(js, '  const readyRows = id => {')}\nthis.readyRows = readyRows;`, { winEl: () => win, document: g.document, $$: (q, r) => r.querySelectorAll(q), byTop: () => 0, CSS: { escape: String } }).readyRows('c1');
  assert.deepEqual([...rows].map(r => r.dataset.chopen), ['r1', 'r2']);
  // the guide: ↓ on the next Ready chat, named
  const c = { id: 'c1', app: 'chats', thread: 'r1' };
  const g2 = keysGuide({ focused: () => c, ws: [{ id: 'd1', wins: ['c1'] }], W: { c1: c }, rect: el => (el.classList.contains('pane-list') ? { top: 0, bottom: 900, height: 900 } : null) });
  const w2 = g2.add('<div class="win"><div class="pane-list"><div class="ch-sec" data-sec="ready"><div class="ch-row" data-chopen="r1"></div><div class="ch-row" data-chopen="r2"></div></div></div></div>');
  g2.ctx.winEl = () => w2; g2.ctx.readyRows = () => w2.querySelectorAll('.ch-row');
  const down = g2.show(false).filter(x => x.key === '↓');
  assert.deepEqual(down.map(x => [x.on.dataset.chopen, x.label]), [['r2', '⌥ ↓: Next ready chat']]);
});

test('plain ⌥←/⌥→ never act on a chat; standard ⌥Z stays Back and no hidden ⌥E is added', () => {
  for (const code of ['KeyE', 'ArrowLeft', 'ArrowRight']) { const k = desktopKeys({ focused: () => ({ id: 'c1', app: 'chats', thread: 't1' }) }); k.key(code); assert.ok(!k.names().some(n => /threadAct/.test(n)), code); }
  const z = desktopKeys({ focused: () => ({ id: 'c1', app: 'chats', thread: 't1' }) }); z.key('KeyZ');
  assert.deepEqual(z.names(), ['jumpBack'], '⌥Z is Back to where you were, never Snooze');
  const held = desktopKeys(); held.key('KeyZ', { repeat: true }); assert.deepEqual(held.calls, [], 'once per press');
  // ⌥X Resolve goes to the open chat's own action
  const c = { id: 'c1', app: 'chats', thread: 't1' };
  const x = desktopKeys({ focused: () => c, winEl: () => ({ querySelector: q => (q === '[data-chact="resolve"]' ? {} : null) }) }); x.key('KeyX');
  assert.deepEqual(x.calls.filter(k => k[0] === 'CHATS.threadAct'), [['CHATS.threadAct', 'c1', 't1', 'resolve']]);
  assert.doesNotMatch(js, /\['\[data-chact="(?:done|snooze)"\]', '[←→]'/);
});

test('desktop replies never schedule a new chat after sending', () => {
  assert.doesNotMatch(js, /toNewChat|keepNewSendList|send:new-chat/);
});
test('desktop recordings skip echo cancellation (no music ducking) and pick a wired mic explicitly', async () => {
  const { readFileSync: r } = await import('node:fs');
  const v = r(new URL('../web/core/voice.js', import.meta.url), 'utf8');
  assert.match(v, /: \{ echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: \{ ideal: 1 \} \};/);
  assert.match(v, /if \(wired\) return wired\.deviceId/);
});

test('Home is ⌥` (again goes back); desktops are ⌥1…9 from the first desk', async () => {
  const { readFileSync: r } = await import('node:fs');
  const nav = r(new URL('../web/core/workspace-navigation.js', import.meta.url), 'utf8');
  const C = {}; new Function('window', nav)({ WizCore: C });
  assert.deepEqual(C.workspaceNav.digitTarget(1, 3), { kind: 'desktop', index: 0 });
  assert.deepEqual(C.workspaceNav.digitTarget(4, 3), { kind: 'new', index: 3 });
  assert.equal(C.workspaceNav.digitTarget(5, 3), null);
  assert.equal(C.workspaceNav.slot(0), 1);
  // ⌥` (the real onKey): Home, again goes back; held down it does not flicker
  const away = desktopKeys(); away.key('Backquote'); away.key('Backquote', { repeat: true }); assert.deepEqual(away.names(), ['goHome']);
  const home = desktopKeys({ homeOpen: true }); home.key('Backquote'); assert.deepEqual(home.names(), ['leaveHome']);
  assert.doesNotMatch(js, /code === 'Digit1'\) return hit/);
  // the guide names it on the logo (its chip's label); ⌥1…9 is the digitTarget above
  assert.deepEqual(keysGuide().show(false).filter(c => c.key === '`').map(c => c.label), ['⌥ `: Home']);
});

test('⌥G Pick anything: letter chips on every clickable, typed letters click it, guide lists it', () => {
  { const started = [], k = desktopKeys({ pick: { active: () => false, start: () => started.push(1) } });
    k.key('KeyG'); k.key('KeyG', { repeat: true }); assert.equal(started.length, 1, '⌥G starts Pick once, held or not'); }
  // Pick owns ordinary keys; Escape is dispatched once by core (repeat/IME inert).
  const start = js.indexOf('  function onKey(e, fromFrame = false)');
  const head = js.slice(start, js.indexOf('    keyHints.down(e);', start));
  const context = { pick: { active: () => true, key: () => 'picked' }, window: {}, desktopBack:()=>{context.escaped++;return 'pick';}, escaped:0, log(){} };
  vm.createContext(context); vm.runInContext(head + ' return "shell"; }', context);
  for (const flags of [{}, {repeat:true}, {isComposing:true}, {keyCode:229}]) {
    const n=context.escaped; context.onKey({key:'Escape',target:{matches:()=>false},...flags});
    assert.equal(context.escaped,n+(Object.keys(flags).length ? 0 : 1));
    assert.equal(context.onKey({key:'g',target:{matches:()=>true},...flags}), 'picked');
  }
  // the real pick on a small page: chat rows (also one inside a button) and a same-origin app frame's buttons get
  // letters; typing one clicks it. The guide's legend lists G (the keys guide test below reads its kbd list).
  const p = pickPage();
  assert.equal(p.pick.start(), true);
  assert.deepEqual(p.chips(), ['A', 'S', 'D', 'F', 'J'], 'b1, the chat row, the button, the row inside it, the frame\'s button');
  for (const [code, id] of [['KeyS', 'row'], ['KeyF', 'inner'], ['KeyJ', 'fbtn']]) { p.pick.start(); p.pick.key({ code, key: code.slice(3).toLowerCase(), preventDefault() {}, stopPropagation() {} }); assert.equal(p.clicked.at(-1), id, code); }
});

// desktop-pickany.js's pick (⌥G), run on mini-dom: one row per element (y = its order), an iframe holding a page.
function pickPage() {
  const doc = createDocument(), inner = createDocument(), clicked = [];
  doc.body.innerHTML = '<button id="b1">One</button><div data-chopen="s1" id="row"><span>Chat</span></div><button id="outer"><span data-chopen="s2" id="inner">x</span></button><iframe id="f"></iframe>';
  inner.body.innerHTML = '<button id="fbtn">In the app</button>';
  const view = { getComputedStyle: () => ({ visibility: 'visible', opacity: '1', pointerEvents: 'auto' }) };
  let y = 0;
  for (const d of [doc, inner]) { d.defaultView = view; d.elementFromPoint = () => null;
    for (const n of d.querySelectorAll('*')) { const top = (y += 30); n.getBoundingClientRect = () => ({ left: 10, top, right: 110, bottom: top + 20, width: 100, height: 20 }); n.addEventListener('click', e => { if (e.target === n) clicked.push(n.id); }); } }
  const f = doc.querySelector('#f'); f.contentDocument = inner; f.clientLeft = 0; f.clientTop = 0;
  const box = f.getBoundingClientRect; f.getBoundingClientRect = () => ({ ...box(), top: 0, bottom: 2000, height: 2000 });
  const ctx = runRecording(`${block(js, '  const pick = (() => {')})();\nthis.pick = pick;`, { document: doc, innerWidth: 1000, innerHeight: 4000, addEventListener() {}, log() {}, toast() {} });
  return { pick: ctx.pick, clicked, chips: () => doc.querySelectorAll('#pickHints .pick-chip').map(c => c.textContent) };
}

test('the keys guide is chips in place, no boxes: ↓ on the next Ready chat, F W R on window buttons, no H J K L (retired for ⌥L light), words only on Speak', () => {
  const f = { id: 'a1', app: 'frame' }, g = keysGuide({ focused: () => f, ws: [{ id: 'd1', wins: ['a1'] }], W: { a1: f } });
  const win = g.add('<div class="win"><div class="wbar"><span class="t">Maps</span><button data-wact="mono"></button><button data-wact="close"></button><button data-wact="reload"></button></div><div class="wbody"></div></div>');
  g.ctx.winEl = () => win;
  const chips = g.show(false);
  for (const [act, key] of [['mono', 'F'], ['close', 'W'], ['reload', 'R']]) assert.deepEqual(g.on(key, `[data-wact="${act}"]`).length, 1, `${key} on its button`);
  assert.equal(chips.filter(c => /^[HJKL]$/.test(c.key)).length, 0, 'no H J K L');
  assert.equal(g.document.querySelectorAll('#keyHints .kh-card').length, 0, 'chips, no boxes');
  const leg = g.document.querySelector('#keyHints .kh-legend');
  assert.deepEqual(leg.querySelectorAll('kbd').map(k => k.textContent), ['G', 'S', 'C', 'D'], 'words only in the Speak legend (and Pick anything)');
  assert.match(leg.textContent, /STalk about this/);
});

test('guide: Resolve stays above its button; no removed action arrows or "/" chip on chat search', () => {
  const c = { id: 'c1', app: 'chats', thread: 't1' }, g = keysGuide({ focused: () => c, ws: [{ id: 'd1', wins: ['c1'] }], W: { c1: c } });
  const win = g.add('<div class="win"><div class="pane-list"><input data-chsearch></div><div class="pane-main"><div class="ch-head"></div><button data-chact="resolve"></button><button data-chact="done"></button></div></div>');
  g.ctx.winEl = () => win;
  g.show(false);
  const [x] = g.on('X', '[data-chact="resolve"]'), chip = g.document.querySelectorAll('#keyHints .kh-chip').find(n => n.target === x.on);
  assert.ok(parseInt(chip.style.top) < 100, 'above its button (box top 100px)');
  assert.deepEqual(g.on('/', '[data-chsearch]'), [], 'no "/" on chat search');
  assert.equal(g.on('I', '[data-chsearch]').length, 1, 'I sits there instead');
  assert.equal(g.chips().filter(k => /^[←→]$/.test(k.key)).length, 0, 'no removed action arrows');
});

test('guide extras: ↓ on Home, [ ] on neighbour desks, ↑ on the previous Ready chat, I on chat search; ⌥I again searches chats', () => {
  const desks = [0, 1, 2].map(i => `<button class="ws" data-ws="${i}"></button>`).join('');
  // Home: ↓ on the Ready count; ] on desktop 1
  const h = keysGuide({ homeOpen: true, ws: [{ id: 'd1', wins: [] }, { id: 'd2', wins: [] }] });
  h.document.querySelector('#wsList').innerHTML = desks; h.patch(h.document.querySelector('#wsList'));
  h.document.querySelector('#desktopHome').innerHTML = '<div data-home-act="ready"></div>'; h.patch(h.document.querySelector('#desktopHome'));
  h.show(false);
  assert.equal(h.on('↓', '[data-home-act="ready"]').length, 1, 'Home: ↓ on the Ready count');
  assert.equal(h.on(']', '.ws[data-ws="0"]').length, 1, 'Home: ] on desktop 1');
  // desktop 2 of 3, a chat open on the second of three Ready rows: [ ] the neighbour desks, ↑ the previous row, I on search
  const c = { id: 'c1', app: 'chats', thread: 'r2' };
  const g = keysGuide({ cur: 1, focused: () => c, ws: [{ id: 'd1', wins: [] }, { id: 'd2', wins: ['c1'] }, { id: 'd3', wins: [] }], W: { c1: c }, rect: el => (el.classList.contains('pane-list') ? { top: 0, bottom: 900 } : null) });
  g.document.querySelector('#wsList').innerHTML = desks; g.patch(g.document.querySelector('#wsList'));
  const win = g.add('<div class="win"><div class="pane-list"><input data-chsearch><div class="ch-row" data-chopen="r1"></div><div class="ch-row" data-chopen="r2"></div><div class="ch-row" data-chopen="r3"></div></div></div>');
  g.ctx.winEl = () => win; g.ctx.readyRows = () => win.querySelectorAll('.ch-row');
  g.show(false);
  assert.equal(g.on('[', '.ws[data-ws="0"]').length, 1); assert.equal(g.on(']', '.ws[data-ws="2"]').length, 1);
  assert.deepEqual(g.on('↑').map(k => k.on.dataset.chopen), ['r1']); assert.deepEqual(g.on('↓').map(k => k.on.dataset.chopen), ['r3']);
  assert.equal(g.on('I', '[data-chsearch]').length, 1);
  // recording: Esc on the pill's cancel
  const v = keysGuide({ VOICE: { state: 'listen' } });
  for (const id of ['voiceSend', 'voiceCancel']) v.add(`<button id="${id}"></button>`);
  v.show(false); assert.equal(v.on('Esc', '#voiceCancel').length, 1);
  // ⌥I with the list in front searches chats; otherwise it opens the list
  const field = { focus() { this.focused = true; }, select() {}, getClientRects: () => [1] };
  const k = desktopKeys({ focused: () => ({ id: 'c1', app: 'chats', thread: null }), winEl: () => ({ querySelector: q => (q === '[data-chsearch]' ? field : null) }), vis0: () => true });
  k.key('KeyI'); assert.ok(field.focused); assert.ok(!k.names().includes('openChatsList'));
  const k2 = desktopKeys({ focused: () => ({ id: 'c1', app: 'chats', thread: 't1' }) }); k2.key('KeyI'); assert.equal(k2.names().at(-1), 'openChatsList');
});

test('⌥[ ⌥] never wrap: left of desktop 1 is Home, nothing left of Home or right of the last desk; Speak words sit in the bar', () => {
  const step = (cur, dir, homeOpen = false) => { const c = fn('function stepDesk(', { homeOpen, cur, ws: [{}, {}, {}], globalThis: {} }); c.stepDesk(dir); return c.calls.map(x => x.join(':')); };
  assert.deepEqual(step(0, -1), ['goHome'], 'left of desktop 1 is Home');
  assert.deepEqual(step(2, 1), [], 'nothing right of the last desk');
  assert.deepEqual(step(1, -1), ['goWs:0']); assert.deepEqual(step(1, 1), ['goWs:2']);
  assert.deepEqual(step(0, -1, true), [], 'nothing left of Home');
  for (const [code, dir] of [['BracketLeft', -1], ['BracketRight', 1]]) { const k = desktopKeys(); k.key(code); assert.deepEqual(k.calls.at(-1), ['stepWin', dir], code); }
  const w = fn('function stepWin(dir) {', { homeOpen: false, cur: 0, ws: [{ wins: [] }], globalThis: {}, nextStop: () => null }); w.stepWin(-1);
  assert.deepEqual(w.calls[0], ['stepDesk', -1], 'past the last window, on to the next desk');
  // the Speak legend sits in the bar when there is room
  const g = keysGuide({ rect: el => (el.id === 'bar' ? { top: 0, height: 40, bottom: 40 } : el.id === 'wsList' ? { right: 300 } : el.id === 'searchBtn' ? { left: 1200, right: 1240 } : null) });
  g.show(false); assert.ok(g.document.querySelector('#keyHints .kh-legend').classList.contains('in-bar'));
});

test('[ ] chips are their own second-row chips, never merged into the neighbour key', () => {
  const g = keysGuide({ cur: 0, ws: [{ id: 'd1', wins: [] }, { id: 'd2', wins: [] }] });
  g.document.querySelector('#wsList').innerHTML = '<button class="ws" data-ws="0"></button><button class="ws" data-ws="1"></button>'; g.patch(g.document.querySelector('#wsList'));
  g.show(false);
  assert.deepEqual(g.chips().filter(c => c.on?.matches('.ws[data-ws="1"]')).map(c => c.key), ['2', ']'], 'its own ] chip under the 2');
  const two = g.document.querySelectorAll('#keyHints .kh-chip').filter(n => n.target?.matches?.('.ws[data-ws="1"]'));
  assert.ok(parseInt(two[1].style.top) > parseInt(two[0].style.top), 'on a second row');
  assert.deepEqual(g.on('[').map(c => c.on.id), ['logo'], '[ on Home');
});

test('⌥] / ⌥[ walk this desk\'s windows left to right (Chats: list, then message box), then step to the next desk', async () => {
  const vm = await import('node:vm');
  const start = js.indexOf('  function chatsZone(f) {'), end = js.indexOf('  function goWs(i');
  const src = js.slice(start, end);
  // Three desks: [Files | Chats with a chat open], [Notes], [Music | Mail].
  const mk = (id, left, extra = {}) => ({ id, left, ...extra });
  const W = { a: { id: 'a', app: 'frame' }, c: { id: 'c', app: 'chats', thread: 't1' }, n: { id: 'n', app: 'frame' }, m: { id: 'm', app: 'frame' }, x: { id: 'x', app: 'frame' } };
  const pos = { a: 0, c: 600, n: 0, m: 0, x: 600 };
  const ws = [{ wins: ['c', 'a'], focus: 'a' }, { wins: ['n'], focus: 'n' }, { wins: ['x', 'm'], focus: 'x' }];
  const st = { cur: 0, home: false, active: null, log: [] };
  const node = (kind, win) => ({ kind, win, getClientRects: () => [1], closest: q => (q === '.pane-list' && kind === 'list') || (q === '.pane-main' && kind === 'thread') ? {} : null, focus() { st.active = this; }, scrollIntoView() {}, classList: { add() {}, remove() {} } });
  const els = {};
  for (const id of Object.keys(W)) {
    const list = node('list', id), ta = node('thread', id), row = node('list', id);
    els[id] = { id, list, ta, row, classList: { contains: () => false }, getBoundingClientRect: () => ({ left: pos[id], width: 500, top: 0, height: 400 }),
      contains: n => !!n && n.win === id, focus() { st.active = { win: id, kind: 'win', closest: () => null }; },
      querySelector: q => W[id].app !== 'chats' ? null : q === '.pane-list' ? list : q === '.pane-main textarea' ? ta : q.startsWith('.pane-list .ch-row') ? row : null };
  }
  const ctx = {
    W, ws, CSS: { escape: s => s }, getComputedStyle: () => ({ visibility: 'visible' }),
    winEl: id => els[id], $$: () => [], listRows: id => [els[id].row], log: s => st.log.push(s),
    get document() { return { get activeElement() { return st.active; } }; },
    focused: () => W[ws[st.cur].focus], focusWin: id => { ws[st.cur].focus = id; },
    focusInside: id => { const w = W[id]; st.active = w.app === 'chats' && w.thread ? els[id].ta : { win: id, kind: 'win', closest: () => null }; },
  };
  vm.createContext(ctx);
  vm.runInContext(`var cur = 0, homeOpen = false, lastWs = 0;
    function goHome() { homeOpen = true; } function leaveHome() { homeOpen = false; }
    function goWs(i) { homeOpen = false; cur = i; }
    function stepDesk(dir) {
      if (homeOpen) { if (dir > 0 && ws.length) { lastWs = cur; goWs(0); if (cur === 0 && homeOpen) leaveHome(); } return; }
      if (dir < 0 && cur === 0) { lastWs = cur; goHome(); return; }
      const t = cur + dir; if (t < 0 || t >= ws.length) return;
      lastWs = cur; goWs(t);
    }
    ${src}
    this.api = { stepWin, nextStop, get cur() { return cur; }, get home() { return homeOpen; } };`, ctx);
  const api = ctx.api;
  const where = () => { const a = st.active; return `${api.cur}:${ws[api.cur].focus}:${a?.kind || ''}`; };
  // Make the reads of cur in focused() follow the shell's.
  Object.defineProperty(st, 'cur', { get: () => api.cur });
  ctx.focusInside('a');
  assert.equal(where(), '0:a:win');
  api.stepWin(1); assert.equal(where(), '0:c:list', '] from the left window lands on the Chats list side');
  api.stepWin(1); assert.equal(where(), '0:c:thread', '] again: the message box');
  api.stepWin(1); assert.equal(where(), '1:n:win', '] past the last stop: the next desk');
  api.stepWin(1); assert.equal(where(), '2:m:win', 'single-window desk: ] changes desk; lands on the leftmost window');
  api.stepWin(1); assert.equal(where(), '2:x:win');
  api.stepWin(1); assert.equal(where(), '2:x:win', 'nothing right of the last window on the last desk');
  api.stepWin(-1); assert.equal(where(), '2:m:win');
  api.stepWin(-1); assert.equal(where(), '1:n:win');
  api.stepWin(-1); assert.equal(where(), '0:c:thread', '[ onto a desk lands on its rightmost stop');
  api.stepWin(-1); assert.equal(where(), '0:c:list');
  api.stepWin(-1); assert.equal(where(), '0:a:win');
  api.stepWin(-1); assert.ok(api.home, '[ past the first window of desktop 1 goes Home');
});

test('⌥N opens a New chat on this desk beside the app in front, and holding ⌥ shows it there', () => {
  const k = desktopKeys(); k.key('KeyN');
  assert.deepEqual(k.calls.slice(-2), [['chanPost'], ['newChat']], 'a channel post first, else a plain New chat (no fresh copy)');
  // guide: no Chats on this desk: N with its word on the app in front
  const f = { id: 'a1', app: 'frame' }, g = keysGuide({ focused: () => f, ws: [{ id: 'd1', wins: ['a1'] }], W: { a1: f } });
  const win = g.add('<div class="win"><div class="wbody"></div></div>'); g.ctx.winEl = () => win;
  g.show(false);
  assert.deepEqual(g.on('N', '.wbody').map(c => c.word), ['New chat']);
  // a view that puts N on its own New chat button: N shows once, there
  g.ctx.window.WosSkinHost = { keyChips: () => [{ key: 'N', el: g.document.querySelector('#logo') }] };
  g.show(false); assert.deepEqual(g.on('N').map(c => c.on.id), ['logo']);
});

test('Omarchy-style keys: ⌥− / ⌥= resize, ⌥⇧W reopens, ⌥Z jumps back, each shown where it acts', () => {
  for (const [code, x, does] of [['Minus', {}, ['resizeFocused', -1]], ['Equal', {}, ['resizeFocused', 1]], ['KeyW', { shiftKey: true }, ['reopenClosed']], ['KeyZ', {}, ['jumpBack']], ['KeyW', {}, ['closeCurrent']]]) {
    const k = desktopKeys(); k.key(code, x); assert.deepEqual(k.calls.at(-1), does, code + JSON.stringify(x));
  }
  // the apps picker lets the window keys through, stepping aside first
  const p = desktopKeys({ pal: { hidden: false }, palMode: 'apps', settingsFocused: () => false }); p.key('KeyF');
  assert.deepEqual(p.names().filter(n => n === 'closePalette' || n === 'toggleMono'), ['closePalette', 'toggleMono']);
  const s = desktopKeys({ pal: { hidden: false }, palMode: 'search', settingsFocused: () => false }); s.key('KeyF'); assert.ok(!s.names().includes('toggleMono'), 'the search palette keeps them');
  // guide: ⇧W Reopen under W, = − on the window's edge, Z Back on where it goes back to
  const f = { id: 'a1', app: 'frame' };
  const g = keysGuide({ focused: () => f, ws: [{ id: 'd1', wins: ['a1', 'b1'] }], W: { a1: f }, closedWins: [{ w: { id: 'gone' } }], resizable: () => true, spotPrev: 'home', spotLive: () => true });
  const win = g.add('<div class="win"><div class="wbar"><button data-wact="close"></button></div><div class="wbody"></div></div>'); g.ctx.winEl = () => win;
  g.show(false);
  assert.deepEqual(g.on('⇧W', '[data-wact="close"]').map(c => c.word), ['Reopen']);
  assert.deepEqual(g.on('=', '.wbody').map(c => c.word), ['Wider']); assert.deepEqual(g.on('−', '.wbody').map(c => c.word), ['Narrower']);
  assert.deepEqual(g.on('Z').map(c => [c.on.id, c.word]), [['logo', 'Back']]);
});

test('resize keeps the stock split until asked, and is kept per desk', () => {
  const panes = vm.runInNewContext(readFileSync(new URL('../web/core/pane-layout.js', import.meta.url), 'utf8') + '\nWizCore.panes;'), splitOf = panes.splitOf;
  // the desktop's ⌥= (resizeFocused) steps from the shared stock split, and keeps the result on that desk
  const resize = (wins, front, dir) => { const d = { wins }, r = runRecording(`${between(js, '  const SPLIT = [0.25, 0.75];', '  function focusWin(')}\nresizeFocused(${dir});`,
    { C: { panes }, ws: [d], cur: 0, focused: () => ({ id: front }), homeOpen: false, W: {}, hud: null, globalThis: {}, clampN: (v, a, b) => Math.min(b, Math.max(a, v)) }); return d.split; };
  assert.equal(resize(['a', 'b'], 'a', 1), 0.58); assert.equal(resize(['a', 'b', 'c'], 'a', 1), 0.64, 'three windows: from the stock 0.56');
  assert.equal(resize(['a', 'b'], 'b', 1), 0.42, 'the other window wider');
  assert.equal(splitOf({}, 2), 0.5); assert.equal(splitOf({}, 3), 0.56); assert.equal(splitOf({ split: 0.66 }, 2), 0.66); assert.equal(splitOf({ split: 0.9 }, 2), 0.5);
});

test('⌥L flips Dark / Light within the same skin, shown on the Settings gear; closed windows survive a reload', () => {
  const k = desktopKeys(); k.key('KeyL'); assert.deepEqual(k.calls.at(-1), ['flipLight']);
  const held = desktopKeys(); held.key('KeyL', { repeat: true }); assert.deepEqual(held.calls, []);
  // flipLight: the real skins.js twin, set
  const skins = shippedSkinsHost();
  const set = [], fl = fn('function flipLight() {', { window: { WosSkin: { twin: () => skins.WosSkin.twin('obsidian'), set: id => set.push(id) } }, log() {} });
  fl.flipLight(); assert.deepEqual(set, ['obsidian-light']);
  for (const [a, b] of [['obsidian', 'obsidian-light'], ['obsidian-light', 'obsidian'], ['landscapes', 'landscapes-light'], ['landscapes-light', 'landscapes']]) assert.equal(skins.WosSkin.twin(a)?.id, b, a);
  // the gear says where it goes
  for (const light of [true, false]) {
    const g = keysGuide(); g.ctx.window.WosSkin = { twin: () => ({ id: 'x', light }) };
    g.show(false); assert.deepEqual(g.on('L', '#settingsBtn').map(c => c.word), [light ? 'Light' : 'Dark']);
  }
  // closed windows come back from the store after a reload (the last 12 whole entries)
  const kept = Array.from({ length: 14 }, (_, i) => ({ w: { id: 'w' + i } }));
  const closed = vm.runInNewContext(`(() => { ${lineOf("const closedWins = (() => { const v = store.get('closed', []);")}\n return closedWins; })()`, { store: { get: (key, d) => (key === 'closed' ? [...kept, null, { w: {} }] : d) } });
  assert.deepEqual(closed.map(c => c.w.id), kept.slice(-12).map(c => c.w.id));
});
