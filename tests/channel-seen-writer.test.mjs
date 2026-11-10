// wizard-ux issue 1266 review: the real LIVE.markSeen writer (web/live.js) and LIVE.threadRows, not only their helpers.
// A Channels feed can mark a row read from a list read older than the record this device already has: that must
// never turn an already-read newer revision unread again, also when the PUT to the box fails. A thread longer than
// threadRows' page ceiling comes back marked truncated rather than silently cut.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const live = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
const cut = (a, b) => { const i = live.indexOf(a); assert.ok(i >= 0, a); const j = live.indexOf(b, i); assert.ok(j > i, b); return live.slice(i, j); };
const seenBlock = cut('  /* ---- thread-seen', '  /* ---- network');
const markSeen = cut('    markSeen(ids) {', '    async markUnread(ids) {');
const threadRows = cut('    async threadRows(id, agent = \'\') {', '    // When this row was last read');
const rowsMax = live.match(/const THREAD_ROWS_MAX = (\d+);/) || [0, '50000'];

function harness({ put = async s => s } = {}) {
  const store = new Map(), puts = [], reqs = [];
  const ctx = {
    otherAgent: id => !!id && id !== 'hermes', MAX: 500, READY_OR_ATTENTION: new Set(['completed', 'failed', 'interrupted', 'waiting_for_approval', 'unknown']),
    SEEN_BASE: 'wos.seen', SEEN_KEY: 'wos.seen:t', THREAD_ROWS_MAX: Number(rowsMax[1]),
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    putSeen: s => { puts.push(JSON.parse(JSON.stringify(s))); return put(s); },
    pages: null,
    req: async path => { reqs.push(path); const off = Number(/offset=(\d+)/.exec(path)[1]); const page = ctx.pages(off); return { json: async () => ({ data: page, pagination: { returned: page.length } }) }; },
    encodeURIComponent, Date, Math, JSON, Object, Array, Number, Promise, Error,
  };
  vm.createContext(ctx);
  vm.runInContext(seenBlock + `;this.L={ seen: null, emits: 0, rows: {}, emit() { this.emits++; }, session(id) { return this.rows[id] || null; },\n${markSeen}\n${threadRows}\n};this.api={recordFor,hasNew,seenKeyOf,readLocal};`, ctx);
  return { ...ctx.api, L: ctx.L, ctx, store, puts, reqs };
}
const T = Date.UTC(2026, 10, 11, 4);
const row = (n, extra = {}) => ({ id: 'jonathan', runtime: 'direct', status: 'completed', messageCount: n, updatedAt: new Date(T + n * 1000).toISOString(), lastAssistantAt: new Date(T + n * 1000).toISOString(), preview: 'reply ' + n, ...extra });
const settle = () => new Promise(r => setImmediate(r));

test('marking a stale row (revision 4) read keeps revision 6 read: the newer known revision is not regressed', async () => {
  const h = harness(), r6 = row(6), r4 = row(4);
  h.L.markSeen([r6]); await settle();
  assert.equal(h.hasNew(r6, h.L.seen), false, 'revision 6 read');
  h.L.markSeen([r4]); await settle();
  assert.equal(h.hasNew(r6, h.L.seen), false, 'still read after the stale mark');
  assert.equal(h.hasNew(r6, h.readLocal()), false, 'and in what this device keeps (a reload)');
  assert.equal(h.hasNew(row(7), h.L.seen), true, 'a reply newer than both stays unread');
  const rec = h.L.seen.threads[h.seenKeyOf(r6)];
  assert.equal(rec.messageCount, 6); assert.equal(rec.assistantActivityAt, r6.lastAssistantAt);
  assert.equal(h.puts.at(-1).threads[h.seenKeyOf(r6)].messageCount, 6, 'the box is sent the newer revision too');
});

test('a rejected PUT leaves no regressed record on this device', async () => {
  const h = harness({ put: async () => { throw new Error('offline'); } }), r6 = row(6), r4 = row(4);
  h.L.markSeen([r6]); await settle();
  h.L.markSeen([r4]); await settle();
  assert.equal(h.puts.length, 2);
  assert.equal(h.hasNew(r6, h.readLocal()), false, 'persisted state keeps revision 6 read');
  assert.equal(h.hasNew(r6, h.L.seen), false);
});

test('marking read still clears an unread mark, and a never-seen row is read as of now', async () => {
  const h = harness(), r = row(4);
  h.L.seen = { initializedAt: 1, threads: { [h.seenKeyOf(r)]: { ...h.recordFor(r, T), unreadAt: T + 5e3 } } };
  assert.equal(h.hasNew(r, h.L.seen), true);
  h.L.markSeen([r]); await settle();
  assert.equal(h.hasNew(r, h.L.seen), false);
  assert.equal(h.L.seen.threads[h.seenKeyOf(r)].unreadAt, undefined);
  const fresh = row(2, { id: 'other' }); h.L.markSeen([fresh]); await settle();
  assert.equal(h.hasNew(fresh, h.L.seen), false);
});

test('routed rows: a stale mark on a host-profile, container or restricted row keeps its own newer revision, not the main one', async () => {
  for (const agent of ['host', 'container', 'restricted']) {
    const h = harness(), main = row(6), r6 = row(6, { agent }), r4 = row(4, { agent });
    h.L.markSeen([r6]); await settle(); h.L.markSeen([r4]); await settle();
    assert.equal(h.hasNew(r6, h.L.seen), false, agent);
    assert.equal(h.hasNew(main, h.L.seen), true, agent + ': the main thread sharing its id is untouched');
  }
});

test('threadRows reads past 5,000 rows to the end; past its ceiling it says truncated', async () => {
  const h = harness(), total = 5001;
  h.ctx.pages = off => Array.from({ length: Math.max(0, Math.min(500, total - off)) }, (_, i) => ({ i: off + i }));
  const rows = await h.L.threadRows('jonathan');
  assert.equal(rows.length, 5001, 'the 5,001st row (the only visible answer, say) is there');
  assert.notEqual(rows.truncated, true);
  const big = harness(); big.ctx.pages = () => Array.from({ length: 500 }, () => ({}));
  const all = await big.L.threadRows('jonathan', 'host');
  assert.equal(all.truncated, true); assert.equal(all.length, Number(rowsMax[1]));
  assert.match(big.reqs[0], /agent=host/);
});
