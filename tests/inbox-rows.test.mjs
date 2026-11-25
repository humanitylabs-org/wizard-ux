// Inbox rows (wizard-ux issue 1779, switch wizard/inbox-rows): Chats › Inbox holds only what needs the owner, as
// Signal / Telegram rows that stay until archived, with today's Daily and #priority / urgent pinned on top. Runs the
// real list model rule, the real agent inbox reader (cut out of live-channels.js) against a fake box, and the real
// chats-inboxrows.js part drawing and tapping rows. Switch off: the model gives exactly today's groups.
// Run: node --test tests/inbox-rows.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { modelContext } from './fixtures/chats-list-model.mjs';
import { withLiveParts } from './fixtures/live-parts.mjs'; // live.js parts moved out verbatim (issue 1665)

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const J = v => JSON.parse(JSON.stringify(v)); // vm arrays are from another realm
const H = 3600e3, NOW = Date.now(), SW = 'wizard/inbox-rows';
const M = modelContext({}).WizChatsListModel;
const iso = t => new Date(t).toISOString();
const row = (id, h, extra = {}) => ({ id, title: 'T ' + id, status: 'completed', at: NOW - h * H, updatedAt: iso(NOW - h * H), lastAssistantAt: iso(NOW - h * H), messageCount: 2, ...extra });
const needs = s => ['needs_you', 'check'].includes(s.attention?.state) && s.status !== 'running';
const unread = s => !!s.fresh && s.status !== 'running';
const quiet = s => s.quietReply === true;
const groups = rows => ({ working: rows.filter(s => s.status === 'running'), ready: rows.filter(s => s.status !== 'running' && !s.archived && !s.deferred), deferred: rows.filter(s => s.deferred && !s.archived), archive: rows.filter(s => s.archived) });
// new1 unread reply, read1 read reply (rows stay), y1 needs you, f1 failed, q1 quiet reply, w0 his send still working
// (no answer yet), w1 working on a thread that had answers, pr1 #priority, d1 today's Daily, s1 snoozed, a1 archived.
const ROWS = () => [row('new1', 1, { fresh: true }), row('read1', 30), row('y1', 3, { attention: { state: 'needs_you', ask: 'A or B?' } }),
  row('f1', 4, { status: 'failed', lastAssistantAt: undefined, messageCount: 1 }), row('q1', 0.5, { quietReply: true, attention: { state: 'done', ask: 'ok' } }),
  row('w0', 0.1, { status: 'running', lastAssistantAt: undefined, messageCount: 1 }), row('w1', 0.2, { status: 'running' }),
  row('pr1', 60), row('d1', 5), row('s1', 2, { deferred: true }), row('a1', 6, { archived: true })];
const pin = s => s.id === 'd1' ? 1 : s.id === 'pr1' ? 2 : 0;
const facts = { needs, unread, at: s => s.at };

test('list model: the switch id is read from data-tweaks', () => {
  assert.equal(M.INBOX_ROWS, SW);
  assert.equal(M.inboxRowsOn(`wizard/desktop-chats ${SW}`), true);
  assert.equal(M.inboxRowsOn('wizard/desktop-chats wizard/inbox-until-archived'), false);
  assert.equal(M.inboxRowsOn(undefined), false);
});

test('list model: Inbox holds only what needs him; pinned first in pin order; no Recent, no Show older', () => {
  const g = M.activityGroups(groups(ROWS()), facts, { now: NOW, inbox: { quiet, pin } });
  assert.deepEqual(J(g.ready.map(s => s.id)), ['d1', 'pr1', 'w1', 'new1', 'y1', 'f1', 'read1'], 'pinned Daily, #priority, then newest first');
  assert.equal(g.pinned, 2);
  assert.ok(!g.ready.some(s => s.id === 'q1'), 'a quiet "nothing needed" reply is never in Inbox (it is in Sent)');
  assert.ok(!g.ready.some(s => s.id === 'w0'), 'his own send still working with no answer is not in Inbox (Sent › Working)');
  assert.deepEqual(J(g.working.map(s => s.id)), ['w0'], 'what is left working stays the shell\'s Working list');
  assert.deepEqual([g.recent.length, g.older], [0, 0]);
  assert.deepEqual(J(g.snoozed.map(s => s.id)), ['s1']);
  assert.deepEqual(J(g.archive.map(s => s.id)), ['a1']);
});

