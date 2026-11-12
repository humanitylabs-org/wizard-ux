// wizard-ux issue 1360 (kick-back, 12 Nov 2026): the "Your call stays in Ready" rule on a REAL sessions-list payload,
// not a hand-made row. tests/fixtures/sessions-list-1360.json is the Agent Service's own view=list projection
// (wizard-agent-service server/session-list-view.mjs listPayload at 1644da9) of Hermes rows enriched the way the
// Service serves them (wizard_attention, wizard_last_assistant_at, latest_message, channel). It goes through the real
// web/live.js list read (refresh), read state (markSeen = opening the thread) and Mark done (markHandled), then through
// the real chats.js rule (chanNeeds / attOf / chanUnread / actMark) into the real Activity grouping. With Channels on
// the Thread tracker's own dots are off (thread-tracker.js on()), so the Activity marker is the only dot on a row.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { modelContext } from './fixtures/chats-list-model.mjs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const live = read('web/live.js'), chats = read('web/core/chats.js'), tracker = read('web/core/thread-tracker.js');
const PAYLOAD = JSON.parse(read('tests/fixtures/sessions-list-1360.json'));
const CHANNELS = 'wizard/thread-tracker wizard/chat-channels';

function harness(payload = PAYLOAD) {
  const storage = new Map(), dataset = { tweaks: CHANNELS }, writes = [];
  let seenOnBox = { initializedAt: 1, threads: {} }, list = structuredClone(payload);
  const json = v => ({ ok: true, status: 200, json: async () => structuredClone(v) });
  const c = { console, AbortSignal, URL, URLSearchParams, structuredClone, Promise, Date, JSON, Map, Set,
    document: { documentElement: { dataset }, readyState: 'loading', hidden: false, addEventListener() {}, querySelector: () => null },
    navigator: {}, location: { origin: 'https://box.test', href: 'https://box.test/wizard-os-home/' },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k), key: () => null, get length() { return 0; } },
    setInterval() {}, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } }, Event: class { constructor(type) { this.type = type; } },
    WizConfig: { dayStart: n => n - n % 864e5 }, WosAgents: { isOther: id => !!id && id !== 'hermes', get: id => ({ id, privacy: 'standard' }), others: () => [] },
    fetch: async (url, init = {}) => {
      const u = new URL(url, 'https://box.test'), method = init.method || 'GET';
      if (method !== 'GET') writes.push(method + ' ' + u.pathname);
      if (u.pathname === '/wizard/hermes/api/sessions') return json(u.searchParams.get('agent') ? { data: [], has_more: false } : list);
      if (u.pathname === '/wizard/thread-seen') { if (method === 'PUT') seenOnBox = JSON.parse(init.body); return json({ state: seenOnBox }); }
      if (u.pathname === '/wizard/thread-dispositions') return json({ state: {} });
      return json({});
    } };
  c.window = c; c.globalThis = c; modelContext(c); vm.runInContext(live, c);
  const L = c.WizLive;
  // The real chats.js rule, line by line (the same lines the Activity list, its marker and the channel line read).
  const line = t => { const i = chats.indexOf('\n  ' + t); assert.ok(i >= 0, t); return chats.slice(i + 1, chats.indexOf('\n', i + 1)); };
  const tline = t => { const i = tracker.indexOf('\n  ' + t); assert.ok(i >= 0, t); return tracker.slice(i + 1, tracker.indexOf('\n', i + 1)); };
  Object.assign(c, { CHAN_SWITCH: 'wizard/chat-channels', LIVE: L, snoozeLast: () => false, deferredOf: s => !!s.deferred && !s.archived });
  vm.runInContext(['const WORKING_ST =', 'const isWorking =', 'const channelsOn =', 'const markDoneOn =', 'const handledNow =', 'const chanNeeds =',
    'const chanUnread =', 'const actNeeds =', 'const actUnread =', 'const actMark =', 'const attOf ='].map(line).join('\n')
    + '\n' + ['const ID =', 'const RETIRED_BY =', 'const on ='].map(tline).join('\n')
    + '\nthis.rule = { needs: actNeeds, unread: actUnread, mark: actMark, attOf, trackerOn: on };', c);
  return { c, L, rule: c.rule, dataset, writes, setList: p => { list = structuredClone(p); }, seenOnBox: () => seenOnBox };
}
// Activity's own sections and markers (WizChatsListModel.activityList), at the fixture's clock.
function activity({ c, L, rule }) {
  const now = Math.max(...PAYLOAD.data.map(s => Date.parse(s.activityAt))) + 60e3;
  const l = c.WizChatsListModel.activityList(L.workGroups(), { live: L, chats: { activityNeeds: rule.needs, activityUnread: rule.unread, threadActions: () => [], channelOf: () => 'launch', agentLabelOf: () => '' } }, { order: 'newest', now });
  const out = Object.fromEntries(['working', 'ready', 'recent'].map(k => [k, [...l[k]].map(r => r.id.replace('synthetic_1360_', '') + (r.mark ? ':' + r.mark : ''))]));
  assert.ok(![...l.recent].some(r => r.mark === 'needs'), 'no row in Recent ever carries the amber marker: ' + JSON.stringify(out));
  for (const r of l.ready) assert.equal(r.mark, rule.mark(L.session(r.id)), 'the row marker is the one rule');
  return out;
}
const CHECK = 'synthetic_1360_check', NEEDS = 'synthetic_1360_needs', GREEN = 'synthetic_1360_green', FYI = 'synthetic_1360_fyi';

