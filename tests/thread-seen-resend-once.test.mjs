// wizard-ux issue 1428: the phone sent PUT /wizard/thread-seen about 6.6 times a second, each time with the same
// 138 KB state, and Chats never loaded. After every list read, live.js re-sent the whole state while any local record
// was newer than (or missing from) the box's copy. A record the box never keeps (past its 500 cap, a private thread it
// withholds) kept that true for ever. These tests run the real thread-seen block of web/live.js against a stand-in box.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const live = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
const cut = (a, b) => { const i = live.indexOf(a); assert.ok(i >= 0, a); const j = live.indexOf(b, i); assert.ok(j > i, b); return live.slice(i, j); };
const seenBlock = cut('  /* ---- thread-seen', '  /* ---- network');
const settle = () => new Promise(r => setImmediate(r));
const T = Date.UTC(2026, 10, 13, 6);

// The box: merges each PUT, keeps 500 by the later of seenAt/unreadAt, and never keeps or returns `drops` keys.
function harness({ drops = [], fail = () => false } = {}) {
  const store = new Map(), puts = [];
  let box = null;
  const ctx = {
    otherAgent: id => !!id && id !== 'hermes', MAX: 500, READY_OR_ATTENTION: new Set(['completed']),
    SEEN_BASE: 'wos.seen', SEEN_KEY: 'wos.seen:t',
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    Date, Math, JSON, Object, Array, Number, Promise, Error, Map,
  };
  vm.createContext(ctx);
  vm.runInContext(seenBlock + ';this.api={merge,resendSeen,readLocal,writeLocal,sameSeen};', ctx);
  const { merge } = ctx.api;
  const keep = s => ({ ...s, threads: Object.fromEntries(Object.entries(s.threads).filter(([k]) => !drops.includes(k))) });
  ctx.putSeen = async s => {
    puts.push(JSON.parse(JSON.stringify(s)));
    if (fail(puts.length)) throw new Error('502');
    box = merge(box, keep(JSON.parse(JSON.stringify(s)))); return JSON.parse(JSON.stringify(box));
  };
  const L = { seen: null, emits: 0, emit() { this.emits++; } };
  // One list read, as LIVE.refresh does it: GET, merge with this device's copy, then the re-send rule.
  const refresh = () => {
    const remote = box ? JSON.parse(JSON.stringify(box)) : null;
    const merged = merge(ctx.api.readLocal(), merge(L.seen, remote));
    L.seen = merged; ctx.api.writeLocal(merged);
    return ctx.api.resendSeen(L, merged, remote);
  };
  const seed = (threads) => { box = { initializedAt: 1, threads: JSON.parse(JSON.stringify(threads)) }; };
  return { ...ctx.api, ctx, L, puts, refresh, seed, box: () => box };
}
const rec = (seenAt, extra = {}) => ({ messageCount: 3, status: 'completed', updatedAt: new Date(T - 60e3).toISOString(), previewFingerprint: 'abc', seenAt, ...extra });

test('a record the box drops is sent once, not on every list read (main and routed rows)', async () => {
  for (const key of ['direct:gone', 'agent/host/direct:gone', 'agent/container/direct:gone', 'agent/restricted/direct:gone']) {
    const h = harness({ drops: [key] });
    h.seed({ 'direct:kept': rec(T - 5000) });
    h.L.seen = { initializedAt: 1, threads: { 'direct:kept': rec(T - 5000), [key]: rec(T) } };
    for (let i = 0; i < 20; i++) { await h.refresh(); await settle(); }
    assert.equal(h.puts.length, 1, key + ': one PUT, not one per list read');
    assert.ok(h.puts[0].threads[key], key + ': the PUT carried the record');
    assert.equal(h.L.emits, 0, key + ': a reply that changes nothing here does not repaint');
    assert.ok(h.L.seen.threads[key], key + ': the read is kept on this device');
  }
});

test('a newer read of that record is sent again, once', async () => {
  const h = harness({ drops: ['direct:gone'] });
  h.seed({});
  h.L.seen = { initializedAt: 1, threads: { 'direct:gone': rec(T) } };
  for (let i = 0; i < 5; i++) { await h.refresh(); await settle(); }
  h.L.seen = { ...h.L.seen, threads: { ...h.L.seen.threads, 'direct:gone': rec(T + 1000) } }; h.writeLocal(h.L.seen);
  for (let i = 0; i < 5; i++) { await h.refresh(); await settle(); }
  assert.equal(h.puts.length, 2);
});

test('only one re-send is in flight at a time', async () => {
  const h = harness({ drops: ['direct:gone'] });
  h.seed({});
  h.L.seen = { initializedAt: 1, threads: { 'direct:gone': rec(T) } };
  h.refresh(); h.refresh(); h.refresh();
  await settle();
  assert.equal(h.puts.length, 1);
});

test('a failed write is tried again on a later list read, then stops once the box has it', async () => {
  const h = harness({ fail: n => n === 1 });
  h.seed({});
  h.L.seen = { initializedAt: 1, threads: { 'direct:mine': rec(T) } };
  await h.refresh(); await settle();
  assert.equal(h.puts.length, 1);
  await h.refresh(); await settle();
  assert.equal(h.puts.length, 2, 'retried after the failure');
  assert.ok(h.box().threads['direct:mine'], 'the box has it now');
  for (let i = 0; i < 5; i++) { await h.refresh(); await settle(); }
  assert.equal(h.puts.length, 2, 'and nothing more is sent');
});

test('a reply that brings something new still repaints', async () => {
  const h = harness();
  h.seed({});
  h.L.seen = { initializedAt: 1, threads: { 'direct:mine': rec(T) } };
  const done = h.refresh();
  // Another device read a thread while this write was in flight: the box's reply carries it.
  const real = h.ctx.putSeen;
  await done; await settle();
  assert.equal(h.puts.length, 1);
  h.ctx.putSeen = async s => { const r = await real(s); r.threads['direct:other'] = rec(T + 5); return r; };
  h.L.seen = { ...h.L.seen, threads: { ...h.L.seen.threads, 'direct:mine': rec(T + 10) } }; h.writeLocal(h.L.seen);
  await h.refresh(); await settle();
  assert.equal(h.L.emits, 1);
  assert.ok(h.L.seen.threads['direct:other']);
});

test('at the 500 cap this device keeps the same records as the box (later of seenAt and unreadAt)', () => {
  const h = harness();
  const threads = {};
  for (let i = 0; i < 500; i++) threads['direct:t' + String(i).padStart(3, '0')] = rec(T - 1000 + i);
  // Marked unread just now, read long ago: the box keeps it, so this device must too.
  const extra = { 'direct:unread': rec(T - 9e6, { unreadAt: T + 10 }) };
  const merged = h.merge({ initializedAt: 1, threads }, { initializedAt: 1, threads: extra });
  assert.equal(Object.keys(merged.threads).length, 500);
  assert.ok(merged.threads['direct:unread'], 'the record marked unread is kept');
  assert.equal(merged.threads['direct:t000'], undefined, 'the oldest read is the one dropped');
});

test('LIVE.refresh uses the once-per-version re-send', () => {
  const refresh = cut('    async refresh() {', '    async refreshAgents(');
  assert.match(refresh, /resendSeen\(this, merged, remote\);/);
  assert.doesNotMatch(refresh, /some\(\(\[key,r\]\)=>r\.seenAt>/);
});
