import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { withParts } from './fixtures/chats-parts.mjs';
import { withLiveParts } from './fixtures/live-parts.mjs'; // live.js parts moved out verbatim (issue 1665)
import { modelContext } from './fixtures/chats-list-model.mjs';

// Durable follow-ups (watchers) on a thread: each test runs the real chats.js thread actions or the real live.js.
const chats = withParts(fs.readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'));
const live = withLiveParts(fs.readFileSync(new URL('../web/live.js', import.meta.url), 'utf8'));
const cut = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };
const watcher = { active: true, count: 1, names: ['Check the deploy'] };

// threadActions / actionLabel and the Stop watching branch of the action handler, with a stub LIVE.
function actions({ stopOk = true } = {}) {
  const calls = [], toasts = [];
  const ctx = { WORKING_ST: new Set(['submitting', 'queued', 'running', 'stopping']), isWorking: s => s.status === 'running', calls, toasts,
    LIVE: { busy: () => false, workGroups: rows => ({ archive: rows.filter(r => r.archived) }), ownerOf: s => s.agent || '', stopWatching: async (sid, owner) => { calls.push(['stopWatching', sid, owner]); return stopOk; } },
    H: {}, CH: {}, W: {}, closeRowSheet() {}, renderChats() {}, toast: (...a) => toasts.push(a[1]) };
  vm.createContext(ctx);
  vm.runInContext(cut(chats, '  const followUpActive = ', '  const owner = id =>') +
    `\nasync function stopWatch(sid, s) {\n  const a = 'stop_watch';\n${cut(chats, "    if (a === 'stop_watch') {", "    if (a === 'snooze' && window.WosSkinHost")}}\nthis.api = { threadActions, actionLabel, stopWatch };`, ctx);
  return { ...ctx.api, calls, toasts };
}
const answered = [{ a: { text: 'done' }, media: [] }];

test('active follow-ups keep Snooze, make Archive temporary, and expose explicit Stop watching', async () => {
  const A = actions();
  const s = { id: 't', status: 'completed', followUp: watcher };
  assert.deepEqual([...A.threadActions(s, answered)], ['snooze', 'stop_watch', 'done']);
  assert.equal(A.actionLabel(s, 'done'), 'Archive for now', 'Archive never cancels the watcher');
  assert.equal(A.actionLabel(s, 'stop_watch'), 'Stop watching');
  assert.equal(A.actionLabel(s, 'stop_watch', true), 'Stop');
  const plain = { id: 't', status: 'completed' };
  assert.deepEqual([...A.threadActions(plain, answered)], ['snooze', 'done']);
  assert.equal(A.actionLabel(plain, 'done'), 'Archive');
  assert.deepEqual([...A.threadActions({ ...s, followUp: { active: true, count: 0 } }, answered)], ['snooze', 'done'], 'no watcher left: plain actions');
  // A watcher check really running: Stop watching is the only action, even on an archived thread.
  assert.deepEqual([...A.threadActions({ ...s, status: 'running', archived: true }, answered)], ['stop_watch']);
  assert.deepEqual([...A.threadActions({ ...s, archived: true }, answered)], ['restore', 'snooze', 'stop_watch']);
  // Stop watching asks LIVE for exactly this row's owner, and says how it went.
  await A.stopWatch('t', { ...s, agent: 'box' });
  assert.deepEqual(A.calls, [['stopWatching', 't', 'box']]);
  assert.deepEqual(A.toasts, ['Stopped watching']);
  const no = actions({ stopOk: false }); await no.stopWatch('t', s);
  assert.deepEqual(no.toasts, ['Couldn’t stop watching']);
});

// The whole live.js with a fetch that records every request.
function liveBox(answer = () => ({})) {
  const storage = new Map(), reqs = [];
  const c = { console, AbortSignal, AbortController, URL, URLSearchParams, document: { documentElement: { dataset: {} }, readyState: 'loading', hidden: false, addEventListener() {} }, navigator: {},
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    setInterval() {}, setTimeout() {}, clearTimeout() {}, addEventListener() {}, dispatchEvent() {}, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } },
    WizConfig: { dayStart: n => n - n % 864e5 }, location: { origin: 'https://box.test', search: '' },
    fetch: async (url, init = {}) => { reqs.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null }); const body = answer(String(url), init);
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } }; } };
  c.window = c; modelContext(c);
  vm.runInContext(live, c);
  const L = c.WizLive; L.ok = true; L.seen = { initializedAt: 1, threads: {} };
  return { L, reqs };
}
const row = (extra = {}) => ({ id: 'wizard_w', title: 'Watch', status: 'completed', updatedAt: new Date().toISOString(), messageCount: 2, followUp: { ...watcher }, ...extra });

test('archived watcher checks stay out of Working while their silent run is active', () => {
  const { L } = liveBox();
  const g = L.workGroups([row({ id: 'a', archived: true, status: 'running' }), row({ id: 'b', status: 'running' })]);
  assert.deepEqual([...g.archive.map(s => s.id)], ['a'], 'the archived thread stays archived');
  assert.deepEqual([...g.working.map(s => s.id)], ['b']);
});

test('Archive and Snooze remain presentation actions; only Stop watching hits the cancellation route', async () => {
  const { L, reqs } = liveBox(url => url.includes('/wizard/follow-ups/stop') ? { ok: true, stopped: 1 }
    : url.includes('thread-dispositions') ? { record: { deferred: true, updatedAt: new Date().toISOString() } } : {});
  const s = row(); L.sessions = [s];
  await L.archive(s.id).catch(() => {});
  await L._defer(s.id, true).catch(() => {});
  assert.ok(reqs.length >= 2, 'Archive and Snooze wrote');
  assert.deepEqual(reqs.filter(r => r.url.includes('follow-ups')), [], 'neither touches the watcher');
  s.archived = false; L.busy = () => false;
  assert.equal(await L.stopWatching(s.id), true);
  const stop = reqs.filter(r => r.url.includes('/wizard/follow-ups/stop'));
  assert.equal(stop.length, 1);
  assert.equal(stop[0].method, 'POST');
  assert.equal(stop[0].body.session_id, s.id);
  assert.equal(s.followUp, null, 'the row stops showing the watcher');
});

test('the full-list normalizer preserves the service watcher projection', () => {
  const context = modelContext({});
  vm.runInContext(`${cut(live, '  const READY_OR_ATTENTION', '  /* ---- thread-seen')}\nthis.normalize = normalize;`, context);
  const base = { id: 'wizard_w', title: 'Watch', status: 'completed', updated_at: '2026-11-10T00:00:00Z' };
  const r = context.normalize({ ...base, wizard_follow_up: { active: true, count: 2, names: ['  Check   the deploy '], nextRun: '2026-11-11T09:00:00Z' } });
  assert.deepEqual(JSON.parse(JSON.stringify(r.followUp)), { active: true, count: 2, names: ['Check the deploy'], nextRun: '2026-11-11T09:00:00.000Z' });
  assert.equal(context.normalize({ ...base, wizard_follow_up: { active: false, count: 2 } }).followUp, null);
  assert.equal(context.normalize(base).followUp, null);
});