test('list model: a read reply stays until archived; archiving is the only way out', () => {
  const rows = ROWS(), inbox = () => M.activityGroups(groups(rows), facts, { now: NOW, inbox: { quiet, pin } }).ready.map(s => s.id);
  const n = rows.find(s => s.id === 'new1');
  assert.ok(inbox().includes('new1'));
  n.fresh = false; // opened and read
  assert.ok(inbox().includes('new1'), 'read: still in Inbox');
  n.archived = true;
  assert.ok(!inbox().includes('new1'), 'archived: gone');
  // A thread only aged past "archive after" (not archived by him) is still in Inbox.
  const g = groups(ROWS()); g.archive.push(row('aged', 9 * 24));
  assert.ok(M.activityGroups(g, facts, { now: NOW, inbox: { quiet, pin } }).ready.some(s => s.id === 'aged'));
});

test('list model: switch off gives exactly today\'s groups', () => {
  const off = M.activityGroups(groups(ROWS()), facts, { now: NOW });
  const off2 = M.activityGroups(groups(ROWS()), facts, { now: NOW, inbox: null });
  assert.deepEqual(J(off2), J(off));
  assert.ok(off.recent.some(s => s.id === 'read1'), 'off: a read reply is in Recent as today');
  assert.ok(off.working.some(s => s.id === 'w1'));
});

test('list model: the same rule for the main agent and routed agents (host-profile, container, restricted)', () => {
  for (const agent of ['', 'host-profile', 'container', 'restricted']) {
    const rows = ROWS().map(s => ({ ...s, agent, id: (agent || 'main') + ':' + s.id }));
    const p = s => pin({ ...s, id: s.id.split(':')[1] });
    const g = M.activityGroups(groups(rows), facts, { now: NOW, inbox: { quiet, pin: p } });
    assert.deepEqual(J(g.ready.map(s => s.id.split(':')[1])), ['d1', 'pr1', 'w1', 'new1', 'y1', 'f1', 'read1'], 'agent ' + (agent || 'main'));
  }
  assert.equal(M.inboxWants({ id: 'h', hidden: true, attention: { state: 'needs_you' } }, { needs: () => true }), false, 'a hidden worker thread is never a thread row');
});

/* The box's waiting background tasks: the reader cut out of live-channels.js against a fake box. */
const live = withLiveParts(read('web/live.js'));
const slice = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i > 0 && j > i, a); return src.slice(i, j); };
const RID = c => 'inbox_' + c.repeat(24);
function reader(records, opts = {}) {
  const calls = [], ctx = {}; vm.createContext(ctx);
  vm.runInContext(slice(live, '  /* ---- agent inbox (wizard-ux issue 1569)', '/* ---- end agent inbox ---- */') + '\nthis.agentInbox = agentInbox;', ctx);
  const req = async (path, init = {}) => {
    calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (opts.gone) { const e = new Error('HTTP 404'); e.status = 404; throw e; }
    if ((init.method || 'GET') === 'PATCH') { const id = path.split('/').pop(), r = records.find(x => x.id === id); if (r) r.state = 'archived'; return { json: async () => ({ record: r }) }; }
    return { json: async () => ({ records: records.filter(r => r.state === 'new'), check: null, stay: [] }) };
  };
  return { inbox: ctx.agentInbox({ req, emit: () => {} }), calls };
}
const recs = () => [
  { id: RID('1'), kind: 'needs_you', failed: true, state: 'new', agent: 'hermes', thread_id: 'bg1', title: 'Renew the permit', last_update: 'Stalled: the site asked for a login.', updated_at: 2000 },
  { id: RID('2'), kind: 'needs_you', state: 'new', agent: 'container', thread_id: 'bg2', title: 'Pick a hotel', ask: 'A or B?', updated_at: 1000 },
  { id: RID('3'), kind: 'result', state: 'new', agent: 'hermes', thread_id: 'bg3', title: 'Done in the background', updated_at: 3000 },
];

