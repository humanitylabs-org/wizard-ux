// Channels "seeing is reading" (wizard-ux issue 1266) on two devices: the feed writes the same per-chat seen record
// as opening a thread (live.js recordFor / merge, the /wizard/thread-seen state). A stale device and two devices
// writing at once must never erase a newer reply or a newer unread mark (AGENTS.md: synced across devices).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const live = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
const cut = (a, b) => { const i = live.indexOf(a); assert.ok(i >= 0, a); return live.slice(i, live.indexOf(b, i)); };
const ctx = { otherAgent: id => !!id && id !== 'hermes', MAX: 500, READY_OR_ATTENTION: new Set(['completed', 'failed', 'interrupted', 'waiting_for_approval', 'unknown']) };
vm.createContext(ctx);
vm.runInContext(cut('  /* ---- thread-seen', '  function readLocal') + ';this.api={recordFor,hasNew,merge,seenKeyOf};', ctx);
const { recordFor, hasNew, merge, seenKeyOf } = ctx.api;
const T = Date.UTC(2026, 10, 11, 4);
const row = (n, extra = {}) => ({ id: 'jonathan', runtime: 'direct', status: 'completed', messageCount: n, updatedAt: new Date(T).toISOString(), lastAssistantAt: new Date(T + n * 1000).toISOString(), preview: 'reply ' + n, ...extra });
// The box merges every PUT into its state (the Agent Service keeps the later record per key, like live.js merge).
function box() { let state = { initializedAt: 1, threads: {} }; return { put: s => (state = merge(state, s)), get: () => state }; }
const write = (b, s, rec) => b.put({ initializedAt: 1, threads: { [seenKeyOf(s)]: rec } });

test('a stale device whose feed shows an older revision marks it read; a reply that came after stays unread', () => {
  const b = box(), old = row(4), fresh = row(6);
  write(b, old, recordFor(old, T + 10e3));          // phone A, list not refreshed yet, scrolls past the post
  assert.equal(hasNew(old, b.get()), false, 'what A saw is read');
  assert.equal(hasNew(fresh, b.get()), true, 'the newer reply B already has stays unread on every device');
});

test('read on one device and unread on another at once: the later mark wins on both, whichever PUT lands first', () => {
  const s = row(4);
  for (const order of [['read', 'unread'], ['unread', 'read']]) {
    const b = box(), read = recordFor(s, T + 20e3);                       // A's feed saw it at T+20s
    const unread = { ...recordFor(s, 0), unreadAt: T + 30e3 };            // B marked it unread at T+30s
    for (const k of order) write(b, s, k === 'read' ? read : unread);
    assert.equal(hasNew(s, b.get()), true, order.join(' then ') + ': the newer unread mark survives');
  }
  const b = box();
  write(b, s, { ...recordFor(s, 0), unreadAt: T + 30e3 }); write(b, s, recordFor(s, T + 40e3));
  assert.equal(hasNew(s, b.get()), false, 'seen after the unread mark: read');
});

test('routed rows keep their own record: seeing a host-profile, container or restricted post never reads the main thread', () => {
  for (const agent of ['host', 'container', 'restricted']) {
    const b = box(), main = row(4), routed = row(4, { agent });
    write(b, routed, recordFor(routed, T + 10e3));
    assert.equal(hasNew(routed, b.get()), false, agent);
    assert.equal(hasNew(main, b.get()), true, agent + ': the main thread sharing its id is still unread');
  }
});
