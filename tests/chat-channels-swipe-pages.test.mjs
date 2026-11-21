// Channels pages (wizard-ux issue 1467, switch wizard/chat-channels): on the Chats home a sideways swipe anywhere moves
// between Channels (left) and Activity (right); in a channel's feed a swipe right is Back. Loads the real built-in
// (core/thread-swipe-back.js) with a fake skin API and a fake Chats list, the way thread-swipe-snapback does.
import test from 'node:test';
import assert from 'node:assert/strict';

let setup = null;
globalThis.window = { WosSkinHost: { builtin: (_n, fn) => { setup = fn; } }, getSelection: () => '' };
globalThis.getComputedStyle = n => ({ overflowX: n.ox || 'visible' });
await import('../web/core/thread-swipe-back.js');

// A fake element: `sel` is the one selector it answers to in closest(); parent chain via parentElement.
function el(sel = '', parent = null, extra = {}) {
  const classes = new Set();
  return Object.assign({
    nodeType: 1, sel, parentElement: parent, style: {}, dataset: {}, scrollWidth: 0, clientWidth: 0, scrollLeft: 0,
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: c => classes.has(c) },
    closest(q) { for (let n = this; n; n = n.parentElement) if (n.sel && q.split(',').map(x => x.trim()).includes(n.sel)) return n; return null; },
  }, extra);
}

function harness({ page = 'channels', feed = false, tabs = true, tray = false, view = 'list' } = {}) {
  const handlers = {}, queued = [], clicks = []; let backs = 0, now = 0;
  const st = { page };
  const root = el('[data-chats]');
  const list = el('.ch-list', root), body = el('.ch-scroll', list), bar = el('.ch-rdy-bar', list);
  const btn = v => { const b = el('[data-chview]', bar); b.dataset.chview = v; b.click = () => { clicks.push(v); st.page = v; }; return b; };
  const chan = btn('channels'), act = btn('activity');
  (page === 'channels' ? chan : act).classList.toggle('on', true);
  bar.querySelector = q => q.includes('aria-pressed') ? (st.page === 'channels' ? chan : act) : q.includes('"channels"') ? chan : q.includes('"activity"') ? act : null;
  bar.querySelectorAll = () => [chan, act];
  list.querySelector = q => q === '.ch-chan-h [data-chchanback]' ? (feed ? el('[data-chchanback]', list) : null)
    : q === '.ch-chan-tabs .ch-rdy-bar' ? (tabs && !feed ? bar : null) : q === ':scope > .ch-scroll' ? body : q === '.ch-row-wrap.swiped' ? (tray ? el() : null) : null;
  // The shell root's first list is another Chats window (a routed agent, another desk): never the one to read.
  const decoy = el('.ch-list', root); decoy.querySelector = () => { throw new Error('read another window\'s list'); };
  root.querySelector = q => q === '.ch-list' ? decoy : q === '.ch-list > .ch-scroll' ? el('.ch-scroll', decoy) : null;
  const realNow = performance.now;
  setup({
    part: n => (n === 'list' || n === 'thread' ? root : null), route: () => ({ view }), env: { edgeInset: 24 },
    listen: (_el, type, fn) => { handlers[type] = fn; }, frame: fn => queued.push(fn), on() {},
    nav: { back: () => { backs++; return true; } },
  });
  // A swipe of dx/dy over ms, starting on `target` (default: empty space in the list body).
  const swipe = (dx, dy, ms, target = body, { hold = false, cancel = false } = {}) => {
    const b0 = backs, c0 = clicks.length; now = 0; const x = 200, y = 400;
    performance.now = () => now;
    handlers.touchstart({ touches: [{ clientX: x, clientY: y }], target });
    for (let i = 1; i <= 8; i++) { now = ms * i / 8; handlers.touchmove({ touches: [{ clientX: x + dx * i / 8, clientY: y + dy * i / 8 }] }); }
    while (queued.length) queued.shift()();
    const mid = { on: { channels: chan.classList.contains('on'), activity: act.classList.contains('on') }, transform: body.style.transform };
    if (!hold) handlers[cancel ? 'touchcancel' : 'touchend']({ type: cancel ? 'touchcancel' : 'touchend', changedTouches: [{ clientX: x + dx, clientY: y + dy }] });
    while (queued.length) queued.shift()();
    performance.now = realNow;
    return { back: backs > b0, to: clicks.slice(c0)[0] || null, mid };
  };
  return { swipe, st, body, list, chan, act };
}

