import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { between, block, runRecording } from './fixtures/source-slice.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
const source = withShellParts(fs.readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8'));
const css = withShellParts(fs.readFileSync(new URL('../web/desktop/desktop.css', import.meta.url), 'utf8'));
function fn(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  const lineEnd = source.indexOf('\n', start);
  const end = source.slice(start, lineEnd).endsWith('}') ? lineEnd : source.indexOf('\n  }', start) + 4;
  return source.slice(start, end);
}
function rig({ cur = 1, lastWs = 2, count = 3, homeOpen = false, refuse = '' } = {}) {
  const W = {}, calls = [];
  const ws = Array.from({ length: count }, (_, i) => { const id = `w${i}`; W[id] = { id, app: i === 1 ? 'chats' : 'frame', name: `App ${i}` }; return { id: `d${i}`, wins: [id], focus: id, mono: false }; });
  const ctx = vm.createContext({ ws, W, cur, lastWs, homeOpen, hud: null, calls, closedWins: [],
    wsOf: id => ws.findIndex(d => d.wins.includes(id)),
    CHATS: { beforeLeave: id => id !== refuse, saveDraft: id => calls.push(['draft', id]), forget: id => calls.push(['forget', id]), markVisibleThreadsSeen: () => calls.push(['seen']) },
    threadShown: (id, el) => calls.push(['thread', id, el]), boundManager: { dismiss: w => calls.push(['dismiss', w.id]) },
    window: { WizBackgroundAudio: { closeApp: id => { calls.push(['audio', id]); return Promise.resolve(); } } },
    appOf: w => w, store: { set: () => {} }, save: () => calls.push(['save']), render: () => calls.push(['render']),
    focused: () => ctx.homeOpen ? null : W[ws[ctx.cur].focus], focusInside: id => calls.push(['focus', id]), goHome: () => { ctx.homeOpen = true; }, toast: (...args) => calls.push(['toast', ...args]), hudClose: () => {} });
  vm.runInContext(['canLeave', 'removeWin', 'rememberClosed', 'closeWin', 'removeDesktop', 'closeDesktop', 'closeCurrent'].map(fn).join('\n'), ctx);
  return ctx;
}
test('hover ✕ closes a desktop', () => {
  // the real bar (paintBar) on the small DOM, and the real click handler of its desk list
  const doc = createDocument(); doc.body.innerHTML = '<div id="logo"></div><nav id="wsList"></nav>';
  const $ = sel => doc.querySelector(sel) || doc.createElement('div'), nav = new Proxy({ slot: i => i + 1 }, { get: (t, k) => t[k] || (() => '') }), taps = [];
  runRecording(`(${block(source, '  function paintBar() {')})()`, { $, C: { workspaceNav: nav }, LIVE: null, window: {}, MOD: '⌘', APP: {},
    homeOpen: false, cur: 0, W: { a: { app: 'frame' }, b: { app: 'frame' } }, ws: [{ wins: ['a'] }, { wins: ['b'] }], winTitle: w => w.app });
  runRecording(block(source, "  $('#wsList').addEventListener('click', e => {") + ');', { $, closeDesktop: i => taps.push(['close', i]), newDesktop: () => taps.push(['new']), goWs: i => taps.push(['go', i]) });
  const x = doc.querySelector('[data-ws="1"] [data-wsclose]');
  assert.ok(x, 'each desk carries its ✕'); assert.equal(x.getAttribute('tabindex'), '-1'); assert.equal(x.getAttribute('aria-label'), 'Close desktop 2');
  x.click(); doc.querySelector('[data-ws="0"]').click();
  assert.deepEqual(taps, [['close', 1], ['go', 0]], 'the ✕ closes that desktop and never also switches to it');
  // the ✕ sits on the desk's corner, hidden until the desk is hovered or focused
  const look = st => cascade(x, css, { states: st });
  assert.equal(look([]).visibility?.value, 'hidden');
  assert.deepEqual([look([]).top?.value, look([]).left?.value], ['-3px', '-3px']);
  for (const st of [':hover', ':focus-visible', ':focus-within']) assert.notEqual(look([st]).visibility?.value, 'hidden', st);
  const r = rig(); r.closeDesktop(1); assert.equal(r.ws.length, 2); assert.equal(r.W.w1, undefined);
});
// An event target that honours { signal } (the menu drops all its listeners with one abort).
function target(base = {}) {
  const ls = [];
  return Object.assign(base, { ls,
    addEventListener(t, f, o = {}) { const l = { t, f }; ls.push(l); o.signal?.addEventListener('abort', () => ls.splice(ls.indexOf(l), 1)); },
    removeEventListener(t, f) { const i = ls.findIndex(l => l.t === t && l.f === f); if (i >= 0) ls.splice(i, 1); },
    fire(t, e = {}) { for (const l of ls.filter(l => l.t === t)) l.f({ type: t, ...e }); } });
}
test('right-click offers Close desktop', () => {
  // the desktop strip's real contextmenu wiring and desktopMenu, with the real shared menu
  const doc = createDocument(); doc.body.innerHTML = '<div id="wsList"><button class="ws" data-ws="0"></button><button class="ws" data-ws="1"><span class="ws-n">2</span></button></div>';
  const win = target({ innerWidth: 1200, innerHeight: 800 });
  doc.defaultView = win; target(doc);
  vm.runInNewContext(fs.readFileSync(new URL('../web/core/context-menu.js', import.meta.url), 'utf8'), { window: win, document: doc, AbortController, navigator: {} });
  const list = target(doc.getElementById('wsList'));
  const ws = [{ id: 'd0' }, { id: 'd1' }], closed = [];
  vm.runInNewContext(between(source, '  function desktopMenu(b, x, y) {', "  $('#wsList').addEventListener('keydown'"), { ws, window: win, $: s => (s === '#wsList' ? list : null), closeDesktop: i => closed.push(i) });
  let prevented = false;
  list.fire('contextmenu', { target: doc.querySelector('.ws-n'), clientX: 40, clientY: 20, preventDefault() { prevented = true; } });
  assert.ok(prevented, 'no browser menu');
  const menu = doc.querySelector('.wos-context-menu');
  assert.equal(menu.getAttribute('aria-label'), 'Desktop actions');
  assert.deepEqual(menu.querySelectorAll('[role="menuitem"]').map(b => b.textContent), ['Close desktop']);
  ws.unshift({ id: 'new' });   // the desks are reordered while the menu is open
  menu.querySelector('button').click();
  assert.deepEqual(closed, [2], 'the desk that was right-clicked, not its old index');
  assert.equal(doc.querySelector('.wos-context-menu'), null);
  // it closes on an outside press, a blur, a scroll and a resize, and then leaves no listener behind
  for (const [where, type] of [[doc, 'pointerdown'], [win, 'blur'], [win, 'scroll'], [win, 'resize']]) {
    list.fire('contextmenu', { target: doc.querySelector('[data-ws="0"]'), clientX: 1, clientY: 1, preventDefault() {} });
    assert.ok(win.WosContextMenu.isOpen, type);
    where.fire(type, { target: doc.body });
    assert.equal(win.WosContextMenu.isOpen, false, type + ' closes it');
    assert.equal(doc.querySelector('.wos-context-menu'), null);
    assert.equal(doc.ls.length + win.ls.length, 0, type + ': every listener released');
  }
  // Escape / Back peels it first (core/escape-back.js owners)
  const eb = {}; vm.runInNewContext(fs.readFileSync(new URL('../web/core/escape-back.js', import.meta.url), 'utf8'), { window: eb });
  Object.assign(eb, { WosContextMenu: win.WosContextMenu });
  const stack = eb.WizEscapeBack.create();
  vm.runInNewContext('(' + eb.WizEscapeBack.installOwners.toString() + ')', { window: eb, MutationObserver: class { observe() {} disconnect() {} }, document: { documentElement: {} }, queueMicrotask })(stack, { chats: () => ({}), links: () => null });
  list.fire('contextmenu', { target: doc.querySelector('[data-ws="0"]'), clientX: 1, clientY: 1, preventDefault() {} });
  assert.equal(stack.run(), 'context'); assert.equal(win.WosContextMenu.isOpen, false);
});
test('closing a desktop lands on the one to its left', () => {
  const r = rig(); r.closeDesktop(); assert.equal(r.cur, 0); assert.equal(r.ws[r.cur].id, 'd0');
  assert.ok(r.calls.some(c => c[0] === 'focus' && c[1] === 'w0')); assert.ok(r.calls.some(c => c[0] === 'seen'));
});
test('closing the last app removes its desktop', () => {
  const r = rig(); r.closeWin('w1'); assert.equal(r.ws.length, 2); assert.equal(r.ws[r.cur].id, 'd0');
});
test('closing a background desktop preserves the current desktop and its indices', () => {
  const r = rig({ cur: 2, lastWs: 1 }); r.closeDesktop(0); assert.equal(r.cur, 1); assert.equal(r.lastWs, 0); assert.equal(r.ws[r.cur].id, 'd2');
  assert.ok(!r.calls.some(c => c[0] === 'focus'));
});
test('closing the first desktop selects the new first desktop', () => {
  const r = rig({ cur: 0 }); r.closeDesktop(); assert.equal(r.cur, 0); assert.equal(r.ws[0].id, 'd1');
});
test('closing the only desktop keeps an empty desktop and goes Home', () => {
  const r = rig({ cur: 0, count: 1 }); r.closeDesktop(); assert.equal(r.ws.length, 1); assert.equal(r.ws[0].wins.length, 0); assert.equal(r.homeOpen, true);
});
test('an internal last-window close never prunes or dismisses bound views', () => {
  const r = rig(); r.closeWin('w1', true); assert.equal(r.ws.length, 3); assert.equal(r.cur, 1); assert.ok(!r.calls.some(c => c[0] === 'dismiss'));
});
test('whole-desktop close uses per-window cleanup for every window', () => {
  const r = rig(); r.W.extra = { id: 'extra', app: 'frame' }; r.ws[1].wins.push('extra'); r.closeDesktop();
  for (const id of ['w1', 'extra']) for (const kind of ['draft', 'forget', 'dismiss']) assert.ok(r.calls.some(c => c[0] === kind && c[1] === id), `${id}: ${kind}`);
  assert.ok(r.calls.some(c => c[0] === 'thread' && c[1] === 'w1' && c[2] === null));
  assert.match(r.calls.find(c => c[0] === 'toast')[2], /^Closed /);
});
test('refused close is atomic, leaving every app on the desktop intact', () => {
  const r = rig({ refuse: 'w1' }); assert.equal(r.closeDesktop(), false); assert.equal(r.ws.length, 3); assert.ok(r.W.w1); assert.equal(r.calls.length, 0);
});
test('an empty desktop closes by shortcut, but closing the only app keeps the last desktop', () => {
  const r = rig(); r.closeWin('w1', true); assert.equal(r.closeCurrent(), 'desktop'); assert.equal(r.cur, 0);
  const only = rig({ cur: 0, count: 1 }); only.closeWin('w0'); assert.equal(only.ws.length, 1); assert.equal(only.homeOpen, false);
});
test('close shortcut at Home never closes a parked desktop', () => {
  const r = rig({ homeOpen: true }); assert.equal(r.closeCurrent(), 'root');
  assert.equal(r.ws.length, 3); assert.equal(Object.keys(r.W).length, 3); assert.equal(r.homeOpen, true);
});
test('a workflow return target gets keyboard focus after last-window pruning', () => {
  const r = rig({ cur: 2 });
  r.document = { querySelector: () => ({}) }; // render already painted the destination .focus class
  r.leaveHome = () => { r.homeOpen = false; };
  r.goWs = i => { r.cur = i; };
  r.paintFocus = () => {}; r.paintBar = () => {};
  vm.runInContext(fn('focusWin'), r);
  r.closeWin('w2'); assert.equal(r.cur, 1);
  r.focusWin('w0'); assert.equal(r.cur, 0);
  assert.equal(r.calls.filter(c => c[0] === 'focus').at(-1)[1], 'w0');
});
test('closing a background last app does not move the current desktop', () => {
  const r = rig({ cur: 2 }); r.closeWin('w0'); assert.equal(r.ws[r.cur].id, 'd2');
});
test('main without an Incognito/recording guard still closes windows and desks', () => {
  const r = rig(); delete r.CHATS.beforeLeave;
  r.closeDesktop(1); assert.equal(r.ws.length, 2); assert.equal(r.W.w1, undefined);
});
