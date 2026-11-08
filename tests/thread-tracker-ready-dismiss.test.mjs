// Tracker Dismiss/Seen only acknowledges items; it never archives the thread. Only the Archive button archives
// (James, 8 Nov 2026: "never archive that thread unless I click the archive button").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
const src = (rel, rev) => rev ? execFileSync('git', ['show', `${rev}:${rel}`], { encoding: 'utf8' }) : readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const live = src('web/live.js', process.env.QA_BASELINE);
const trackerSrc = src('web/core/thread-tracker.js', process.env.QA_BASELINE);

test('Archive (Ready Done) paints on the same frame and persists the archive', async () => {
  const row = { id: 't', archived: false }, writes = [];
  const ctx = { OVER: new Map(), hasNew: () => false, readRestored: () => ({}), writeRestored() {},
    req: async (path, init) => { writes.push({ path, body: JSON.parse(init.body) }); }, aq: () => '', J: {},
    Date, setTimeout() {}, clearTimeout() {}, encodeURIComponent };
  const methods = vm.runInNewContext('({' + live.slice(live.indexOf('    busy(id)'), live.indexOf('    // Stop exactly the watcher')) + '})', ctx);
  const L = { ...methods, session: () => row, seenOf: () => null, emit() {}, refresh() {} };
  const result = L.archive('t');
  assert.equal(row.archived, true, 'same-frame Done projection');
  assert.equal(await result, true);
  assert.deepEqual(writes, [{ path: '/wizard/hermes/api/sessions/t', body: { archived: true } }]);
});

test('Archive marks an unread thread read at once', async () => {
  const helpers = live.slice(live.indexOf('  const vis ='), live.indexOf('  function later('));
  const laterFn = live.slice(live.indexOf('  function later('), live.indexOf('  function merge('));
  const seenMethods = '({' + live.slice(live.indexOf('    busy(id)'), live.indexOf('    // Stop exactly the watcher')) + live.slice(live.indexOf('    markSeen(ids'), live.indexOf('    async markUnread(ids)')) + '})';
  const at = 1793972000000, fresh = new Date(at - 1000).toISOString(), old = new Date(at - 20000).toISOString();
  const row = { id: 't', runtime: 'direct', archived: false, preview: 'A newer reply', previewRole: 'assistant', previewAt: fresh, lastAssistantAt: fresh, messageCount: 4, updatedAt: fresh, status: 'completed' };
  const writes = [], local = [];
  const ctx = vm.createContext({ OVER: new Map(), READY_OR_ATTENTION: new Set(['completed']), otherAgent: a => !!a && a !== 'hermes', readRestored: () => ({}), writeRestored() {},
    req: async (path, init) => { writes.push({ kind: 'archive', path, body: JSON.parse(init.body) }); }, aq: () => '', J: {},
    Date: class extends Date { static now() { return at; } }, setTimeout() {}, clearTimeout() {}, encodeURIComponent, MAX: 500,
    readLocal: () => local.at(-1) || null, writeLocal: s => local.push(JSON.parse(JSON.stringify(s))),
    putSeen: async s => { writes.push({ kind: 'seen' }); return s; } });
  vm.runInContext(helpers + laterFn + '\nglobalThis.isNew=hasNew;globalThis.merge=(a,b)=>{if(!a)return b;if(!b)return a;const threads={...a.threads};for(const[k,r]of Object.entries(b.threads))threads[k]=later(threads[k],r);return{initializedAt:Math.min(a.initializedAt,b.initializedAt),threads}};', ctx);
  const L = { ...vm.runInContext(seenMethods, ctx), session: () => row, seen: { initializedAt: at - 20000, threads: { 'direct:t': { seenAt: at - 20000, updatedAt: old, assistantActivityAt: old, messageCount: 2, status: 'completed' } } }, seenOf() { return this.seen; }, emit() {}, refresh() {} };
  assert.equal(ctx.isNew(row, L.seen), true);
  assert.equal(await L.archive('t'), true);
  assert.equal(row.archived, true); assert.equal(ctx.isNew(row, L.seen), false);
  assert.equal(writes.filter(w => w.kind === 'seen').length, 1);
});

