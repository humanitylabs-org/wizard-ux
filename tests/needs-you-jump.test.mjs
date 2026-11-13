// wizard-ux issue 1359: the jump-to-Needs-you pill's rules, from the real chats.js source (the Channels block).
// Browser proof (counts, taps, Mark done, phone/desktop, Nebula/Grove): tests/qa-needs-you-jump.cjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const start = src.indexOf('  function jumpOpened('), end = src.indexOf('  function chanPrefs()', start);
assert.ok(start > 0 && end > start, 'jump helpers sit in the Channels block');
const block = src.slice(start, end);

function harness({ on = true, rows = {}, seen = {} } = {}) {
  const CH = {};
  const ctx = {
    W: {}, CH, ch: id => (CH[id] = CH[id] || {}), needsThreadOn: () => on,
    LIVE: {
      session: id => rows[id] || null,
      isNew: s => !!s.unread,
      seenRecord: s => seen[(s.agent && s.agent !== 'hermes' ? `agent/${s.agent}/` : '') + s.id],
    },
  };
  ctx.getComputedStyle = el => ({ bottom: el.style?.bottom || el.cssBottom });
  vm.createContext(ctx);
  vm.runInContext(block + '\nthis.api = { jumpOpened, jumpPillsHtml, jumpTarget, jumpLabel, jumpLandGap, jumpStack, liftLatest, jumpFeed, jumpBand, jumpMarks };', ctx);
  return ctx;
}

test('no pill markup with Channels off; two hidden pills with it on', () => {
  assert.equal(harness({ on: false }).api.jumpPillsHtml(), '');
  const html = harness().api.jumpPillsHtml();
  assert.ok(html.includes('data-chjump="up" hidden') && html.includes('data-chjump="down" hidden'));
});

test('amber comes first, then the nearest marker in that direction', () => {
  const { jumpTarget } = harness().api;
  const up = [{ kind: 'new', y: -40 }, { kind: 'needs', y: -900 }, { kind: 'needs', y: -300 }, { kind: 'new', y: -20 }];
  assert.deepEqual({ ...jumpTarget(up, 'up') }, { kind: 'needs', y: -300 });
  assert.deepEqual({ ...jumpTarget(up.filter(m => m.kind === 'new'), 'up') }, { kind: 'new', y: -20 });
  const down = [{ kind: 'new', y: 1200 }, { kind: 'new', y: 1000 }];
  assert.deepEqual({ ...jumpTarget(down, 'down') }, { kind: 'new', y: 1000 });
  assert.equal(jumpTarget([], 'up'), null);
});

test('the label counts each kind; green only when there are unread replies', () => {
  const { jumpLabel } = harness().api;
  const two = jumpLabel('up', [{ kind: 'needs' }, { kind: 'needs' }]);
  assert.ok(two.includes('↑') && two.includes('2 Needs you') && !two.includes('New'));
  const mixed = jumpLabel('down', [{ kind: 'needs' }, { kind: 'new' }, { kind: 'new' }]);
  assert.ok(mixed.includes('↓') && mixed.includes('1 Needs you') && mixed.includes('2 New') && mixed.includes('ch-chan-dot new'));
});

// Green = replies newer than the thread's read record when it opened, for the main agent and every routed kind.
for (const [agent, kind] of [['hermes', 'main'], ['host-ops', 'host-profile'], ['box', 'container'], ['locked', 'restricted']]) {
  test(`green replies start after the read record (${kind})`, () => {
    const row = { id: 't1', agent, kind, unread: true };
    const key = (agent !== 'hermes' ? `agent/${agent}/` : '') + 't1';
    const f = harness({ rows: { t1: row }, seen: { [key]: { assistantActivityAt: '2026-11-12T10:00:00.000Z', seenAt: 5 } } });
    f.api.jumpOpened('w1', 't1', row); // the window's own row (a routed thread can share its id with a main one)
    assert.equal(f.CH.w1.jumpSince, Date.parse('2026-11-12T10:00:00.000Z'));
    assert.equal(f.CH.w1.jumpFor, 't1');
    // Already read: no green markers on this open.
    const g = harness({ rows: { t1: { ...row, unread: false } } });
    g.api.jumpOpened('w1', 't1', { ...row, unread: false });
    assert.ok(Number.isNaN(g.CH.w1.jumpSince));
    // Unread with no read record yet: every reply counts as new (Codex P2).
    const h = harness({ rows: { t1: row } });
    h.api.jumpOpened('w1', 't1', row);
    assert.equal(h.CH.w1.jumpSince, -Infinity);
  });
}

