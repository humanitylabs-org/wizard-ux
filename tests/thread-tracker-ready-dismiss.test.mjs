import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
const live = process.env.QA_BASELINE ? execFileSync('git', ['show', `${process.env.QA_BASELINE}:web/live.js`], { encoding: 'utf8' }) : readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
for (const accepted of [true, false]) test(`Ready Done paints immediately but ${accepted ? 'persists matching Seen' : 'rolls back stale Seen'}`, async () => {
  const row = { id: 't', archived: false }, writes = [];
  const ctx = { OVER: new Map(), hasNew: () => false, readRestored: () => ({}), writeRestored() {},
    req: async (path, init) => { writes.push({path, body: JSON.parse(init.body)}); }, aq: () => '', J: {},
    Date, setTimeout() {}, clearTimeout() {}, encodeURIComponent };
  const methods = vm.runInNewContext('({' + live.slice(live.indexOf('    busy(id)'), live.indexOf('    // Stop exactly the watcher')) + '})', ctx);
  const L = { ...methods, session: () => row, seenOf: () => null, emit() {}, refresh() {} };
  let confirm; const confirmed = new Promise(r => { confirm = r; });
  const result = L.archive('t', { confirmed });
  assert.equal(row.archived, true, 'same-frame Done projection');
  assert.equal(writes.length, 0, 'no archive request before Seen validates');
  confirm(accepted);
  assert.equal(await result, accepted);
  assert.equal(row.archived, accepted);
  assert.equal(writes.length, accepted ? 1 : 0);
  if (accepted) { assert.equal(writes[0].path, '/wizard/hermes/api/sessions/t'); assert.deepEqual(writes[0].body, { archived: true }); }
});

// A refused or stale tracker Dismiss must not mark a newer ordinary reply read (independent review of #1074).
const helpers = live.slice(live.indexOf('  const vis ='), live.indexOf('  function later('));
const laterFn = live.slice(live.indexOf('  function later('), live.indexOf('  function merge('));
const seenMethods = '({' + live.slice(live.indexOf('    busy(id)'), live.indexOf('    // Stop exactly the watcher')) + live.slice(live.indexOf('    markSeen(ids'), live.indexOf('    async markUnread(ids)')) + '})';
async function unreadHarness({ confirmedPromise, mutateDuring }) {
  const at = 1793972000000, fresh = new Date(at - 1000).toISOString(), old = new Date(at - 20000).toISOString();
  const row = { id: 't', runtime: 'direct', archived: false, preview: 'A newer reply', previewRole: 'assistant', previewAt: fresh, lastAssistantAt: fresh, messageCount: 4, updatedAt: fresh, status: 'completed' };
  const writes = [], local = [];
  const ctx = vm.createContext({ OVER: new Map(), READY_OR_ATTENTION: new Set(['completed']), otherAgent: a => !!a && a !== 'hermes', readRestored: () => ({}), writeRestored() {},
    req: async (path, init) => { writes.push({ kind: 'archive', path, body: JSON.parse(init.body) }); }, aq: () => '', J: {},
    Date: class extends Date { static now() { return at; } }, setTimeout() {}, clearTimeout() {}, encodeURIComponent, MAX: 500,
    readLocal: () => local.at(-1) || null, writeLocal: s => local.push(JSON.parse(JSON.stringify(s))),
    putSeen: async s => { writes.push({ kind: 'seen', state: JSON.parse(JSON.stringify(s)) }); return s; } });
  vm.runInContext(helpers + laterFn + '\nglobalThis.isNew=hasNew;globalThis.merge=(a,b)=>{if(!a)return b;if(!b)return a;const threads={...a.threads};for(const[k,r]of Object.entries(b.threads))threads[k]=later(threads[k],r);return{initializedAt:Math.min(a.initializedAt,b.initializedAt),threads}};', ctx);
  const m = vm.runInContext(seenMethods, ctx);
  const L = { ...m, session: () => row, seen: { initializedAt: at - 20000, threads: { 'direct:t': { seenAt: at - 20000, updatedAt: old, assistantActivityAt: old, messageCount: 2, status: 'completed' } } }, seenOf() { return this.seen; }, emit() {}, refresh() {} };
  assert.equal(ctx.isNew(row, L.seen), true);
  let release; const confirmed = new Promise(r => { release = r; });
  const p = L.archive('t', { confirmed });
  const during = { unread: ctx.isNew(row, L.seen), seenWrites: writes.filter(w => w.kind === 'seen').length, local: local.length };
  mutateDuring?.(row, at);
  release(confirmedPromise); const result = await p; await new Promise(r => setImmediate(r));
  return { L, ctx, row, writes, local, during, result };
}
test('a refused Dismiss leaves a newer unread reply unread with no Seen write', async () => {
  const h = await unreadHarness({ confirmedPromise: false });
  assert.equal(h.during.unread, true, 'nothing is marked read before the confirmation');
  assert.equal(h.during.seenWrites, 0); assert.equal(h.during.local, 0);
  assert.equal(h.result, false); assert.equal(h.row.archived, false);
  assert.equal(h.ctx.isNew(h.row, h.L.seen), true, 'unread dot survives');
  assert.equal(h.writes.filter(w => w.kind === 'seen').length, 0); assert.equal(h.local.length, 0);
});
test('an accepted Dismiss marks the click-time version read', async () => {
  const h = await unreadHarness({ confirmedPromise: true });
  assert.equal(h.result, true); assert.equal(h.row.archived, true);
  assert.equal(h.ctx.isNew(h.row, h.L.seen), false);
  assert.equal(h.writes.filter(w => w.kind === 'seen').length, 1);
  assert.equal(h.local.at(-1).threads['direct:t'].messageCount, 4);
});
test('a reply arriving while the Dismiss is confirmed stays unread', async () => {
  const h = await unreadHarness({ confirmedPromise: true, mutateDuring: (row, at) => { row.messageCount = 5; row.lastAssistantAt = new Date(at + 500).toISOString(); row.updatedAt = row.lastAssistantAt; } });
  const rec = h.local.at(-1).threads['direct:t'];
  assert.equal(rec.messageCount, 4, 'the click-time count, not the later one');
  assert.equal(h.ctx.isNew(h.row, h.L.seen), true, 'the later reply is still unread');
});
