// wizard-ux issue 1360 (kick-back, 12 Nov 2026): the "Your call stays in Ready" rule on a REAL sessions-list payload,
// not a hand-made row. tests/fixtures/sessions-list-1360.json is the Agent Service's own view=list projection
// (wizard-agent-service server/session-list-view.mjs listPayload at 1644da9) of Hermes rows enriched the way the
// Service serves them (wizard_attention, wizard_last_assistant_at, latest_message, channel). It goes through the real
// web/live.js list read (refresh), read state (markSeen = opening the thread) and Mark done (markHandled), then through
// the real chats.js rule (chanNeeds / attOf / chanUnread / actMark) into the real phone / Classic Inbox renderer
// (core/chats-inboxrows.js inboxRowsBody, wizard-ux issue 1779; the Thread tracker is retired and draws no dots), and
// the markup is read back: which section each row sits in and which dots it carries.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { modelContext } from './fixtures/chats-list-model.mjs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withLiveParts } from './fixtures/live-parts.mjs'; // live.js parts moved out verbatim (issue 1665)
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const live = withLiveParts(read('web/live.js')), chats = withParts(read('web/core/chats.js')), tracker = read('web/core/thread-tracker.js');
// The fixture's times move to "a few minutes ago".
const RAW = JSON.parse(read('tests/fixtures/sessions-list-1360.json'));
const SHIFT = Date.now() - 5 * 60e3 - Math.max(...RAW.data.map(s => Date.parse(s.activityAt)));
const shift = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(v) ? new Date(Date.parse(v) + SHIFT).toISOString() : Array.isArray(v) ? v.map(shift) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shift(x)])) : v;
const PAYLOAD = shift(RAW);
const CHANNELS = 'wizard/thread-tracker wizard/chat-channels';

function harness(payload = PAYLOAD, box = { seen: { initializedAt: 1, threads: {} } }) {
  const storage = new Map(), dataset = { tweaks: CHANNELS }, writes = [];
  let list = structuredClone(payload);
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
      if (u.pathname === '/wizard/thread-seen') { if (method === 'PUT') box.seen = JSON.parse(init.body); return json({ state: box.seen }); }
      if (u.pathname === '/wizard/thread-dispositions') return json({ state: {} });
      return json({});
    } };
  c.window = c; c.globalThis = c; modelContext(c); vm.runInContext(live, c);
  const L = c.WizLive;
  // The real chats.js rule, line by line (the same lines the Activity list, its marker and the channel line read), and the
  // real Activity renderer: activityBody, chatRow and actRowMark, verbatim. Only icons, times and pins are stubbed.
  const line = t => { const i = chats.indexOf('\n  ' + t); assert.ok(i >= 0, t); return chats.slice(i + 1, chats.indexOf('\n', i + 1)); };
  const block = (a, b) => { const i = chats.indexOf('\n  ' + a); assert.ok(i >= 0, a); const j = chats.indexOf('\n  ' + b, i); assert.ok(j > i, b); return chats.slice(i + 1, j); };
  const tline = t => { const i = tracker.indexOf('\n  ' + t); assert.ok(i >= 0, t); return tracker.slice(i + 1, tracker.indexOf('\n', i + 1)); };
  Object.assign(c, { LIVE: L, snoozeLast: () => false, deferredOf: s => !!s.deferred && !s.archived,
    readyOrder: 'newest', SEC_PAGE: 40, secOpen: { working: true, ready: true, recent: true }, ch: () => ({ more: {} }), noteRow: () => '', noteAt: () => 0,
    STI: new Proxy({}, { get: () => '' }), esc: v => String(v ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]),
    clip: (v, n) => String(v ?? '').slice(0, n), ago: () => '1m', workLabel: () => 'Working', privRow: () => false, AGS: () => null, topicOn: () => false,
    TOPIC: null, subjectOf: () => '', PIN: { has: () => false, on: () => true }, BOOM: () => null, PIN_SVG: '', chanName: () => 'launch', agentTail: () => '' });
  vm.runInContext(['const WORKING_ST =', 'const isWorking =', 'const handledNow =', 'const chanNeeds =',
    'const chanUnread =', 'const actNeeds =', 'const actUnread =', 'const actMark =', 'const chanAt =', 'const ATT =', 'const attOf =', 'const STI_LAB =', 'const STI_TIP ='].map(line).join('\n')
    + '\n' + ['const ID =', 'const on ='].map(tline).join('\n')
    + '\nthis.rule = { needs: actNeeds, unread: actUnread, mark: actMark, attOf, trackerOn: on, chanAt, isWorking };', c);
  // Chats › Inbox (wizard-ux issue 1779, on for everyone): the real chats-inboxrows.js part over the real rule above.
  c.WizCore = { chatsParts: {} }; vm.runInContext(read('web/core/chats-inboxrows.js'), c);
  const R = c.rule, ib = c.WizCore.chatsParts.inboxrows({ actMark: R.mark, actNeeds: R.needs, actUnread: R.unread, AGS: () => null, agentName: () => 'Wizard', agentRec: id => ({ id }),
    ago: c.ago, attOf: R.attOf, chanAt: R.chanAt, chanFace: n => ({ emoji: '💬', label: n, own: false }), chanStore: () => ({ channels: [] }), chatVars: { readyOrder: 'newest', secOpen: {} },
    ch: c.ch, clip: c.clip, elOf: () => null, esc: c.esc, isWorking: R.isWorking, LIVE: L, noteAt: c.noteAt, noteRow: c.noteRow, renderChatList: () => {}, rowAgent: () => 'hermes',
    spacesOf: () => [], threadAct: () => {}, toast: () => {}, W: {}, winAgent: () => '' });
  c.activityBody = ib.inboxRowsBody;
  // The Thread tracker as chats.js sees it: its real on(); if it were on, every row would get a "waiting on you" dot.
  c.WosThreadTracker = { on: c.rule.trackerOn, onFor: c.rule.trackerOn, dots: () => '<i class="tt-dot you"></i>', loadCounts() {} };
  return { c, L, rule: c.rule, dataset, writes, box, setList: p => { list = structuredClone(p); } };
}
// The real phone / Classic Inbox markup: each section's rows, with their dot ("needs" amber, "new" green, "tracker").
function activity({ c, L }) {
  const html = c.activityBody({ id: 'w' }, L.sessions, null), out = {};
  for (const k of ['ready', 'snoozed', 'archived']) {
    const body = (html.split(`data-sec="${k}"`)[1] || '').split('</section>')[0];
    out[k] = [...body.matchAll(/<div class="ch-row-wrap[^"]*" data-morph-key="row:synthetic_1360_([a-z]+)">([^]*?)<\/button>/g)].map(([, id, row]) =>
      id + (/class="ch-chan-dot new"/.test(row) ? ':new' : /class="ch-chan-dot"/.test(row) ? ':needs' : '') + (/tt-dot/.test(row) ? ':tracker' : ''));
  }
  assert.ok(!/data-sec="recent"|data-sec="working"/.test(html), 'no Recent and no Working beside Inbox');
  return out;
}
const CHECK = 'synthetic_1360_check', NEEDS = 'synthetic_1360_needs', GREEN = 'synthetic_1360_green', FYI = 'synthetic_1360_fyi';

