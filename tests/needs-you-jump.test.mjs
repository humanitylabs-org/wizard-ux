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
  vm.createContext(ctx);
  vm.runInContext(block + '\nthis.api = { jumpOpened, jumpPillsHtml, jumpTarget, jumpLabel };', ctx);
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