test('a new chat and Channels off never mark green', () => {
  const f = harness({ on: false, rows: { t1: { id: 't1', unread: true } }, seen: { t1: { seenAt: 1 } } });
  f.api.jumpOpened('w1', 't1');
  assert.ok(Number.isNaN(f.CH.w1.jumpSince));
  const g = harness();
  g.api.jumpOpened('w1', '__new__');
  assert.ok(Number.isNaN(g.CH.w1.jumpSince));
});

test('the pills are wired: markup after ↓ Latest, the tap, the open and every chat-power paint', () => {
  assert.ok(src.includes("${PW ? PW.latestBtn() : ''}${s && !isNew && typeof jumpPillsHtml === 'function' ? jumpPillsHtml() : ''}"));
  assert.ok(src.includes("closest('[data-chjump]')"));
  assert.ok(src.includes('jumpOpened(wid, sid,'));
  assert.ok(src.includes('chanOpen, paintJump, chanSpaceOf,'));
  const power = fs.readFileSync(new URL('../web/core/chat-power.js', import.meta.url), 'utf8');
  assert.ok(power.includes('A.paintJump?.(el, nb);'));
});

// Issue 1380: the target lands just under the ↑ pill while markers are left above it (else 8 px under the header).
const box = (top, h = 32, extra = {}) => ({ getBoundingClientRect: () => ({ top, bottom: top + h, height: h, left: 0, right: 100 }), ...extra });
test('landing gap: under the ↑ pill only while markers stay above the target', () => {
  const { jumpLandGap } = harness().api;
  const up = box(70, 32, { hidden: false }), nb = { parentElement: { querySelector: () => up }, querySelectorAll: () => [] };
  const t = { n: {}, y: -300 }, other = { n: {}, y: -900 };
  assert.equal(jumpLandGap(nb, { up: [t], down: [] }, t), 8, 'nothing left above: just under the header');
  assert.equal(jumpLandGap(nb, { up: [t, other], down: [] }, t), 8 + 32 + 8, 'one left above: under the pill');
  assert.equal(jumpLandGap(nb, { up: [t, { n: {}, y: -100 }], down: [] }, t), 8, 'a nearer marker below the target is no reason');
  // An amber line on screen now is above the target once the thread scrolls down to it.
  const line = box(200), down = { n: {}, y: 1400 };
  const nb2 = { parentElement: { querySelector: () => ({ hidden: true }) }, querySelectorAll: () => [line] };
  assert.equal(jumpLandGap(nb2, { up: [], down: [down] }, down), 8 + 32 + 8, 'a hidden pill falls back to its 32 px height');
});

// A fake button whose box follows its inline bottom (the pill) or --ch-latest-lift (↓ Latest), like the real layout.
const rect = (top, left, right, h = 32) => ({ top, bottom: top + h, height: h, left, right, width: right - left });
const btn = (top, left, right) => ({ getBoundingClientRect: () => rect(top, left, right, 34) });
const thread = acts => ({ querySelectorAll: q => (q === '.ch-tacts > button' ? acts : []), querySelector: () => null });
const pill = (top, left, right, acts = []) => { const p = { hidden: false, style: { bottom: '' }, cssBottom: '78px', closest: () => thread(acts) };
  p.getBoundingClientRect = () => rect(top - ((parseFloat(p.style.bottom) || 78) - 78), left, right); return p; };