test('agent inbox reader: waiting tasks (kind needs_you) only, failed flagged, per agent; Archive PATCHes and drops it', async () => {
  const box = recs(), { inbox, calls } = reader(box);
  await inbox.readNeeds();
  assert.equal(calls[0].path, '/wizard/v1/agent-inbox?state=new&kind=needs_you&limit=50');
  assert.deepEqual(J(inbox.needs('hermes').map(r => [r.id, r.thread, r.failed === true, r.ask])), [[RID('1'), 'bg1', true, 'Stalled: the site asked for a login.']], 'successful background work (kind result) never shows');
  assert.deepEqual(J(inbox.needs('container').map(r => r.thread)), ['bg2'], 'a routed agent\'s task is its own');
  const p = inbox.archive(RID('1'));
  assert.equal(inbox.needs('hermes').length, 0, 'gone on the tap frame');
  await p;
  const patch = calls.find(c => c.method === 'PATCH');
  assert.deepEqual(J(patch), { path: `/wizard/v1/agent-inbox/${RID('1')}`, method: 'PATCH', body: { action: 'archive' } });
  await assert.rejects(inbox.archive('../x'), e => e.status === 400);
});

test('agent inbox reader: a box without the agent inbox (404) is an empty list', async () => {
  const { inbox } = reader(recs(), { gone: true });
  await inbox.readNeeds();
  assert.deepEqual(J(inbox.needs('hermes')), []);
  assert.equal(inbox.needsState().gone, true);
});

/* The real chats-inboxrows.js part, drawn and tapped. */
function part({ on = true, records = [] } = {}) {
  const taps = [], archived = [];
  const ctx = vm.createContext({ console, Date, Promise, String, Number, Set, Map, Array, Object, JSON, setTimeout });
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.document = { documentElement: { dataset: { tweaks: on ? `wizard/desktop-chats ${SW}` : 'wizard/desktop-chats' } } };
  ctx.WizChatsListModel = M; ctx.WizCore = { chatsParts: {} };
  vm.runInContext(read('web/core/chats-inboxrows.js'), ctx);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const rows = ROWS().map(s => ({ ...s, preview: s.lastAssistantAt ? 'Reply of ' + s.id : 'Asked ' + s.id, previewRole: s.lastAssistantAt ? 'assistant' : 'user' }));
  const spaces = { new1: [{ name: '✈️ Trip' }], pr1: [{ name: '🔥 Priority' }], d1: [{ name: 'Daily' }] };
  const LIVE = {
    quietReply: quiet, cardAt: s => iso(s.at), workGroups: groups,
    chanDaily: { state: () => ({ today: 'd1' }) },
    sentLog: { state: () => ({ ok: true, rows: [{ thread: 'read1', urgent: true }] }) },
    agentInbox: { needs: () => records, archive: async id => { archived.push(id); } },
  };
  const api = ctx.WizCore.chatsParts.inboxrows({
    actMark: s => s.status === 'running' ? 'working' : needs(s) ? 'needs' : unread(s) ? 'new' : '', actNeeds: needs, actUnread: unread,
    AGS: () => ({ sigil: a => `<span class="ag-sig">${a.id}</span>`, defaultId: () => 'hermes' }), agentName: id => id || 'Wizard', agentRec: id => ({ id }),
    ago: t => t ? 'ago' : '', attOf: s => s.attention || null, chanAt: s => s.at, chanFace: n => { const m = /^(\p{Extended_Pictographic}\uFE0F?)\s*(.*)$/u.exec(n); return m ? { emoji: m[1], label: m[2], own: true } : { emoji: '💬', label: n, own: false }; },
    chanStore: () => ({ channels: [{ id: 'daily', kind: 'daily' }] }), chatVars: { readyOrder: 'newest', secOpen: {} }, ch: () => ({}), clip: (s, n) => String(s).slice(0, n), elOf: () => null, esc,
    isWorking: s => s.status === 'running', LIVE, noteAt: n => n.at, noteRow: n => `<div class="note" data-chnotif="${n.id}"></div>`, renderChatList: () => {}, rowAgent: s => s.agent || 'hermes',
    spacesOf: id => spaces[id] || [], threadAct: (wid, sid, a) => taps.push([wid, sid, a]), toast: () => {}, W: {}, winAgent: () => '',
  });
  return { api, rows, taps, archived, ctx };
}
const rowsOf = html => [...html.matchAll(/<div class="ch-row-wrap ch-ib-wrap([^"]*)"[^>]*>([\s\S]*?)<\/button><\/div>/g)].map(m => ({ pinned: / pinned/.test(m[1]), id: (/data-ch(?:open|runopen)="([^"]+)"/.exec(m[2]) || [])[1], body: m[2] }));

