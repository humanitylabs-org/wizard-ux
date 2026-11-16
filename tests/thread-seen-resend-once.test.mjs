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
// It uses live.js's own merge (the Agent Service keeps the later record per key the same way). race(n) holds the next
// n PUTs until all n arrived, so two devices' writes interleave.
function makeBox({ drops = [], fail = () => false } = {}) {
  const b = { state: null, puts: [], held: 0, waiters: [], merge: null };
  b.race = (n = 2) => { b.held = n; };
  b.put = async s => {
    const body = JSON.parse(JSON.stringify(s));
    if (b.held > 0) { b.held--; await new Promise(r => { b.waiters.push(r); if (b.held === 0) b.waiters.splice(0).forEach(f => f()); }); }
    b.puts.push(body);
    if (fail(b.puts.length)) throw new Error('502');
    b.state = b.merge(b.state, { ...body, threads: Object.fromEntries(Object.entries(body.threads).filter(([k]) => !drops.includes(k))) });
    return JSON.parse(JSON.stringify(b.state));
  };
  b.get = () => b.state ? JSON.parse(JSON.stringify(b.state)) : null;
  return b;
}
function harness(opts = {}, shared = null) {
  const box = shared || makeBox(opts), store = new Map();
  const ctx = {
    otherAgent: id => !!id && id !== 'hermes', MAX: 500, READY_OR_ATTENTION: new Set(['completed']),
    SEEN_BASE: 'wos.seen', SEEN_KEY: 'wos.seen:t',
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    Date, Math, JSON, Object, Array, Number, Promise, Error, Map,
  };
  vm.createContext(ctx);
  vm.runInContext(seenBlock + ';this.api={merge,resendSeen,readLocal,writeLocal,sameSeen,hasNew};', ctx);
  const { merge } = ctx.api;
  box.merge ||= merge;
  ctx.putSeen = s => box.put(s);
  const L = { seen: null, emits: 0, emit() { this.emits++; } };
  // One list read, as LIVE.refresh does it: GET, merge with this device's copy, then the re-send rule.
  const refresh = () => {
    const remote = box.get();
    const merged = merge(ctx.api.readLocal(), merge(L.seen, remote));
    L.seen = merged; ctx.api.writeLocal(merged);
    return ctx.api.resendSeen(L, merged, remote);
  };
  const seed = (threads) => { box.state = { initializedAt: 1, threads: JSON.parse(JSON.stringify(threads)) }; };
  return { ...ctx.api, ctx, L, puts: box.puts, refresh, seed, box: () => box.state, shared: box };
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
  await done; await settle();
  assert.equal(h.puts.length, 1);
  const real = h.ctx.putSeen;
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

// Two devices, one box (AGENTS.md "Synced across devices"): a stale device and two writes at once.
const row = (n, extra = {}) => ({ id: 'jonathan', runtime: 'direct', status: 'completed', messageCount: n, updatedAt: new Date(T + n * 1000).toISOString(), lastAssistantAt: new Date(T + n * 1000).toISOString(), preview: 'reply ' + n, ...extra });
for (const agent of ['', 'host', 'container', 'restricted']) {
  const key = (agent ? `agent/${agent}/` : '') + 'direct:jonathan', tag = agent || 'main';
  test(`${tag}: a stale device's re-send never undoes a newer read from the other device`, async () => {
    const box = makeBox(), a = harness({}, box), b = harness({}, box);
    a.seed({});
    // Phone B read revision 4 while offline; laptop A has since read revision 6 and the box has it.
    b.L.seen = { initializedAt: 1, threads: { [key]: rec(T + 1000, { messageCount: 4, updatedAt: row(4).updatedAt, assistantActivityAt: row(4).lastAssistantAt }) } };
    b.writeLocal(b.L.seen);
    await a.ctx.putSeen({ initializedAt: 1, threads: { [key]: rec(T + 9000, { messageCount: 6, updatedAt: row(6).updatedAt, assistantActivityAt: row(6).lastAssistantAt }) } });
    for (let i = 0; i < 5; i++) { await b.refresh(); await settle(); }
    const r6 = row(6, agent ? { agent } : {});
    assert.equal(a.hasNew(r6, box.state), false, 'the box still has revision 6 read');
    assert.equal(b.hasNew(r6, b.L.seen), false, 'and the stale device takes it');
    assert.equal(box.state.threads[key].messageCount, 6);
  });
  test(`${tag}: read on one device and marked unread on the other at once keeps the later mark on both`, async () => {
    const box = makeBox(), a = harness({}, box), b = harness({}, box);
    a.seed({ [key]: rec(T) });
    // A has a read newer than the box (a write that failed earlier); B marks the thread unread after that read.
    a.L.seen = { initializedAt: 1, threads: { [key]: rec(T + 1000) } }; a.writeLocal(a.L.seen);
    box.race(2);
    const both = Promise.all([a.refresh(), b.ctx.putSeen({ initializedAt: 1, threads: { [key]: rec(T, { unreadAt: T + 2000 }) } })]);
    await both; await settle();
    for (let i = 0; i < 3; i++) { await a.refresh(); await b.refresh(); await settle(); }
    for (const [who, d] of [['A', a], ['B', b], ['box', null]]) {
      const r = (d ? d.L.seen : box.state).threads[key];
      assert.equal(r.unreadAt, T + 2000, who + ' keeps the unread mark'); assert.equal(r.seenAt, T + 1000, who + ' keeps the read time');
    }
    assert.equal(box.puts.length, 2, 'one re-send from A, the unread mark from B, nothing more');
  });
}

test('two devices that both hold a record the box drops each send it once', async () => {
  const box = makeBox({ drops: ['direct:gone'] }), a = harness({}, box), b = harness({}, box);
  a.seed({});
  for (const d of [a, b]) { d.L.seen = { initializedAt: 1, threads: { 'direct:gone': rec(T) } }; d.writeLocal(d.L.seen); }
  for (let i = 0; i < 10; i++) { await a.refresh(); await b.refresh(); await settle(); }
  assert.equal(box.puts.length, 2);
});

test('LIVE.refresh uses the once-per-version re-send', () => {
  const refresh = cut('    async refresh() {', '    async refreshAgents(');
  assert.match(refresh, /resendSeen\(this, merged, remote\);/);
  assert.doesNotMatch(refresh, /some\(\(\[key,r\]\)=>r\.seenAt>/);
});