test('the ↓ pill goes above ↓ Latest when they would overlap, and back when they do not', () => {
  const { jumpStack } = harness().api;
  const latest = { getBoundingClientRect: () => rect(790, 300, 390) };
  const a = pill(790, 250, 340); jumpStack(a, latest);
  assert.equal(a.style.bottom, `${78 + 822 - 790 + 8}px`, 'stacked 8 px above Latest');
  const b = pill(790, 20, 200); jumpStack(b, latest);
  assert.equal(b.style.bottom, '', 'side by side with room: left where the skin puts it');
  const c = pill(790, 250, 340); c.style.bottom = '118px'; jumpStack(c, null);
  assert.equal(c.style.bottom, '', 'Latest hidden: back to its own place');
});

// AI review of #1382: on a wide AI apps column the ↓ pill sat on Mark done (pill 686-842 x 790-822, Mark done 784-914 x 772-806).
test('the ↓ pill never sits on the thread\'s Mark done · Snooze · Archive row (issue 1380 kick-back)', () => {
  const { jumpStack } = harness().api;
  const acts = [btn(772, 784, 914), btn(772, 922, 1030), btn(772, 1038, 1150)];
  const a = pill(790, 686, 842, acts); jumpStack(a, null);
  const r = a.getBoundingClientRect();
  assert.ok(acts.every(o => r.bottom <= o.getBoundingClientRect().top - 4), `pill clear above the row (${r.top}-${r.bottom})`);
  assert.equal(a.style.bottom, `${78 + 822 - 772 + 8}px`, '8 px above the row');
  // Latest on the row too: the pill clears both, whichever it meets first.
  const latest = { getBoundingClientRect: () => rect(740, 700, 790) };
  const b = pill(790, 686, 842, acts); jumpStack(b, latest);
  const q = b.getBoundingClientRect();
  assert.ok(q.bottom <= 740 - 8, `pill above Latest and the row (${q.top}-${q.bottom})`);
  const c = pill(790, 100, 250, acts); jumpStack(c, null);
  assert.equal(c.style.bottom, '', 'beside the row with room: stays put');
});

test('↓ Latest rises above the action row only when it would cover a button (issue 1380 kick-back)', () => {
  const { liftLatest } = harness().api;
  const make = (top, left, right, acts, hidden = false) => { const props = {};
    const l = { hidden, style: { getPropertyValue: k => props[k] || '', setProperty: (k, v) => { props[k] = v; }, removeProperty: k => { delete props[k]; } } };
    l.getBoundingClientRect = () => rect(top - (parseFloat(props['--ch-latest-lift']) || 0), left, right);
    return { el: { querySelector: () => l, querySelectorAll: q => (q === '.ch-tacts > button' ? acts : []) }, l, props }; };
  // Narrow column, review numbers: Latest 952-1039 x 776-808 on Mark done 891-978 / Snooze 986-1094 x 772-806.
  const acts = [btn(772, 891, 978), btn(772, 986, 1094)];
  const n = make(776, 952, 1039, acts); liftLatest(n.el);
  assert.equal(n.props['--ch-latest-lift'], `${808 - 772 + 8}px`);
  const r = n.l.getBoundingClientRect(); assert.ok(r.bottom <= 772 - 8, 'Latest clear above the row');
  // Repaint: the old lift is dropped before measuring, so it never adds up.
  liftLatest(n.el); assert.equal(n.props['--ch-latest-lift'], `${808 - 772 + 8}px`);
  const w = make(776, 400, 490, acts); liftLatest(w.el);
  assert.equal(w.props['--ch-latest-lift'], undefined, 'clear of the row: no lift');
  const h = make(776, 952, 1039, acts, true); h.props['--ch-latest-lift'] = '44px'; liftLatest(h.el);
  assert.equal(h.props['--ch-latest-lift'], undefined, 'hidden: lift cleared');
});