test('renderer: Signal rows: round avatar, sender line, title, one preview line, time, unread dot, Archive; pinned first', () => {
  const { api, rows, ctx } = part({ records: [{ id: RID('9'), agent: 'hermes', thread: 'bg9', title: 'Renew the permit', ask: 'Stalled: login', failed: true, updatedAt: NOW - 0.3 * H }] });
  assert.equal(api.inboxRowsOn({ id: 'w' }), true);
  const html = api.inboxRowsBody({ id: 'w' }, rows, { awake: [], later: [] });
  const r = rowsOf(html);
  assert.deepEqual(r.map(x => x.id), ['d1', 'read1', 'pr1', 'w1', 'bg9', 'new1', 'y1', 'f1'], 'Daily first, then #priority / urgent (newest first); then newest first with the waiting task in line');
  assert.deepEqual(r.map(x => x.pinned), [true, true, true, false, false, false, false, false]);
  const by = Object.fromEntries(r.map(x => [x.id, x.body]));
  assert.match(by.new1, /<span class="ch-ib-av"[^>]*>✈️<\/span>/, 'avatar: the tag emoji');
  assert.match(by.new1, /<span class="ch-ib-from">Trip<\/span><time>ago<\/time>/, 'sender line: the first tag, then the time');
  assert.match(by.new1, /<b class="ch-ib-t">T new1<\/b><span class="ch-ib-mk"><i class="ch-chan-dot new"/, 'title with the unread dot');
  assert.match(by.new1, /<span class="ch-ib-pv">Reply of new1<\/span>/, 'one line of the latest agent message');
  assert.match(by.y1, /<span class="ch-ib-pv">A or B\?<\/span>/, 'needs you: the ask');
  assert.match(by.y1, /ch-chan-dot"/, 'needs you: amber');
  assert.match(by.read1, /ch-ib-av ch-ib-ag[^>]*><span class="ag-sig">hermes/, 'no tag: the agent icon');
  assert.match(by.bg9, /<em class="att failed">Failed:<\/em> Stalled: login/);
  assert.equal((html.match(/class="ch-ib-arch"/g) || []).length, r.length, 'every row has Archive');
  const shared = ctx.WizCore.inboxRowsFacts(); // what the count and badges (chats-ready.js) read
  assert.equal(shared.quiet({ quietReply: true }), true);
  assert.equal(shared.pin({ id: 'd1' }), 1);
  assert.equal(shared.extra(rows), 1, 'the waiting task counts once');
  assert.match(html, /<section class="ch-sec ch-act ch-ib open" data-sec="ready">.*<span>Inbox<\/span><small>8<\/small>/s, 'the Inbox count is the row count');
  assert.doesNotMatch(html, /data-sec="recent"|data-sec="working"|T q1|T w0/, 'no Recent, no Working, no quiet reply, no unanswered send');
});

test('renderer: Archive taps archive the thread (as its actions do) and a waiting task\'s record', async () => {
  const { api, taps, archived } = part({ records: [{ id: RID('9'), agent: 'hermes', thread: 'bg9', title: 'x', ask: 'y', updatedAt: NOW }] });
  const tap = attr => ({ target: { closest: sel => sel === `[${attr.split('=')[0]}]` ? { dataset: attr.startsWith('data-chibarch') ? { chibarch: attr.split('=')[1] } : { chibrec: attr.split('=')[1] } } : null } });
  assert.equal(api.inboxRowsClick(tap('data-chibarch=read1'), { id: 'w' }), true);
  assert.deepEqual(taps, [['w', 'read1', 'done']]);
  assert.equal(api.inboxRowsClick(tap('data-chibrec=' + RID('9')), { id: 'w' }), true);
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(archived, [RID('9')]);
  assert.equal(api.inboxRowsClick({ target: { closest: () => null } }, { id: 'w' }), false, 'any other tap is not ours');
});

test('renderer: switch off: not on, no rows drawn by this part, no box read for waiting tasks', () => {
  let asked = 0;
  const { api, ctx } = part({ on: false });
  assert.equal(api.inboxRowsOn({ id: 'w' }), false);
  assert.equal(api.inboxRowsFacts(), null);
  assert.equal(ctx.WizCore.inboxRowsFacts(), null);
  assert.equal(api.inboxRowsClick({ target: { closest: () => ({ dataset: { chibarch: 'x' } }) } }, { id: 'w' }), false);
  assert.equal(asked, 0);
});
