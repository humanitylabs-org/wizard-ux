// wizard-os issue 1020: a desktop sent PUT /wizard/thread-seen 21 times in one minute and the shell's write guard
// paused it. The desktop marks the open thread read on every Live repaint while it still reads unread, so any read
// that did not stick wrote once per repaint. Two such reads, and the once-per-change rule that keeps any other one
// from looping. These run the real web/live-seen.js and web/core/chats-bind.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const src = f => readFileSync(new URL(`../web/${f}`, import.meta.url), 'utf8');
function seenParts() {
  const ctx = { window: {}, localStorage: { getItem: () => null, setItem() {} } };
  vm.createContext(ctx); vm.runInContext(src('live-seen.js'), ctx);
  const S = ctx.window.WizCore.liveParts.seen({});
  S.bindLate({ otherAgent: a => !!a && a !== 'hermes', putSeen: null });
  return S;
}
const S = seenParts();
const NOW = Date.UTC(2026, 10, 27, 14, 10), iso = t => new Date(t).toISOString();
const state = threads => ({ initializedAt: NOW - 864e5, threads });
// LIVE.markSeen, then the box's answer merged back (the Agent Service keeps the later record, max seenAt/unreadAt).
function markRead(row, box, at = NOW) {
  const k = S.seenKeyOf(row), local = state({ ...(box?.threads || {}) });
  local.threads[k] = S.seenRecord(local.threads[k], row, at);
  const answer = S.merge(box, local);
  return S.merge(local, answer);
}

test('A: a row older than its read record (read later elsewhere) reads as read once marked, and stays so', () => {
  // No assistant time (the owner's own message is newest), no count, a different preview, no status on the record.
  const row = { runtime: 'direct', id: 'a', updatedAt: iso(NOW - 600e3), preview: 'An older question on screen', status: 'completed' };
  const box = state({ 'direct:a': { updatedAt: iso(NOW - 60e3), previewFingerprint: 'zz9', seenAt: NOW - 50e3 } });
  const after = markRead(row, box);
  assert.equal(S.hasNew(row, after), false, 'marked read, the older row no longer reads unread');
  // Compaction: the newer record holds a lower count than the older row.
  const row2 = { runtime: 'direct', id: 'c', updatedAt: iso(NOW - 600e3), preview: 'x', messageCount: 9, status: 'completed' };
  const box2 = state({ 'direct:c': { updatedAt: iso(NOW - 60e3), messageCount: 5, status: 'completed', previewFingerprint: 'zz9', seenAt: NOW - 50e3 } });
  assert.equal(S.hasNew(row2, markRead(row2, box2)), false);
});

test('A: a newer row than the read record still reads unread (new replies are never swallowed)', () => {
  const box = state({ 'direct:a': { updatedAt: iso(NOW - 600e3), previewFingerprint: S.fingerprint('old'), seenAt: NOW - 500e3 } });
  assert.equal(S.hasNew({ runtime: 'direct', id: 'a', updatedAt: iso(NOW - 60e3), preview: 'a new reply' }, box), true);
  const box2 = state({ 'direct:c': { updatedAt: iso(NOW - 600e3), messageCount: 3, previewFingerprint: 'zz9', seenAt: NOW - 500e3 } });
  assert.equal(S.hasNew({ runtime: 'direct', id: 'c', updatedAt: iso(NOW - 60e3), preview: 'x', messageCount: 4 }, box2), true);
  const box3 = state({ 'direct:d': { updatedAt: iso(NOW - 600e3), previewFingerprint: 'zz9', assistantActivityAt: iso(NOW - 600e3), seenAt: NOW - 500e3 } });
  assert.equal(S.hasNew({ runtime: 'direct', id: 'd', updatedAt: iso(NOW - 60e3), lastAssistantAt: iso(NOW - 60e3), preview: 'r' }, box3), true);
});

test('B: reading a thread lands past an unread mark made on a device whose clock runs ahead', () => {
  const row = { runtime: 'direct', id: 'b', updatedAt: iso(NOW - 900e3), lastAssistantAt: iso(NOW - 900e3), preview: 'A reply', messageCount: 2, status: 'completed' };
  const box = state({ 'direct:b': { ...S.recordFor(row, NOW - 800e3), unreadAt: NOW + 300e3 } });
  assert.equal(S.hasNew(row, box), true, 'marked unread on the fast phone');
  const after = markRead(row, box);
  assert.equal(S.hasNew(row, after), false, 'read here, at an earlier clock time, it is read on the box too');
  // Marking it unread again afterwards still works (markUnread lands past the last read).
  const rec = after.threads['direct:b'];
  assert.equal(S.hasNew(row, state({ 'direct:b': { ...rec, unreadAt: rec.seenAt + 1 } })), true);
});

test('the desktop marks an open thread read once per change of it, not on every Live repaint', () => {
  const marks = [], listeners = [];
  let unread = true, row = { id: 't1', updatedAt: iso(NOW - 60e3), lastAssistantAt: iso(NOW - 60e3), preview: 'r1', status: 'completed' };
  const LIVE = { ok: true, isNew: () => unread, markSeen: r => marks.push(r), session: () => row, seenRecord: () => null };
  const W = { w1: { id: 'w1', app: 'chats', thread: 't1' } };
  const ctx = {
    window: {}, Date, JSON, Map, Object, setTimeout: () => 0,
    addEventListener: (t, fn) => listeners.push(fn), document: { hidden: false, addEventListener() {} },
  };
  vm.createContext(ctx); vm.runInContext(src('core/chats-bind.js'), ctx);
  const api = ctx.window.WizCore.chatsParts.bind({ LIVE, W, desks: [{ wins: ['w1'] }], idx: 0, ch: () => ({}), isHosted: () => false, chanSeenRow: (_, sid) => sid });
  // A read that does not stick (the thread still reads unread after every mark): 50 repaints, one write.
  for (let i = 0; i < 50; i++) api.markVisibleThreadsSeen();
  assert.equal(marks.length, 1);
  // A new reply is a change: marked read again, once.
  row = { ...row, updatedAt: iso(NOW), lastAssistantAt: iso(NOW), preview: 'r2' };
  for (let i = 0; i < 10; i++) api.markVisibleThreadsSeen();
  assert.equal(marks.length, 2);
  // Read and unchanged: nothing to write.
  unread = false; api.markVisibleThreadsSeen(); assert.equal(marks.length, 2);
  // Marked unread elsewhere after that: the thread on screen is marked read again (the existing rule), once.
  unread = true; LIVE.seenRecord = () => ({ unreadAt: NOW + 1 });
  for (let i = 0; i < 10; i++) api.markVisibleThreadsSeen();
  assert.equal(marks.length, 3);
});
