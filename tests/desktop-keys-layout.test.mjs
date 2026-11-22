import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withDesktopParts } from './fixtures/desktop-parts.mjs';
import { desktopKeys } from './fixtures/desktop-keys-harness.mjs';
import { keysGuide } from './fixtures/keys-guide-harness.mjs';
import { block, runRecording } from './fixtures/source-slice.mjs';

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
  assert.match(js, /keepThreadOpen: true/);
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
  assert.match(js, /code === 'Backquote'\) return hit\(\(\) => \{ if \(e\.repeat\) return; if \(homeOpen\) \{ leaveHome\(\)/);
  assert.doesNotMatch(js, /code === 'Digit1'\) return hit/);
  assert.ok(js.includes("['`', 'Home', 'Again to go back']") && js.includes("['1–9', 'Desktop 1 to 9'"));
});

test('⌥G Pick anything: letter chips on every clickable, typed letters click it, guide lists it', () => {
  assert.match(js, /code === 'KeyG'\) return hit\(\(\) => \{ if \(!e\.repeat\) pick\.start\(\); \}\)/);
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
  assert.match(js, /\[data-chopen\],\[data-chdraft\]/);
  assert.match(js, /querySelectorAll\('iframe'\)/);
  assert.ok(js.includes("['G', 'Pick anything',"));
});

test('the keys guide is chips in place, no boxes: ↓ on the next Ready chat, F W R on window buttons, no H J K L (retired for ⌥L light), words only on Speak', () => {
  assert.doesNotMatch(js, /kh-card|function card\(/);
  assert.match(js, /rows\[0\] : rows\[\(i \+ 1\) % rows\.length\]/);
  assert.match(js, /\['\[data-wact="mono"\]', 'F'\], \['\[data-wact="close"\]', 'W'\], \['\[data-wact="reload"\]', 'R'\]/);
  assert.doesNotMatch(js, /\(dx < 0 \? 'H' : 'L'\)|KeyH: \[|KeyJ: \[|KeyK: \[/);
  assert.match(js, /\['#micBtn', 'S', 'Talk about this'\]/);
})

test('guide: Resolve stays above its button; no removed action arrows or "/" chip on chat search', () => {
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

test('⌥N opens a New chat on this desk beside the app in front, and holding ⌥ shows it there', () => {
  // Reuses this desk's Chats window (no stacked copies), else opens one beside the focused window, like Reply.
  assert.match(js, /code === 'KeyN'\) return hit\(\(\) => \{[^\n]*newChat\(\); \}\);/);
  assert.doesNotMatch(js, /newChat\(\{ fresh: true \}\)/);
  // Guide: N on this desk's New chat button, or with its word on the right edge of the app in front.
  // (not when a view puts N on its own New chat button: the AI apps view's sidebar, so N shows once)
  assert.match(js, /else if \(f && f\.app !== 'chats' && !\(window\.WosSkinHost\?\.keyChips\?\.\(\) \|\| \[\]\)\.some\(c => c\.key === 'N'\)\) \{ const b = winEl\(f\.id\)\?\.querySelector\('\.wbody'\); if \(vis\(b\)\) chip\(b, 'N', 'inside', 'New chat'\); \}/);
});

test('Omarchy-style keys: ⌥− / ⌥= resize, ⌥⇧W reopens, ⌥Z jumps back, each shown where it acts', () => {
  assert.match(js, /code === 'Minus' \|\| code === 'Equal'\)\) return hit\(\(\) => resizeFocused\(code === 'Equal' \? 1 : -1\)\)/);
  assert.match(js, /alt && shift && code === 'KeyW'\) return hit\(\(\) => \{ if \(!e\.repeat\) reopenClosed\(\); \}\)/);
  assert.match(js, /alt && !shift && code === 'KeyZ'\) return hit\(\(\) => \{ if \(!e\.repeat\) jumpBack\(\); \}\)/);
  // ⌥⇧W must come before the plain ⌥W close in the ⌥ section, which ignores shift.
  assert.ok(js.indexOf("code === 'KeyW') return hit(() => { if (!e.repeat) reopenClosed")  < js.indexOf("if (code === 'KeyW') return hit"));
  assert.match(js, /chip\(n, '⇧W', 'below', 'Reopen'\)/);
  assert.match(js, /chip\(b, '=', side, 'Wider'\); chip\(b, '−', side, 'Narrower'\)/);
  assert.match(js, /chip\(n, 'Z', 'below', 'Back'\)/);
  assert.match(js, /Key\[GIWFLNTVPZ\]\|Slash\|Comma\|Minus\|Equal/);
});

test('resize keeps the stock split until asked, and is kept per desk', () => {
  assert.match(js, /const splitOf = C\.panes\.splitOf;/);
  const splitOf = vm.runInNewContext(readFileSync(new URL('../web/core/pane-layout.js', import.meta.url), 'utf8') + '\nWizCore.panes.splitOf;');
  assert.equal(splitOf({}, 2), 0.5); assert.equal(splitOf({}, 3), 0.56); assert.equal(splitOf({ split: 0.66 }, 2), 0.66); assert.equal(splitOf({ split: 0.9 }, 2), 0.5);
});

test('⌥L flips Dark / Light within the same skin, shown on the Settings gear; closed windows survive a reload', () => {
  assert.match(js, /alt && !shift && code === 'KeyL'\) return hit\(\(\) => \{ if \(!e\.repeat\) flipLight\(\); \}\)/);
  assert.match(js, /chip\(n, 'L', 'below', tw\.light \? 'Light' : 'Dark'\)/);
  assert.match(js, /store\.get\('closed', \[\]\)/);
  const skins = readFileSync(new URL('../web/core/skins.js', import.meta.url), 'utf8');
  assert.match(skins, /obsidian: 'obsidian-light', 'obsidian-light': 'obsidian', landscapes: 'landscapes-light', 'landscapes-light': 'landscapes'/);
});
