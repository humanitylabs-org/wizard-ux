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
    CH, ch: id => (CH[id] = CH[id] || {}), needsThreadOn: () => on,
    LIVE: {
      session: id => rows[id] || null,
      isNew: s => !!s.unread,
      seenRecord: s => seen[(s.agent && s.agent !== 'hermes' ? `agent/${s.agent}/` : '') + s.id],
    },
  };
  ctx.getComputedStyle = el => ({ bottom: el.cssBottom });
  vm.createContext(ctx);
  vm.runInContext(block + '\nthis.api = { jumpOpened, jumpPillsHtml, jumpTarget, jumpLabel, jumpLandGap, jumpStack };', ctx);
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

test('the ↓ pill goes above ↓ Latest when they would overlap, and back when they do not', () => {
  const { jumpStack } = harness().api;
  const pill = (top, left, right) => ({ style: { bottom: '' }, cssBottom: '78px', getBoundingClientRect: () => ({ top, bottom: top + 32, height: 32, left, right }) });
  const latest = { getBoundingClientRect: () => ({ top: 790, bottom: 822, height: 32, left: 300, right: 390 }) };
  const a = pill(790, 250, 340); jumpStack(a, latest);
  assert.equal(a.style.bottom, `${78 + 822 - 790 + 8}px`, 'stacked 8 px above Latest');
  const b = pill(790, 20, 200); jumpStack(b, latest);
  assert.equal(b.style.bottom, '', 'side by side with room: left where the skin puts it');
  const c = pill(790, 250, 340); c.style.bottom = '118px'; jumpStack(c, null);
  assert.equal(c.style.bottom, '', 'Latest hidden: back to its own place');
});

test('the shells redraw the channel list when the box\'s channels change (issue 1380)', () => {
  const at = src.indexOf('let chanListSig');
  assert.ok(at > 0, 'chats.js watches the store list');
  const tail = src.slice(at, at + 600);
  assert.match(tail, /LIVE\?\.onChange\?\.\(/);
  assert.match(tail, /chanReadPaint/);
});