test('Channels: a swipe left from the middle of the list lands on Activity; a swipe right does nothing', () => {
  const h = harness();
  const r = h.swipe(-160, 6, 400);
  assert.equal(r.to, 'activity'); assert.equal(r.back, false);
  assert.equal(h.body.style.transform, '', 'the new page settles in place');
  assert.equal(h.body.style.opacity, '');
  const g = harness();
  const n = g.swipe(160, 6, 400);
  assert.equal(n.to, null, 'nothing to the left of Channels'); assert.equal(n.back, false, 'Back is never run from the home: the app stays open');
});

test('Activity: a swipe right lands on Channels; a swipe left does nothing', () => {
  const h = harness({ page: 'activity' });
  assert.equal(h.swipe(160, 6, 400).to, 'channels');
  const g = harness({ page: 'activity' });
  const n = g.swipe(-160, 6, 400); assert.equal(n.to, null); assert.equal(n.back, false);
});

test('the page follows the finger and the header tab follows it before release', () => {
  const h = harness();
  const r = h.swipe(-150, 4, 1200, h.body, { hold: true });
  assert.match(r.mid.transform, /translateX\(-/, 'the list body moves left with the finger');
  assert.deepEqual(r.mid.on, { channels: false, activity: true }, 'past the commit distance the tabs show Activity');
});

test('short, slow or vertical drags snap back and change nothing', () => {
  const h = harness();
  const r = h.swipe(-60, 4, 900, h.body);
  assert.equal(r.to, null); assert.equal(h.body.style.transform, '', 'no leftover offset'); assert.equal(h.body.style.opacity, '');
  assert.deepEqual([h.chan.classList.contains('on'), h.act.classList.contains('on')], [true, false], 'the tabs read Channels again');
  assert.equal(harness().swipe(-30, 220, 400).to, null, 'a vertical scroll never changes page');
  assert.equal(harness().swipe(-140, 90, 400).to, null, 'a diagonal drag never changes page');
  const c = harness();
  const k = c.swipe(-160, 4, 400, c.body, { cancel: true });
  assert.equal(k.mid.on.activity, true); assert.equal(k.to, null, 'a cancelled touch never changes page');
  assert.deepEqual([c.chan.classList.contains('on'), c.act.classList.contains('on')], [true, false], 'the tabs go back to Channels');
  assert.equal(c.body.style.transform, '');
});

test('swipes starting on a row: channel rows and empty space move the page; an Activity row keeps its leftward swipe', () => {
  const h = harness();
  const chanRow = el('[data-chchan]', h.list);
  assert.equal(h.swipe(-160, 6, 400, chanRow).to, 'activity', 'from the middle of a channel row');
  const a = harness({ page: 'activity' });
  const row = el('[data-chopen]', a.list);
  assert.equal(a.swipe(-160, 6, 400, row).to, null, 'leftward on an Activity row is the row action');
  assert.equal(a.swipe(160, 6, 400, row).to, 'channels', 'rightward on an Activity row is the page swipe');
  const t = harness({ page: 'activity', tray: true });
  assert.equal(t.swipe(160, 6, 400).to, null, 'with a row tray open, the swipe closes the tray only');
});

test('a sideways scroller scrolls first; the page only takes over at its edge', () => {
  const h = harness();
  const chips = el('.chips', h.list, { ox: 'auto', scrollWidth: 600, clientWidth: 300, scrollLeft: 0 }), chip = el('button', chips);
  assert.equal(h.swipe(-160, 6, 400, chip).to, null, 'the chips scroll');
  chips.scrollLeft = 300;
  assert.equal(h.swipe(-160, 6, 400, chip).to, 'activity', 'at the chips\' end the page moves');
  const code = el('pre', h.list);
  assert.equal(harness().swipe(-160, 6, 400, code).to, null, 'a code block keeps its sideways scroll');
});

test('a channel or agent feed: a swipe right is Back (to the Channels list); a swipe left does nothing', () => {
  const h = harness({ feed: true });
  assert.equal(h.swipe(160, 6, 400).back, true);
  const g = harness({ feed: true });
  const r = g.swipe(-160, 6, 400); assert.equal(r.back, false); assert.equal(r.to, null);
});

test('two Chats windows: the swipe reads the list under the finger, never the first list in the shell', () => {
  const h = harness();
  const r = h.swipe(-160, 6, 400); // the harness's shell root answers '.ch-list' with another window that throws
  assert.equal(r.to, 'activity'); assert.equal(h.body.style.transform, '', 'our own body settles');
  const g = harness({ feed: true });
  assert.equal(g.swipe(160, 6, 400).back, true, 'a feed in this window goes back, whatever the other window shows');
});

test('switch off (no Channels tabs, no feed): the Chats list has no swipe', () => {
  for (const dx of [-160, 160]) { const r = harness({ tabs: false }).swipe(dx, 6, 400); assert.equal(r.to, null); assert.equal(r.back, false); }
});

// Back slides like the page swipe (wizard-ux issue 1548, same switch): going back one layer (a swipe, the Back button,
// the shell's Back step) slides the previous view in from the left with the page swipe's settle; a committed swipe
// never snaps the leaving view back first. Frame by frame: every style write is logged with the frame it lands in,
// and the fake frame queue runs one frame at a time. The slide moves the window's Chats container ('win').
function viewHarness({ on = true, reduced = false, start = 'thread', ua = '' } = {}) {
  globalThis.document = { documentElement: { dataset: { tweaks: on ? 'wizard/desktop-chats wizard/chat-channels' : 'wizard/desktop-chats' } } };
  window.matchMedia = q => ({ matches: reduced && q.includes('reduce') });
  globalThis.navigator ??= {}; const realUa = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: ua }, configurable: true, writable: true });
  const handlers = {}, renders = [], queued = []; let backs = 0, now = 0, frames = 0;
  const log = [];
  const styled = name => new Proxy({}, { set(o, k, v) { o[k] = v; log.push({ name, k, v, frame: frames }); return true; } });
  const win = el('[data-chats]'); win.style = styled('win');
  const mk = key => {
    const n = el(key === 'thread' ? '[data-part="thread"]' : '.ch-list', win, { isConnected: true });
    n.style = styled(key); n.key = key;
    n.querySelector = q => (n.key === 'feed' && q === '.ch-chan-h [data-chchanback]') ? el('[data-chchanback]', n)
      : (n.key === 'home' && q === '.ch-chan-tabs') ? el('.ch-chan-tabs', n) : q === ':scope > .ch-scroll' ? n : null;
    return n;
  };
  let cur = mk(start); cur.sid = start === 'thread' ? 't1' : null;
  win.querySelector = q => (/\[data-part="thread"\]$/.test(q) && cur.key === 'thread') || (/\[data-part="list"\]$/.test(q) && cur.key !== 'thread') ? cur : null;
  win.contains = n => n === win;
  const show = (key, reuse = false, sid = key === 'thread' ? 't1' : null) => {
    if (reuse && cur.key !== 'thread' && key !== 'thread') cur.key = key; // a morph keeps the .ch-list node
    else { cur.isConnected = false; cur = mk(key); cur.sid = sid; }
    for (const fn of renders) fn({ part: key === 'thread' ? 'thread' : 'list', el: win });
  };
  const realNow = performance.now;
  setup({
    part: n => (n === 'thread' || n === 'list' ? win : null),
    route: () => ({ view: cur.key === 'thread' ? 'thread' : 'list', thread: cur.sid || null }), env: { edgeInset: 24 },
    listen: (_el, type, fn) => { handlers[type] = fn; }, frame: fn => queued.push(fn),
    on: (type, fn) => { if (type === 'render') renders.push(fn); },
    nav: { back: () => { backs++; show(cur.key === 'thread' ? 'feed' : 'home', true); return true; } },
  });
  if (realUa) Object.defineProperty(globalThis, 'navigator', realUa);
  for (const fn of renders) fn({ part: cur.key === 'thread' ? 'thread' : 'list', el: win }); // the first paint
  const tick = () => { frames++; const q = queued.splice(0); for (const fn of q) fn(); };
  const settle = () => { for (let i = 0; i < 6; i++) tick(); };
  const swipe = (dx, ms, { cancel = false } = {}) => {
    const leaving = cur; now = 0; const x = 150, y = 400; performance.now = () => now;
    handlers.touchstart({ touches: [{ clientX: x, clientY: y }], target: el('', leaving) });
    for (let i = 1; i <= 8; i++) { now = ms * i / 8; handlers.touchmove({ touches: [{ clientX: x + dx * i / 8, clientY: y + 3 }] }); tick(); }
    frames++; const mark = log.length, f0 = frames; // the last drag frame is painted before the finger lifts
    handlers[cancel ? 'touchcancel' : 'touchend']({ type: cancel ? 'touchcancel' : 'touchend', changedTouches: [{ clientX: x + dx, clientY: y + 3 }] });
    settle(); performance.now = realNow;
    return { leaving, after: log.slice(mark), f0, backs };
  };
  return { swipe, show, settle, log, win, cur: () => cur, backs: () => backs };
}
const px = v => Number((/translateX\((-?[\d.]+)px\)/.exec(v || '') || [0, 0])[1]);
// What is painted at the end of each frame: the leaving node's and the container's offset (they add up on screen).
function painted(log, leavingName) {
  const st = { [leavingName]: 0, win: 0 }, out = new Map();
  for (const w of log) { if (w.k === 'transform' && w.name in st) st[w.name] = px(w.v); out.set(w.frame, { ...st }); }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([frame, v]) => ({ frame, ...v }));
}

