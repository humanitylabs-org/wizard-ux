import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
// Priority must actually reorder Ready: every status line ranks (Done below FYI, no status last), and the list
// shows one header per group. Before: only needs you / check ranked, so a Ready of Done + FYI read like Newest.
const live = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
const chats = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const block = (src, from, to) => { const i = src.indexOf(from); assert.ok(i >= 0, from); return src.slice(i, src.indexOf(to, i)); };
const at = m => `2026-10-29T0${m}:00:00Z`;
const rows = [
  { id: 'a', attention: { state: 'done' }, updatedAt: at(6) },
  { id: 'b', attention: { state: 'fyi' }, updatedAt: at(5) },
  { id: 'c', updatedAt: at(4) },
  { id: 'd', attention: { state: 'check' }, updatedAt: at(3) },
  { id: 'e', attention: { state: 'done' }, updatedAt: at(2) },
  { id: 'f', attention: { state: 'fyi' }, updatedAt: at(1) },
  { id: 'g', attention: { state: 'needs_you' }, updatedAt: at(0) },
  { id: 'h', status: 'waiting_for_approval', updatedAt: at(0) },
];
function liveCtx() {
  const c = vm.createContext({ snoozeLast: () => false, needsApproval: s => ['waiting_for_approval', 'unknown'].includes(s.status), newestFirst: (l, r) => Date.parse(r.updatedAt) - Date.parse(l.updatedAt) });
  vm.runInContext(block(live, '  const isDeferred =', '  // Oldest (James') + '\nthis.readyRank = readyRank; this.byPriority = byPriority;', c);
  return c;
}
test('Priority ranks needs you, your call, FYI, Done, then no status (newest first inside each)', () => {
  const c = liveCtx();
  assert.deepEqual(c.byPriority(rows).map(s => s.id), ['h', 'g', 'd', 'b', 'f', 'a', 'e', 'c']);
  assert.ok(c.readyRank({ attention: { state: 'fyi' } }) < c.readyRank({ attention: { state: 'done' } }));
  assert.ok(c.readyRank({ attention: { state: 'done' } }) < c.readyRank({}));
  assert.equal(c.readyRank({ deferred: true, deferredAt: at(1) }), 9, 'snoozed stays last');
});
test('Priority renders one header per group with its count; Newest/Oldest stay ungrouped', () => {
  const L = liveCtx();
  const c = vm.createContext({ LIVE: { readyRank: L.readyRank }, esc: String, attOf: s => s.attention, deferredOf: () => false, readyOrder: 'priority' });
  vm.runInContext(block(chats, '  const noteAt =', '  const noteOrder =') + block(chats, '  function noteBefore(', '  const notePlain') + block(chats, '  function withNotes(', '  /* Android Back') + '\nthis.priorityGroups = priorityGroups;', c);
  c.LIVE.cardAt = s => s.updatedAt;
  const html = c.priorityGroups(L.byPriority(rows), [], s => `<row ${s.id}>`, 'ready');
  const heads = [...html.matchAll(/<span>([^<]+)<\/span><small>(\d+)<\/small>/g)].map(m => `${m[1]} ${m[2]}`);
  assert.deepEqual(heads, ['Needs approval 1', 'Needs you 1', 'Your call 1', 'FYI 2', 'Done 2', 'No status 1']);
  assert.deepEqual([...html.matchAll(/<row (\w)>/g)].map(m => m[1]), ['h', 'g', 'd', 'b', 'f', 'a', 'e', 'c']);
  assert.match(chats, /if \(readyOrder === 'priority'\) return top \+ priorityGroups\(list, awake, rowFn, sec\) \+ later;/);
});
