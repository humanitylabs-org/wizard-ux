import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../web/desktop/desktop.css', import.meta.url), 'utf8');
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
  const ctx = vm.createContext({ ws, W, cur, lastWs, homeOpen, hud: null, calls,
    wsOf: id => ws.findIndex(d => d.wins.includes(id)),
    CHATS: { beforeLeave: id => id !== refuse, saveDraft: id => calls.push(['draft', id]), forget: id => calls.push(['forget', id]), markVisibleThreadsSeen: () => calls.push(['seen']) },
    threadShown: (id, el) => calls.push(['thread', id, el]), boundManager: { dismiss: w => calls.push(['dismiss', w.id]) },
    window: { WizBackgroundAudio: { closeApp: id => { calls.push(['audio', id]); return Promise.resolve(); } } },
    appOf: w => w, store: { set: () => {} }, save: () => calls.push(['save']), render: () => calls.push(['render']),
    focused: () => ctx.homeOpen ? null : W[ws[ctx.cur].focus], focusInside: id => calls.push(['focus', id]), goHome: () => { ctx.homeOpen = true; }, toast: (...args) => calls.push(['toast', ...args]), hudClose: () => {} });
  vm.runInContext(['removeWin', 'closeWin', 'removeDesktop', 'closeDesktop', 'closeCurrent'].map(fn).join('\n'), ctx);
  return ctx;
}
test('hover ✕ closes a desktop', () => {
  assert.match(source, /data-wsclose="\$\{i\}" tabindex="-1" aria-label="Close desktop/);
  assert.match(css, /\.ws:hover \.ws-close, \.ws:focus-visible \.ws-close, \.ws:focus-within \.ws-close/);
  assert.match(css, /\.ws-close \{[^}]*top: -3px; left: -3px;[^}]*visibility: hidden/s);
  assert.ok(source.indexOf("const close = e.target.closest('[data-wsclose]')") < source.indexOf("const b = e.target.closest('[data-ws]'); if (b) goWs"));
  const r = rig(); r.closeDesktop(1); assert.equal(r.ws.length, 2); assert.equal(r.W.w1, undefined);
});
test('right-click offers Close desktop', () => {
  assert.match(source, /addEventListener\('contextmenu',[\s\S]*desktopMenu\(b, e.clientX, e.clientY\)/);
  assert.match(fn('desktopMenu'), /label: 'Close desktop'.*closeDesktop\(ws.indexOf\(d\)\)/);
  assert.match(fn('escStep'), /WosContextMenu\?\.back\(\)/);
  const menu = fs.readFileSync(new URL('../web/core/context-menu.js', import.meta.url), 'utf8');
  for (const event of ['pointerdown', 'blur', 'scroll', 'resize']) assert.ok(menu.includes(`addEventListener('${event}'`));
  assert.match(menu, /abort.abort\(\)/);
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