for (const start of ['thread', 'feed']) {
  test(`switch on: a back swipe out of a ${start} never moves it back toward rest; the previous view slides in from the left`, () => {
    const h = viewHarness({ start });
    const r = h.swipe(160, 400);
    assert.equal(r.backs, 1, 'Back ran once');
    assert.ok(!r.after.some(w => w.name === start && w.k === 'transition' && /transform/.test(w.v)), 'the leaving view never eases back to rest');
    const frames = painted(h.log, start), atRelease = frames.filter(f => f.frame < r.f0).at(-1);
    assert.ok(atRelease[start] > 0, 'the view followed the finger');
    const after = frames.filter(f => f.frame >= r.f0);
    // The release frame: the old view's offset is gone in the same frame the new view starts 48 px left.
    assert.deepEqual([after[0][start], after[0].win], [0, -48], 'first painted frame after release: the slide start');
    assert.equal(after.at(-1).win, 0, 'and it settles in place');
    const ease = r.after.filter(w => w.name === 'win' && w.k === 'transition').map(w => w.v);
    assert.deepEqual(ease, ['none', 'transform .18s ease-out, opacity .18s ease-out'], 'one ease: the page swipe settle');
    assert.equal(h.win.style.opacity, '');
  });
}

test('switch on: a short or cancelled swipe still eases back, with no Back and no slide', () => {
  for (const [dx, ms, cancel] of [[60, 900, false], [160, 400, true]]) {
    const h = viewHarness({ start: 'thread' });
    const r = h.swipe(dx, ms, { cancel });
    assert.equal(r.backs, 0);
    assert.equal(h.cur().style.transform, ''); assert.equal(h.cur().style.opacity, '');
    assert.ok(r.after.some(w => w.k === 'transition' && /transform/.test(w.v)), 'eases back');
    assert.ok(!h.log.some(w => w.name === 'win'), 'no slide');
  }
});

