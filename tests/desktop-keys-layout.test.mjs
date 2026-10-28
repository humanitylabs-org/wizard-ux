import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../web/desktop.html', import.meta.url), 'utf8');

test('holding ⌥ is the one keys guide: speak keys named and explained, no separate sheet', () => {
  assert.doesNotMatch(js, /const KEYS = \[/);
  for (const name of ['Talk about this', 'New voice chat', 'Tell the computer', 'Type with your voice']) assert.ok(js.includes(name), name);
  assert.match(js, /function toggleKeys\(on\) \{[^\n]*keyHints\.show\(true\)/);
  assert.match(js, /if \(keyHints\.pinned\(\)\) \{ toggleKeys\(false\)/);
});

test('⌥S speaks about the screen, ⌥C speaks a command, ⌥D dictates', () => {
  assert.match(js, /code === 'KeyS' \|\| code === 'KeyC' \|\| code === 'KeyD'/);
  assert.match(js, /code === 'KeyS' \? speakScreen\(\) : commandVoice\(\)/);
  assert.match(js, /if \(code === 'KeyD'\) \{[\s\S]*?return dictate\(\);/);
  for (const [id, key] of [['micBtn', 'Alt\\+S'], ['commandBtn', 'Alt\\+C'], ['dictateBtn', 'Alt\\+D']]) assert.match(html, new RegExp(`id="${id}"[^>]*aria-keyshortcuts="${key}"`));
});

test('holding left ⌥ alone shows key hints; any other key or release hides them', () => {
  assert.match(js, /if \(pinned \|\| e\.repeat \|\| e\.code !== 'AltLeft'/);
  assert.match(js, /keyHints\.down\(e\)/);
  assert.match(js, /addEventListener\('keyup', e => keyHints\.up\(e\), true\)/);
  assert.match(js, /doc\.addEventListener\('keyup', e => keyHints\.up\(e\), true\)/);
});

test('⌥S only sends its own kind of take', () => {
  assert.match(js, /function speakScreen\(\) \{[\s\S]*?vMode === 'talk' && !vNewChat && !commandTake\) return talk\('send'\)/);
});

test('⌥↓/⌥↑ walk Ready chats from anywhere into the message box; no ⌥←/⌥→ list hop', () => {
  assert.match(js, /\.ch-sec\[data-sec="ready"\] \.ch-row\[data-chopen\]/);
  assert.match(js, /chatsUpDown\(code === 'ArrowDown' \? 1 : -1\)/);
  assert.match(js, /function chatsUpDown\(dir\) \{ return stepReady\(dir\); \}/);
  assert.doesNotMatch(js, /code === 'ArrowRight'\)[^\n]*chatsSide/); // the arrows never hop sides; ⌥[ ⌥] do
  assert.match(js, /focusInside\(f\.id\); \}, 30\); \/\/ straight into the message box/);
  assert.ok(js.includes("'Next ready chat'"));
});

test('⌥→ Done and ⌥← Snooze act on the open chat (not mid-text); no hidden ⌥E/⌥Z; the guide shows chat keys', () => {
  assert.doesNotMatch(js, /code === 'KeyE'|code === 'KeyZ'/);
  assert.match(js, /const midText = typing\(e\.target\) && String\(e\.target\.value \?\? e\.target\.textContent \?\? ''\)\.trim\(\) !== '';/);
  assert.match(js, /CHATS\.threadAct\(f\.id, f\.thread, act\)/);
  assert.match(js, /code === 'ArrowLeft' \|\| code === 'ArrowRight'\) && chatOpen\(\) && !midText\) return hit/);
  assert.match(js, /code === 'ArrowLeft' \|\| code === 'ArrowRight'\) && chatOpen\(\) && !midText\) return hit\(\(\) => \{ if \(!e\.repeat\) chatAct\(code === 'ArrowRight' \? 'done' : 'snooze'/);
  assert.match(js, /\['\[data-chact="done"\]', '→', 'Done'\], \['\[data-chact="snooze"\]', '←', 'Snooze'\]/);
  assert.match(js, /chip\(next, '↓', 'inside'\)/);
});

test('after a text or voice reply is sent, the window goes back to a focused New chat', () => {
  assert.match(js, /stage\.addEventListener\('submit', e => \{[\s\S]*?toNewChat\(wid, 'text'\)/);
  assert.match(js, /function toNewChat\(wid, why\) \{[\s\S]*?CHATS\.openNewDraft\(wid, ''\)[\s\S]*?focusInside\(wid\)/);
  assert.match(js, /Voice reply · waiting to send', 1400\); setTimeout\(\(\) => toNewChat\(rp\.wid, 'voice'\)/);
});
test('desktop recordings skip echo cancellation (no music ducking) and pick a wired mic explicitly', async () => {
  const { readFileSync: r } = await import('node:fs');
  const v = r(new URL('../web/core/voice.js', import.meta.url), 'utf8');
  assert.match(v, /echoCancellation: PHONE/);
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
  assert.match(js, /code === 'Backquote'\) return hit\(\(\) => \{ if \(e\.repeat\) return; if \(homeOpen\) \{ leaveHome\(\)/);
  assert.doesNotMatch(js, /code === 'Digit1'\) return hit/);
  assert.ok(js.includes("['`', 'Home', 'Again to go back']") && js.includes("['1–9', 'Desktop 1 to 9'"));
});

test('⌥G Pick anything: letter chips on every clickable, typed letters click it, guide lists it', () => {
  assert.match(js, /code === 'KeyG'\) return hit\(\(\) => \{ if \(!e\.repeat\) pick\.start\(\); \}\)/);
  assert.match(js, /function onKey\(e, fromFrame = false\) \{\n    if \(pick\.active\(\)\) return pick\.key\(e\);/);
  assert.match(js, /\[data-chopen\],\[data-chdraft\]/);
  assert.match(js, /querySelectorAll\('iframe'\)/);
  assert.ok(js.includes("['G', 'Pick anything',"));
});

test('the keys guide is chips in place, no boxes: ↓ on the next Ready chat, F W R on window buttons, H J K L on neighbours, words only on Speak', () => {
  assert.doesNotMatch(js, /kh-card|function card\(/);
  assert.match(js, /rows\[0\] : rows\[\(i \+ 1\) % rows\.length\]/);
  assert.match(js, /\['\[data-wact="mono"\]', 'F'\], \['\[data-wact="close"\]', 'W'\], \['\[data-wact="reload"\]', 'R'\]/);
  assert.match(js, /\(dx < 0 \? 'H' : 'L'\) : \(dy < 0 \? 'K' : 'J'\)/);
  assert.match(js, /\['#micBtn', 'S', 'Talk about this'\]/);
})

test('guide: → ← sit above Done / Snooze; no "/" chip on chat search', () => {
  assert.match(js, /filter\(vis\)\.map\(n => chip\(n, l, 'above'\)\)/);
  assert.doesNotMatch(js, /chip\(srch, '\/'/);
});

test('guide extras: ↓ on Home, [ ] on neighbour desks, ↑ on the previous Ready chat, I on chat search; ⌥I again searches chats', () => {
  assert.match(js, /\$\('#desktopHome \[data-home-act="ready"\]'\) \|\| \$\('#desktopHome \.home-card \.home-row'\)/);
  assert.match(js, /cur === 0 \? \$\('#logo'\)/);
  assert.match(js, /chip\(prev, '↑', 'inside'\)/);
  assert.match(js, /chip\(srch, 'I', 'inside'\)/);
  assert.match(js, /log\('key:search-chats'\)/);
  assert.match(js, /chip\(cancel, 'Esc'\)/);
});

test('⌥[ ⌥] never wrap: left of desktop 1 is Home, nothing left of Home or right of the last desk; Speak words sit in the bar', () => {
  assert.match(js, /if \(dir < 0 && cur === 0\) \{ lastWs = cur; goHome\(\); return; \}/);
  assert.match(js, /const t = cur \+ dir; if \(t < 0 \|\| t >= ws\.length\) return;/);
  assert.doesNotMatch(js, /\(cur - 1 \+ ws\.length\) % ws\.length|\(cur \+ 1\) % ws\.length/);
  assert.match(js, /stepWin\(-1\); \}\);/);
  assert.match(js, /function stepWin\(dir\) \{[\s\S]*?stepDesk\(dir\);/);
  assert.match(js, /leg\.classList\.add\('in-bar'\)/);
});

test('[ ] chips are their own second-row chips, never merged into the neighbour key', () => {
  assert.doesNotMatch(js, /withStep/);
  assert.match(js, /if \(vis\(stepL\)\) chip\(stepL, '\['\); if \(vis\(stepR\)\) chip\(stepR, '\]'\);/);
});

test('⌥] / ⌥[ walk this desk\'s windows left to right (Chats: list, then message box), then step to the next desk', async () => {
  const vm = await import('node:vm');
  const start = js.indexOf('  function chatsZone(f) {'), end = js.indexOf('  function goWs(i');
  assert.ok(start > 0 && end > start);
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
