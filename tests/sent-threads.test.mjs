// Sent as threads (wizard-ux issue 1880, switch wizard/sent-threads, off by default). Runs the real list model
// (sentThreads, placeOf, activityGroups), the real Chats ready part (core/chats-ready.js: inboxIds), the real Inbox rows
// part (core/chats-inboxrows.js: ibThreadRow) and the real Sent part (core/chats-sent.js) over one fake box. With the
// switch on, Sent lists threads, one row per thread, drawn by Inbox's own thread row; a thread is in Inbox or in Sent,
// never both. Browser proof: tests/qa-chats-sent-threads.cjs (phone, Classic, AI apps sidebar).
// Run: node --test tests/sent-threads.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { modelContext } from './fixtures/chats-list-model.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const J = v => JSON.parse(JSON.stringify(v));
const SW = 'wizard/sent-threads';
const H = 3600e3, NOW = Date.now();
const sid = c => 'sent_' + c.repeat(24), rid = c => 'inbox_' + c.repeat(24);
const iso = t => new Date(t).toISOString();
const THREADS = () => [
  { id: 'trip', title: 'Lyon trip', status: 'completed', at: NOW - 0.1 * H, quietReply: true, messageCount: 6, preview: 'Booked: the 9:04 train, seat 42.', previewRole: 'assistant', lastAssistantAt: iso(NOW - 0.1 * H) },
  { id: 'mac', title: 'Mac app', status: 'completed', at: NOW - 0.2 * H, attention: { state: 'fyi', ask: 'The build is ready.' }, messageCount: 2, preview: 'The build is ready.', previewRole: 'assistant', lastAssistantAt: iso(NOW - 0.2 * H) },
  { id: 'flight', title: 'Flight', status: 'completed', at: NOW - 0.3 * H, attention: { state: 'needs_you', ask: 'Window or aisle?' }, messageCount: 2, preview: 'Window or aisle?', previewRole: 'assistant' },
  { id: 'run', title: 'Clean the photo folder', status: 'running', at: NOW - 0.05 * H, messageCount: 1, preview: 'Clean the photo folder', previewRole: 'user' },
  { id: 'old', title: 'Old errand', status: 'completed', at: NOW - 5 * H, quietReply: true, archived: true, messageCount: 2, preview: 'Done.', previewRole: 'assistant' },
  { id: 'nap', title: 'Snoozed errand', status: 'completed', at: NOW - 6 * H, quietReply: true, deferred: true, deferredAt: iso(NOW - H), messageCount: 2, preview: 'Done.', previewRole: 'assistant' },
];
const sentRow = r => ({ text: 'Words', rules: [], tags: [], source: 'orb', urgent: false, corrected: null, wouldRoute: null, decidedBy: 'model', answer: '', record: null, wantsReply: true, quiet: false, route: 'agent', ...r });
// Three sends into the Lyon trip thread (the newest a quiet reply), one into each other thread, a background task whose
// hidden worker isn't loaded, and one still being routed.
const SENT = () => [
  { id: sid('1'), at: NOW - 0.05 * H, state: 'running', thread: 'run', text: 'Clean the photo folder' },
  { id: sid('2'), at: NOW - 0.1 * H, route: 'thread', state: 'done', thread: 'trip', text: 'Thanks, that works', wantsReply: false, quiet: true },
  { id: sid('3'), at: NOW - 0.15 * H, route: 'thread', state: 'done', thread: 'trip', text: 'Take the earlier one', wantsReply: false, quiet: true },
  { id: sid('4'), at: NOW - 0.2 * H, state: 'done', thread: 'mac', text: 'Is the mac app ready?' },
  { id: sid('5'), at: NOW - 0.3 * H, state: 'needs_you', thread: 'flight', text: 'Book my flight to Lisbon' },
  { id: sid('6'), at: NOW - 0.4 * H, route: 'dump', state: 'done', thread: null, record: rid('a'), text: 'Note to self: call mom about Sunday lunch' },
  { id: sid('7'), at: NOW - 0.02 * H, route: null, state: 'routing', thread: null, text: 'Remind me about the dentist' },
  { id: sid('8'), at: NOW - 1 * H, state: 'done', thread: 'trip', text: 'Find the cheapest train to Lyon on Saturday', wantsReply: false },
  { id: sid('9'), at: NOW - 5 * H, state: 'done', thread: 'old', text: 'Archived one', quiet: true, wantsReply: false },
  { id: sid('0'), at: NOW - 6 * H, state: 'done', thread: 'nap', text: 'Snoozed one', quiet: true, wantsReply: false },
].map(sentRow);
const needs = s => ['needs_you', 'check'].includes(s.attention?.state) && s.status !== 'running';
const unread = () => false;
const quiet = s => s.quietReply === true && !needs(s) && s.status !== 'running';
const groups = rows => ({ working: rows.filter(s => s.status === 'running'), errors: rows.filter(s => s.status === 'failed'), ready: rows.filter(s => !['running', 'failed'].includes(s.status) && !s.archived && !s.deferred), deferred: rows.filter(s => s.deferred && !s.archived), archive: rows.filter(s => s.archived) });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function shell({ tweaks = SW, threads = THREADS(), sent = SENT(), agent = '' } = {}) {
  const ctx = { console, Date, Map, Set, structuredClone, document: { documentElement: { dataset: { tweaks } }, addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} } };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.addEventListener = () => {}; ctx.WizCore = { chatsParts: {} };
  modelContext(ctx);
  const st = { ok: true, gone: false, rows: sent, next: null };
  const corrections = [];
  const LIVE = { ok: true, sessionsFor: () => threads.filter(s => !s.hidden), session: id => threads.find(s => s.id === id) || null, cardAt: s => iso(s.at), workGroups: rows => groups(rows || threads), quietReply: quiet, onChange() {},
    agentInbox: { records: () => [{ id: rid('a'), title: 'Call mom', thread: 'worker-a' }], needs: () => [] },
    sentLog: { state: () => st, fresh() {}, read: async () => st, correct: async (id, should) => { corrections.push([id, should]); return { changed: true, row: null }; } } };
  for (const f of ['chats-ready.js', 'chats-inboxrows.js', 'chats-sent.js']) vm.runInContext(read('web/core/' + f), ctx);
  ctx.WizCore.chatsParts.ready({ actNeeds: needs, actUnread: unread, CH: {}, chanAt: s => s.at, elOf: () => null, H: { root: () => ({ querySelectorAll: () => [] }) }, LIST_PLACE_KEY: 'k', LIST_PLACE_TTL: 1, listPlace: () => null, listSig: () => '', LIVE, W: {} });
  const ib = ctx.WizCore.chatsParts.inboxrows({ actMark: s => s.status === 'running' ? 'working' : needs(s) ? 'needs' : '', actNeeds: needs, actUnread: unread, AGS: () => ({ sigil: a => `<span class="ag-sig">${a.id}</span>`, defaultId: () => 'hermes' }), agentName: id => id || 'Wizard', agentRec: id => ({ id }),
    ago: t => typeof t === 'number' ? 'n' : '3m', attOf: s => s.attention || null, chanAt: s => s.at, chanFace: n => ({ emoji: '💬', label: n, own: false }), chanStore: () => null, chatVars: { secOpen: {} }, ch: () => ({}), clip: (s, n) => String(s).slice(0, n), elOf: () => null, esc, isWorking: s => s.status === 'running', LIVE,
    noteAt: () => 0, noteRow: () => '', renderChatList() {}, rowAgent: () => 'hermes', spacesOf: () => [], threadAct() {}, toast() {}, W: {}, winAgent: () => '' });
  const W = { main: { id: 'main', thread: null, agent } }, CH = { main: { sent: true } }, chatVars = { chanView: 'activity', secOpen: {}, rowSheet: null };
  const sheet = { html: '<div class="ch-sheet-t">T</div>', insertAdjacentHTML(where, h) { this.html = where === 'afterend' ? this.html + h : h + this.html; } };
  const listEl = { html: '', insertAdjacentHTML(_, h) { this.html += h; }, querySelectorAll: () => [], querySelector: q => q === '.ch-sheet .ch-sheet-b' ? { querySelector: () => sheet, insertAdjacentHTML: (w, h) => { sheet.html = h + sheet.html; } } : null };
  const p = ctx.WizCore.chatsParts.sent({ ago: t => typeof t === 'number' ? 'n' : '3m', ch: id => CH[id], CH, CHAN_VIEW_KEY: 'k', chanElsewhere: () => false, chanSide: () => false, chatVars, clip: (s, n) => String(s).slice(0, n), closeRowSheet: () => { chatVars.rowSheet = null; }, elOf: () => listEl, esc, H: { win: id => W[id] },
    ibMark: ib.ibMark, ibRow: ib.ibRow, ibTagFace: ib.ibTagFace, ibThreadRow: ib.ibThreadRow, LIVE, openChat() {}, renderChatList() {}, rerenderList() {}, toast() {}, W, winAgent: w => w.agent || '' });
  const inbox = () => J((ctx.WizCore.inboxIds(LIVE) ? [...ctx.WizCore.inboxIds(LIVE)] : []).sort());
  const body = () => p.sentBody(W.main);
  // The threads the Sent rows open (a thread row's data-chopen, a not-yet-loaded one's data-chsentthread).
  const sentList = () => [...body().matchAll(/<button type="button" data-part="thread-row"[^>]*?(?:data-chopen="([^"]+)"|data-chsent="[^"]+" data-chsentthread="([^"]+)")/g)].map(m => m[1] || m[2]);
  return { ctx, LIVE, st, threads, inbox, body, sentList, p, W, ib, sheet, corrections, chatVars };
}
const rowsOf = html => [...html.matchAll(/<div class="ch-row-wrap ch-ib-wrap[^"]*"[\s\S]*?<\/button>(?:<button type="button" class="ch-ib-arch"[\s\S]*?<\/button>)?<\/div>/g)].map(m => m[0]);

// owner-correction: humanitylabs-org/wizard-ux#1880 · 2026-11-26 · "The same thread moves to the sent box or the inbox, depending on whether it needs my attention."
test('James: Sent lists threads; Inbox ∩ Sent = ∅ by thread id, and every thread he sent into is in one of them', () => {
  const s = shell();
  const inbox = s.inbox(), sent = s.sentList();
  assert.deepEqual(inbox.filter(id => sent.includes(id)), [], 'Inbox ∩ Sent = ∅');
  assert.deepEqual(inbox, ['flight', 'mac'], 'Inbox: the needs-you thread and the answer he asked for');
  assert.deepEqual(sent, ['send:' + sid('7'), 'run', 'trip', 'rec:' + rid('a')], 'Sent: newest first, one row per thread (a send still being routed and a background task by their own key)');
  assert.equal(new Set(sent).size, sent.length, 'no thread twice');
  assert.ok(!sent.includes('old') && !sent.includes('nap'), 'archived and snoozed threads stay in Archived / Snoozed');
});

// owner-correction: humanitylabs-org/wizard-ux#1880 · 2026-11-26 · "Right now the sent box is just putting a random title, and it's not clear what thread this is part of."
test('James: a thread with three sends is one Sent row, the same row Inbox draws for it (title, avatar, last message, time), never his words as the title', () => {
  const s = shell();
  const rows = rowsOf(s.body());
  const trip = rows.filter(r => r.includes('data-chopen="trip"'));
  assert.equal(trip.length, 1, 'three sends, one row');
  assert.match(trip[0], /<b class="ch-ib-t">Lyon trip<\/b>/, 'the thread\'s own title');
  assert.match(trip[0], /<span class="ch-ib-pv">Booked: the 9:04 train, seat 42\.<\/span>/, 'its last message');
  for (const words of ['Thanks, that works', 'Take the earlier one', 'Find the cheapest train']) assert.ok(!s.body().includes(words), 'no send as a row: ' + words);
  // Identical to the Inbox row for the same thread: the Inbox renderer's output, only Sent's key for the sheet added.
  const inboxRow = s.ib.ibThreadRow(s.threads.find(t => t.id === 'trip'), 0);
  assert.equal(trip[0].replace(' ch-st-wrap', '').replace(' ch-st-row', '').replace(' data-chsentthread="trip"', ''), inboxRow, 'the same row as Inbox');
  assert.match(trip[0], /class="ch-ib-arch" data-chibarch="trip"/, 'Archive, as in Inbox');
});

test('Working while it runs, Processed when done, each under Inbox\'s section header; no "in Inbox" status anywhere', () => {
  const s = shell();
  const html = s.body();
  const secs = [...html.matchAll(/<section class="ch-sec ch-act ch-ib ch-sr ch-st open" data-sec="(\w+)"><button class="ch-sec-h" data-sectoggle="\1" aria-expanded="true"><span>(\w+)<\/span><small>(\d+)<\/small>/g)].map(m => [m[2], +m[3]]);
  assert.deepEqual(secs, [['Working', 2], ['Processed', 2]]);
  assert.doesNotMatch(html, /in Inbox/);
  const run = rowsOf(html).find(r => r.includes('data-chopen="run"'));
  assert.match(run, /<i class="ch-spin"/, 'the spinner while it runs');
});

test('a thread moves: needs you takes it out of Sent into Inbox, done quietly brings it back, with no reload', () => {
  const s = shell();
  const t = s.threads.find(x => x.id === 'trip');
  t.attention = { state: 'needs_you', ask: 'The 9:04 is sold out. Take the 9:34?' }; delete t.quietReply;
  s.st.rows = s.st.rows.map(r => r.id === sid('2') ? { ...r, state: 'needs_you', quiet: false } : r);
  assert.ok(s.inbox().includes('trip') && !s.sentList().includes('trip'), 'needs him: Inbox only');
  t.attention = { state: 'fyi', ask: 'Booked.' }; t.quietReply = true;
  s.st.rows = s.st.rows.map(r => r.id === sid('2') ? { ...r, state: 'done', quiet: true } : r);
  assert.ok(!s.inbox().includes('trip') && s.sentList().includes('trip'), 'nothing for him: Sent only');
});

test('a thread not loaded yet (background task, hidden worker) is still a row: its task\'s title, its own key; a send being routed shows its words', () => {
  const s = shell();
  const rows = rowsOf(s.body());
  const task = rows.find(r => r.includes(`data-chsentthread="rec:${rid('a')}"`));
  assert.match(task, /<b class="ch-ib-t">Call mom<\/b>/, 'the task record\'s title');
  assert.match(task, /Ran quietly · Done/, 'where it went and what happened as the small line');
  const routing = rows.find(r => r.includes(`data-chsentthread="send:${sid('7')}"`));
  assert.match(routing, /Remind me about the dentist/);
  // A hidden worker the shell has read by id: its own title and last message.
  s.threads.push({ id: 'worker-b', hidden: true, title: 'Plants', status: 'completed', at: NOW, preview: 'Watered reminder set for 6pm.' });
  s.st.rows.push(sentRow({ id: sid('b'), at: NOW - 0.01 * H, route: 'dump', state: 'done', thread: 'worker-b', text: 'Remind me to water the plants' }));
  const w = rowsOf(s.body()).find(r => r.includes('data-chsentthread="worker-b"'));
  assert.match(w, /<b class="ch-ib-t">Plants<\/b>[\s\S]*Watered reminder set for 6pm\./);
});

test('his sends stay reachable in the row\'s actions sheet: "Sent from you" lists the thread\'s sends with the corrections', async () => {
  const s = shell();
  assert.equal(s.p.sentSends('main', 'trip'), true);
  const h = s.sheet.html;
  assert.match(h, /Sent from you · 3/);
  const items = [...h.matchAll(/<li data-sentid="([^"]+)"><b>([^<]+)<\/b>/g)].map(m => m[2]);
  assert.deepEqual(items, ['Thanks, that works', 'Take the earlier one', 'Find the cheapest train to Lyon on Saturday'], 'newest first');
  assert.match(h, new RegExp(`data-rssentfix="quiet" data-id="${sid('8')}"`), 'the corrections for the newest send that went somewhere');
  const btn = { dataset: { rssentfix: 'reply', id: sid('8') }, disabled: false };
  s.p.sentClick({ target: { closest: q => q === '[data-rssentfix]' ? btn : null } }, 'main', s.W.main);
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(s.corrections, [[sid('8'), true]], 'the correction posts for that send');
});

test('the Sent tab is the main agent\'s list only (routed agents: host-profile, container, restricted have none)', () => {
  for (const agent of ['host-profile', 'container', 'restricted']) assert.equal(shell({ agent }).p.sentTabsOn({ id: 'main', thread: null, agent }), false, agent);
  assert.equal(shell().p.sentTabsOn({ id: 'main', thread: null, agent: '' }), true);
});

test('switch off: Sent and Inbox are today\'s (one Sent row per send, the same Inbox ids)', () => {
  const off = shell({ tweaks: 'wizard/inbox-until-archived' }), base = off.body();
  assert.equal(off.p.sentThreadsOn(), false);
  assert.match(base, /class="ch-row ch-ib-row ch-sr-row st-running/, 'today\'s Sent rows (wizard-ux issue 1814, on for everyone)');
  assert.equal([...base.matchAll(/data-chsent=/g)].length, off.st.rows.filter(r => !(r.thread && off.inbox().includes(r.thread))).length, 'one row per send');
  assert.doesNotMatch(base, /ch-st-row|data-chsentthread/);
  assert.equal(off.p.sentSends('main', 'trip'), false, 'no sends block while off');
  const none = shell({ tweaks: '' });
  assert.equal(none.ctx.WizCore.inboxIds(none.LIVE), null, 'no Inbox placement with every switch off');
  assert.equal(none.ctx.WizCore.inboxKeep(), false);
  assert.equal(shell().ctx.WizCore.inboxKeep(), true, 'on: the one-place rule is on');
});

test('model: sentThreads groups by thread, then record, then the send; newest first', () => {
  const M = modelContext({}).WizChatsListModel;
  assert.equal(M.sentThreadsOn('a wizard/sent-threads b'), true);
  assert.equal(M.sentThreadsOn('wizard/inbox-rows'), false);
  const g = M.sentThreads([sentRow({ id: 'a', at: 1, thread: 't' }), sentRow({ id: 'b', at: 3, thread: 't', state: 'running' }), sentRow({ id: 'c', at: 2, record: 'r' }), sentRow({ id: 'd', at: 4 })], new Set(), {});
  assert.deepEqual(J(g.map(x => [x.key, x.sends.map(r => r.id), x.working])), [['send:d', ['d'], false], ['t', ['b', 'a'], true], ['rec:r', ['c'], false]]);
  assert.deepEqual(J(M.sentThreads([sentRow({ id: 'a', at: 1, thread: 't' }), sentRow({ id: 'c', at: 2, record: 'r' })], new Set(['t', 'r'])).map(x => x.key)), [], 'Inbox ids leave out');
});