// The real watcher from chats.js, with its closure names stubbed: a change made on another device (sort, pin order,
// a new channel such as Alerts) schedules one repaint of the lists on screen; an unchanged list schedules none.
function watcher() {
  const at = src.indexOf('  let chanListSig'), end = src.indexOf('  /* How far the owner has read a feed', at);
  assert.ok(at > 0 && end > at, 'chats.js watches the store list');
  let fn = null, paints = 0, st = null, on = true;
  const ctx = { LIVE: { onChange: f => { fn = f; } }, channelsOn: () => on, chanStore: () => st, chanReadPaint: () => { paints++; }, chanReadPaintT: 0,
    clearTimeout: () => {}, setTimeout: f => { f(); return 1; } };
  vm.createContext(ctx);
  vm.runInContext(src.slice(at, end), ctx);
  return { tick: s => { st = s; fn(); return paints; }, off: () => { on = false; } };
}
const ch1 = (id, extra = {}) => ({ id, agent: 'hermes', name: id, order: 0, createdAt: '', archived: false, pinned: false, count: 0, ...extra });
test('the channel lists repaint when the box\'s channels change, from this or another device (issue 1380)', () => {
  const w = watcher(), a = [ch1('launch'), ch1('voice')];
  assert.equal(w.tick(null), 0, 'store not answering yet: nothing to repaint');
  assert.equal(w.tick({ rev: 1, sort: 'az', channels: [ch1('alerts', { pinned: true, pinOrder: 0, kind: 'alerts' }), ...a] }), 1, 'first answer brings Alerts');
  assert.equal(w.tick({ rev: 2, sort: 'az', channels: [ch1('alerts', { pinned: true, pinOrder: 0, kind: 'alerts' }), ...a] }), 1, 'same list: no repaint');
  assert.equal(w.tick({ rev: 3, sort: 'za', channels: [ch1('alerts', { pinned: true, pinOrder: 0, kind: 'alerts' }), ...a] }), 2, 'another device chose Z-A');
  const pinned = [ch1('alerts', { pinned: true, pinOrder: 1, kind: 'alerts' }), ch1('launch', { pinned: true, pinOrder: 0 }), a[1]];
  assert.equal(w.tick({ rev: 4, sort: 'za', channels: pinned }), 3, 'another device pinned Launch');
  assert.equal(w.tick({ rev: 5, sort: 'za', channels: pinned.map(c => c.id === 'launch' ? { ...c, pinOrder: 1 } : c.id === 'alerts' ? { ...c, pinOrder: 0 } : c) }), 4, 'another device reordered the pins');
});

// Issue 1440: a channel's feed (its .ch-scroll list) uses the same pills; it counts marked posts, never messages.
test('feed: posts marked needs / new above or below the scroller count once each; on screen they drop out', () => {
  const { jumpFeed, jumpBand, jumpMarks } = harness().api;
  const post = (top, mark) => ({ dataset: { chmark: mark, morphKey: 'post:' + top }, getBoundingClientRect: () => ({ top, bottom: top + 80, height: 80 }) });
  const posts = [post(-400, 'needs'), post(-200, 'new'), post(-100, 'new'), post(300, 'needs'), post(900, 'new'), post(1200, 'needs')];
  const sc = { classList: { contains: c => c === 'ch-scroll' }, getBoundingClientRect: () => ({ top: 100, bottom: 800 }),
    querySelectorAll: q => (q === '.ch-post[data-chmark]' ? posts : []) };
  assert.equal(jumpFeed(sc), true); assert.equal(jumpFeed({ classList: { contains: () => false } }), false);
  const band = jumpBand(sc); assert.equal(band.sc, sc); assert.equal(band.top, 100); assert.equal(band.bottom, 800);
  const m = jumpMarks('w1', sc, band);
  assert.deepEqual([...m.up.map(x => x.kind)], ['needs', 'new', 'new'], 'above the band (the post at 300 is on screen: not counted)');
  assert.deepEqual([...m.down.map(x => x.kind)], ['new', 'needs'], 'below the band');
});