test('switch on: the Back button and the shell Back step (any repaint to the layer above) play the same slide; forward mirrors it', () => {
  const h = viewHarness({ start: 'thread' });
  const seen = () => h.log.filter(x => x.name === 'win' && x.k === 'transform').map(x => x.v);
  h.show('feed'); h.settle();
  assert.deepEqual(seen(), ['translateX(-48px)', ''], 'thread -> feed slides in from the left');
  h.show('home', true); h.settle();
  assert.deepEqual(seen().slice(2), ['translateX(-48px)', ''], 'feed -> Channels list (same node, morphed) slides in from the left');
  h.show('feed', true); h.settle();
  assert.deepEqual(seen().slice(4), ['translateX(48px)', ''], 'opening a channel slides its feed in from the right');
  h.show('thread'); h.show('thread'); h.settle();
  assert.deepEqual(seen().slice(6), ['translateX(48px)', ''], 'opening a thread slides in from the right, once, through its skeleton-then-words repaint');
  h.show('home'); h.settle();
  assert.deepEqual(seen().slice(8), ['translateX(-48px)', ''], 'a thread opened from Activity goes back with the same slide');
  const n = h.log.length; h.show('home', true); h.settle();
  assert.equal(h.log.length, n, 'a live repaint of the same view has no motion');
});

