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