test('issue 1360, real list payload: a Your call reply stays in Ready with amber after it is opened; green leaves on open', async () => {
  const h = harness(); await h.L.refresh();
  assert.equal(h.L.ok, true, 'the real list read succeeded');
  const s = h.L.session(CHECK);
  assert.equal(s.listVersion, 1, 'the row came through the Service list projection');
  assert.deepEqual({ state: s.attention?.state, status: s.status }, { state: 'check', status: 'completed' }, 'the payload keeps the status line to the rule');
  assert.equal(h.rule.trackerOn(), false, 'Channels on: the Thread tracker draws no dots of its own');
  assert.deepEqual(activity(h), { working: [], ready: ['check:needs', 'needs:needs', 'green:new', 'fyi:new'], recent: [] }, 'all unread to start: amber over green');
  for (const id of [CHECK, NEEDS, GREEN, FYI]) h.L.markSeen(id); // open each thread, then Back
  await new Promise(r => setImmediate(r));
  assert.equal(h.L.isNew(h.L.session(CHECK)), false, 'opening read it');
  assert.deepEqual(activity(h), { working: [], ready: ['check:needs', 'needs:needs'], recent: ['green', 'fyi'] }, 'Your call and Needs you stay; green leaves');
  // The next list poll (same payload) and a fresh device reading the box's synced read state agree.
  await h.L.refresh();
  assert.deepEqual(activity(h).ready, ['check:needs', 'needs:needs']);
  const other = harness(); await other.L.refresh(); other.L.seen = h.seenOnBox(); other.L.emit?.();
  assert.deepEqual(activity(other), { working: [], ready: ['check:needs', 'needs:needs'], recent: ['green', 'fyi'] }, 'another device reads the same');
  assert.ok(h.writes.every(w => w === 'PUT /wizard/thread-seen'), 'opening writes only the read state: ' + h.writes);
});

test('issue 1360, real list payload: Mark done moves Your call to Recent; a newer Your call reply brings amber back', async () => {
  const h = harness(); await h.L.refresh();
  h.L.markSeen(CHECK); await h.L.markHandled(h.L.session(CHECK));
  let a = activity(h);
  assert.ok(a.recent.includes('check'), 'Mark done: it moves to Recent with no marker');
  assert.ok(!a.ready.some(x => x.startsWith('check')));
  // The agent answers again with a new Your call: the Service serves a newer reply time and status line.
  const next = structuredClone(PAYLOAD), row = next.data.find(x => x.id === CHECK), later = new Date(Date.parse(row.lastAssistantAt) + 30e3).toISOString();
  Object.assign(row, { lastAssistantAt: later, previewAt: later, activityAt: later, messageCount: row.messageCount + 2, preview: 'Second try is live.', attention: { state: 'check', ask: 'The second try is live. Say if it feels right', subject: 'WizardOS' } });
  h.setList(next); await h.L.refresh();
  a = activity(h);
  assert.equal(a.ready[0], 'check:needs', 'a newer Your call reply is amber again: ' + JSON.stringify(a));
  h.L.markSeen(CHECK);
  assert.equal(activity(h).ready[0], 'check:needs', 'and opening it keeps it in Ready');
});

test('issue 1360, real list payload: switch off leaves the status line and the Thread tracker as before', async () => {
  const h = harness(); await h.L.refresh(); h.dataset.tweaks = 'wizard/thread-tracker';
  assert.equal(h.rule.attOf(h.L.session(CHECK))?.state, 'check');
  assert.equal(h.rule.trackerOn(), true, 'switch off: the Thread tracker keeps its own dots');
});