test('issue 1360, real list payload: a Your call reply stays in Inbox with amber after it is opened; green loses its dot, stays until archived', async () => {
  const h = harness(); await h.L.refresh();
  assert.equal(h.L.ok, true, 'the real list read succeeded');
  const s = h.L.session(CHECK);
  assert.equal(s.listVersion, 1, 'the row came through the Service list projection');
  assert.deepEqual({ state: s.attention?.state, status: s.status }, { state: 'check', status: 'completed' }, 'the payload keeps the status line to the rule');
  assert.equal(h.rule.trackerOn(), false, 'the Thread tracker is retired: it draws no dots of its own');
  assert.deepEqual(activity(h), { ready: ['check:needs', 'needs:needs', 'green:new', 'fyi:new'], snoozed: [], archived: [] }, 'all unread to start: amber over green');
  for (const id of [CHECK, NEEDS, GREEN]) h.L.markSeen(id); // open these threads, then Back (FYI stays unread)
  await new Promise(r => setImmediate(r));
  assert.equal(h.L.isNew(h.L.session(CHECK)), false, 'opening read it');
  assert.deepEqual(activity(h), { ready: ['check:needs', 'needs:needs', 'green', 'fyi:new'], snoozed: [], archived: [] }, 'Your call and Needs you keep amber; opened green keeps its row, without a dot');
  // The next list poll (same payload) and a fresh device reading the box's synced read state agree.
  await h.L.refresh();
  assert.deepEqual(activity(h).ready, ['check:needs', 'needs:needs', 'green', 'fyi:new']);
  const other = harness(PAYLOAD, h.box); await other.L.refresh(); // reads the box's synced read state
  // (an unread FYI still waits there: a device that failed to read the box would count everything read on its first run)
  assert.deepEqual(activity(other), { ready: ['check:needs', 'needs:needs', 'green', 'fyi:new'], snoozed: [], archived: [] }, 'another device reads the same');
  assert.ok(h.writes.every(w => w === 'PUT /wizard/thread-seen'), 'opening writes only the read state: ' + h.writes);
});

test('issue 1360, real list payload: Mark done takes amber off Your call (the row stays until archived); a newer Your call reply brings amber back', async () => {
  const h = harness(); await h.L.refresh();
  h.L.markSeen(CHECK); await h.L.markHandled(h.L.session(CHECK));
  let a = activity(h);
  assert.ok(a.ready.includes('check'), 'Mark done: it stays in Inbox with no marker until archived: ' + JSON.stringify(a));
  assert.ok(!a.ready.includes('check:needs'));
  // The agent answers again with a new Your call: the Service serves a newer reply time and status line.
  const next = structuredClone(PAYLOAD), row = next.data.find(x => x.id === CHECK), later = new Date(Date.parse(row.lastAssistantAt) + 30e3).toISOString();
  Object.assign(row, { lastAssistantAt: later, previewAt: later, activityAt: later, messageCount: row.messageCount + 2, preview: 'Second try is live.', attention: { state: 'check', ask: 'The second try is live. Say if it feels right', subject: 'WizardOS' } });
  h.setList(next); await h.L.refresh();
  a = activity(h);
  assert.equal(a.ready[0], 'check:needs', 'a newer Your call reply is amber again: ' + JSON.stringify(a));
  h.L.markSeen(CHECK);
  assert.equal(activity(h).ready[0], 'check:needs', 'and opening it keeps it amber in Inbox');
});