// The real tracker, with a WizLive that records every archive call.
function boot(items, seenReply) {
  const listeners = {}, archives = [], posts = [];
  const doc = { documentElement: { dataset: { tweaks: 'wizard/thread-tracker' } }, querySelectorAll: () => [], addEventListener() {}, hidden: false };
  const win = { addEventListener(t, f) { (listeners[t] ||= []).push(f); }, dispatchEvent(e) { for (const f of listeners[e.type] || []) f(e); return true; } };
  const reply = body => ({ ok: true, status: 200, json: async () => body });
  const ctx = vm.createContext({ window: win, document: doc, setInterval() {}, setTimeout, CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i?.detail; } },
    MutationObserver: class { observe() {} }, Date, JSON, Math, Set, Map, Object, String, Promise, console,
    fetch: async (path, init = {}) => {
      if (init.method === 'POST') {
        const b = JSON.parse(init.body); posts.push(b);
        if (seenReply === 'refused') return { ok: false, status: 409, json: async () => ({}) };
        return reply({ items: items.map(i => b.ids.includes(i.id) ? { ...i, seen: true } : i), results: b.ids.map(id => ({ id, status: 'ok' })) });
      }
      return reply({ items });
    } });
  vm.runInContext(readFileSync(new URL('../web/core/chats-list-model.js', import.meta.url), 'utf8'), ctx);
  win.WizChatsListModel = ctx.WizChatsListModel;
  const row = { id: 't', status: 'completed', archived: false };
  win.WizLive = { session: () => row, sessionFor: () => row, agentOf: () => '', archive: (...a) => { archives.push(a); row.archived = true; return Promise.resolve(true); } };
  vm.runInContext(trackerSrc, ctx);
  const T = win.WosThreadTracker;
  const tap = (id, action) => T.click({ target: { closest: s => s.includes('data-tt-strip') ? { dataset: { ttStrip: 't', ttAgent: '' } } : s.includes(action) ? {} : s.includes('data-tt-row') ? { dataset: { ttRow: id } } : null } });
  return { T, tap, archives, posts, row };
}
const item = (id, state, extra = {}) => ({ id, title: id, state, updated_at: 10, seen: false, message_id: id, ...extra });
const tick = () => new Promise(r => setTimeout(r, 15));

for (const seenReply of ['accepted', 'refused']) test(`Dismissing the last amber item never archives the thread (Seen ${seenReply})`, async () => {
  const h = boot([item('a', 'needs_you', { ask: 'Reply resend to send it' })], seenReply);
  await h.T.load('t');
  assert.match(h.T.stripHtml('t'), /data-tt-dismiss/);
  h.tap('a', 'data-tt-dismiss');
  assert.equal(h.T.stripHtml('t'), '', 'the item clears on the same frame');
  await tick();
  assert.equal(h.posts.length, 1, 'Dismiss acknowledges the item');
  assert.deepEqual(h.posts[0].items, [{ id: 'a', updated_at: 10 }]);
  assert.equal(h.archives.length, 0, 'WizLive.archive is never called by a tracker Dismiss');
  assert.equal(h.row.archived, false, 'the thread stays where it is');
});

test('Seen on the last open (green) item never archives the thread', async () => {
  const h = boot([item('a', 'done')], 'accepted');
  await h.T.load('t');
  h.tap('a', 'data-tt-seen'); await tick();
  assert.equal(h.posts.length, 1);
  assert.equal(h.archives.length, 0); assert.equal(h.row.archived, false);
});

test('the tracker holds no archive call at all', () => {
  assert.doesNotMatch(trackerSrc.replace(/\/\/.*$/gm, ''), /\.archive\s*\(/);
});