test('switch on: Back from a linked thread to the thread it came from slides from the left; opening the link from the right', () => {
  const h = viewHarness({ start: 'thread' });
  const seen = () => h.log.filter(x => x.name === 'win' && x.k === 'transform').map(x => x.v);
  h.show('thread', false, 't2'); h.settle();
  assert.deepEqual(seen(), ['translateX(48px)', ''], 'opening the linked thread slides in from the right');
  h.show('thread', false, 't2'); h.settle();
  assert.equal(seen().length, 2, 'its own repaint has no motion');
  h.show('thread', false, 't1'); h.settle();
  assert.deepEqual(seen().slice(2), ['translateX(-48px)', ''], 'Back to the parent thread slides in from the left');
  h.show('feed'); h.settle();
  assert.deepEqual(seen().slice(4), ['translateX(-48px)', ''], 'and Back again to the feed');
});

test('the Android app (document-scrolled thread): opening a thread has no slide, going back still does', () => {
  const h = viewHarness({ start: 'feed', ua: 'Mozilla/5.0 WizardOS-DocScroll' });
  h.show('thread'); h.settle();
  assert.ok(!h.log.some(w => w.name === 'win'), 'no slide carries the pinned header off screen');
  h.show('feed'); h.settle();
  assert.equal(h.log.filter(w => w.name === 'win' && w.k === 'transform')[0].v, 'translateX(-48px)');
});

test('classic desktop: the list pane outside the shell Chats root gets the feed swipe (list swipes only)', () => {
  globalThis.document = { documentElement: { dataset: { tweaks: 'wizard/chat-channels' } } };
  window.matchMedia = () => ({ matches: false });
  const handlers = new Map(), renders = []; let backs = 0, view = 'list';
  const shellRoot = el('[data-chats]'); shellRoot.querySelector = q => q === '[data-part="thread"]' ? null : null; shellRoot.contains = () => false;
  const pane = el('[data-chats]'); pane.style = {};
  const list = el('.ch-list', pane, { isConnected: true }); list.style = {};
  list.querySelector = q => q === '.ch-chan-h [data-chchanback]' ? el('[data-chchanback]', list) : q === ':scope > .ch-scroll' ? list : null;
  pane.querySelector = q => q === ':scope > [data-part="list"]' ? list : null;
  pane.contains = () => false;
  setup({
    part: n => (n === 'thread' || n === 'list' ? shellRoot : null), route: () => ({ view }), env: { edgeInset: 24 },
    listen: (target, type, fn) => { handlers.set(target, { ...(handlers.get(target) || {}), [type]: fn }); }, frame: () => {},
    on: (type, fn) => { if (type === 'render') renders.push(fn); }, nav: { back: () => { backs++; return true; } },
  });
  for (const fn of renders) fn({ part: 'list', el: pane });
  const h = handlers.get(pane); assert.ok(h, 'the pane is bound');
  const swipe = () => { const realNow = performance.now; let now = 0; performance.now = () => now;
    h.touchstart({ touches: [{ clientX: 150, clientY: 400 }], target: el('', list) });
    for (let i = 1; i <= 8; i++) { now = 50 * i; h.touchmove({ touches: [{ clientX: 150 + 20 * i, clientY: 402 }] }); }
    h.touchend({ type: 'touchend', changedTouches: [{ clientX: 310, clientY: 402 }] }); performance.now = realNow; };
  swipe(); assert.equal(backs, 1, 'a swipe right on the feed pane goes back to Channels');
  view = 'thread'; swipe(); assert.equal(backs, 1, 'with a thread open beside it, the pane never runs Back (that would close the thread)');
  for (const fn of renders) fn({ part: 'list', el: pane });
  assert.equal([...handlers.keys()].filter(k => k === pane).length, 1, 'bound once');
  delete globalThis.document;
});

test('reduced motion: views change with no slide', () => {
  const h = viewHarness({ reduced: true, start: 'thread' });
  h.show('feed'); h.settle();
  assert.ok(!h.log.some(x => x.k === 'transform' && x.v), 'no offset is ever painted');
  const r = h.swipe(160, 400);
  assert.equal(r.backs, 1); assert.ok(!h.log.some(x => x.name === 'win' && x.k === 'transform' && x.v), 'no slide after a swipe either');
});

// (The switch-off case is gone: Channels are on for everyone since wizard-ux issue 1258, so slide-back always runs.)
