// Inbox or Sent (wizard-ux issue 1829): with Inbox until archived (or Inbox rows) on, every thread is in exactly one
// place. Runs the real list model (placeOf, activityGroups, sentShown), the real Chats ready part (core/chats-ready.js:
// inboxPlace, inboxIds, the Inbox count) and the real Sent part (core/chats-sent.js, one row per thread since wizard-ux
// issue 1880) over one fake box: a mixed set of
// threads with the box's Sent rows. Browser proof: tests/qa-chats-inbox-sent-place.cjs (phone, Classic, AI apps sidebar).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { modelContext } from './fixtures/chats-list-model.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const J = v => JSON.parse(JSON.stringify(v));
const M = modelContext({}).WizChatsListModel;
const H = 3600e3, NOW = Date.now();
const sid = c => 'sent_' + c.repeat(24);
// The box's session rows (as live.js normalises them) and Sent rows (as live-channels.js sentLog reads them).
const fyi = ask => ({ state: 'fyi', ask });
const THREADS = () => [
  { id: 'quiet', title: 'Clip edit', status: 'completed', at: NOW - 0.1 * H, quietReply: true, attention: fyi('Clip edit is with Miguel. Nothing needed from you.'), messageCount: 4, lastAssistantAt: new Date(NOW - 0.1 * H).toISOString() },
  { id: 'mac', title: 'Mac app', status: 'completed', at: NOW - 0.2 * H, attention: fyi('The Mac app build is still running.'), messageCount: 2, lastAssistantAt: new Date(NOW - 0.2 * H).toISOString() },
  { id: 'needs', title: 'Flight', status: 'completed', at: NOW - 0.3 * H, attention: { state: 'needs_you', ask: 'Window or aisle?' }, messageCount: 2 },
  { id: 'failed', title: 'Export', status: 'failed', at: NOW - 0.4 * H, messageCount: 2 },
  { id: 'run', title: 'Mine is not displaying this', status: 'running', at: NOW - 0.05 * H, messageCount: 3, lastAssistantAt: new Date(NOW - H).toISOString() },
  { id: 'alert', title: 'Morning report', status: 'completed', at: NOW - 0.5 * H, attention: fyi('Three meetings today.'), messageCount: 1, previewRole: 'assistant' },
];
const sentRow = r => ({ text: 'Words', rules: [], tags: [], source: 'reply', urgent: false, corrected: null, wouldRoute: null, decidedBy: 'owner_words', answer: '', ...r });
const SENT = () => [
  { id: sid('a'), at: NOW - 0.05 * H, route: 'thread', state: 'running', thread: 'run', record: null, wantsReply: true, quiet: false },
  { id: sid('b'), at: NOW - 0.1 * H, route: 'thread', state: 'done', thread: 'quiet', record: null, wantsReply: false, quiet: true, answer: 'Nothing needed from you.' },
  { id: sid('c'), at: NOW - 0.2 * H, route: 'thread', state: 'done', thread: 'mac', record: null, wantsReply: true, quiet: false },
  { id: sid('d'), at: NOW - 0.3 * H, route: 'agent', state: 'needs_you', thread: 'needs', record: null, wantsReply: true, quiet: false },
  { id: sid('e'), at: NOW - 0.4 * H, route: 'agent', state: 'failed', thread: 'failed', record: null, wantsReply: true, quiet: false },
  { id: sid('f'), at: NOW - 2 * H, route: 'agent', state: 'done', thread: 'quiet', record: null, wantsReply: true, quiet: false },
  { id: sid('0'), at: NOW - 3 * H, route: 'agent', state: 'done', thread: 'run', record: null, wantsReply: true, quiet: false },
].map(sentRow);
const needs = s => ['needs_you', 'check'].includes(s.attention?.state) && s.status !== 'running';
const unread = () => false; // everything read: being read never decides the place
const quiet = s => s.quietReply === true && !needs(s) && s.status !== 'running';
const groups = rows => ({ working: rows.filter(s => s.status === 'running'), errors: rows.filter(s => s.status === 'failed'), ready: rows.filter(s => !['running', 'failed'].includes(s.status) && !s.archived && !s.deferred), deferred: rows.filter(s => s.deferred && !s.archived), archive: rows.filter(s => s.archived) });

// The real chats-ready part (inboxPlace / inboxIds / the Inbox count) and the real Sent part over one fake box.
function shell({ tweaks = 'wizard/inbox-until-archived', threads = THREADS(), sent = SENT() } = {}) {
  const listeners = [];
  const ctx = { console, Date, Map, Set, structuredClone, document: { documentElement: { dataset: { tweaks } }, addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} } };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.addEventListener = () => {}; ctx.WizCore = { chatsParts: {} };
  modelContext(ctx);
  const st = { ok: true, gone: false, rows: sent, next: null };
  const LIVE = { ok: true, sessionsFor: () => threads, session: id => threads.find(t => t.id === id) || null, cardAt: t => new Date(t.at).toISOString(), workGroups: rows => groups(rows || threads), quietReply: quiet, onChange: fn => listeners.push(fn),
    sentLog: { state: () => st, fresh() {}, read: async () => st } };
  vm.runInContext(read('web/core/chats-ready.js'), ctx);
  vm.runInContext(read('web/core/chats-sent.js'), ctx);
  ctx.WizCore.chatsParts.ready({ actNeeds: needs, actUnread: unread, CH: {}, chanAt: s => s.at, elOf: () => null, H: { root: () => ({ querySelectorAll: () => [] }) }, LIST_PLACE_KEY: 'k', LIST_PLACE_TTL: 1, listPlace: () => null, listSig: () => '', LIVE, W: {} });
  const W = { main: { id: 'main', thread: null } }, CH = { main: { sent: true } };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const p = ctx.WizCore.chatsParts.sent({ ago: () => '3m', ch: id => CH[id], CH, CHAN_VIEW_KEY: 'k', chanElsewhere: () => false, chanSide: () => false, chatVars: { chanView: 'activity' }, clip: (s, n) => String(s).slice(0, n), elOf: () => ({}), esc, H: { win: id => W[id] },
    LIVE, openChat() {}, renderChatList() {}, rerenderList() {}, toast() {}, W, winAgent: () => '',
    // Sent's rows are Inbox's own rows (wizard-ux issue 1880); here a stand-in that keeps the thread each row opens.
    ibThreadRow: (t, _pin, sent) => `<div data-chopen="${esc(t.id)}" data-chsentthread="${esc(sent?.key || '')}"></div>`, ibRow: o => `<div ${o.open}></div>`, ibMark: () => '', ibTagFace: () => ({ av: '', from: '' }) });
  // Inbox: the Inbox list's threads (the count the badges show); Sent: the threads the drawn Sent rows open.
  const inbox = () => J((ctx.WizCore.inboxIds(LIVE) ? [...ctx.WizCore.inboxIds(LIVE)] : []).sort());
  const sentList = () => [...new Set([...p.sentBody(W.main).matchAll(/data-chsentthread="([^"]+)"/g)].map(m => m[1]))].sort();
  return { ctx, LIVE, st, threads, inbox, sentList, p, W, listeners };
}

// owner-correction: humanitylabs-org/wizard-ux#1829 · 2026-11-25 · "why is it displaying in my sent box, but also in my inbox? That shouldn't happen. Things should be in one or the other."
test('James: every thread is in Inbox or in Sent, never both, over quiet-done, answered, needs you, failed, running and an alert', () => {
  const s = shell();
  const inbox = s.inbox(), sent = s.sentList();
  assert.deepEqual(inbox.filter(id => sent.includes(id)), [], 'no thread in both');
  assert.deepEqual(inbox, ['alert', 'failed', 'mac', 'needs'], 'Inbox: what needs him (needs you, failed, an answer he asked for, an alert he didn\'t start)');
  assert.deepEqual(sent, ['quiet', 'run'], 'Sent: the quiet "nothing needed" reply and the run still working');
  assert.deepEqual([...THREADS().map(t => t.id)].filter(id => !inbox.includes(id) && !sent.includes(id)), [], 'and none in neither');
});

// owner-correction: humanitylabs-org/wizard-ux#1829 · 2026-11-25 · "useless responses just stay in the sent box and don't... bounce back into the inbox unless they actually need something from me."
test('James: "Sent to Miguel, done" answered fyi stays in Sent; "is the mac app ready?" answered fyi is in Inbox', () => {
  const s = shell();
  assert.ok(!s.inbox().includes('quiet'), 'the quiet reply is not in Inbox');
  assert.ok(s.sentList().includes('quiet'), 'it is in Sent');
  assert.ok(s.inbox().includes('mac'), 'the answer to his question is in Inbox');
  assert.ok(!s.sentList().includes('mac'), 'and not in Sent');
});

test('a working thread he sent into is only in Sent (Working), never in Inbox; when it ends the outcome decides', () => {
  const s = shell();
  assert.ok(!s.inbox().includes('run') && s.sentList().includes('run'));
  assert.match(s.p.sentBody(s.W.main), /<span>Working<\/span><small>1<\/small>/, 'Sent › Working counts it');
  // The run ends with a question for him: Inbox. Ends quietly: Sent.
  const t = s.threads.find(x => x.id === 'run');
  t.status = 'completed'; t.attention = { state: 'needs_you', ask: 'Which build?' }; s.st.rows = s.st.rows.map(r => r.id === sid('a') ? { ...r, state: 'needs_you' } : r);
  assert.ok(s.inbox().includes('run') && !s.sentList().includes('run'), 'needs him: Inbox');
  t.attention = fyi('Done.'); t.quietReply = true; s.st.rows = s.st.rows.map(r => r.id === sid('a') ? { ...r, state: 'done', quiet: true, wantsReply: false } : r);
  assert.ok(!s.inbox().includes('run') && s.sentList().includes('run'), 'quiet: Sent');
});

test('a needs-you outcome on a thread in Sent moves it to Inbox on the next change, and the layouts are told', () => {
  const s = shell(); let told = 0;
  s.ctx.WosSkinHost = { rendered: () => { told++; } };
  for (const fn of s.listeners) fn();
  const t = s.threads.find(x => x.id === 'quiet'); delete t.quietReply; t.attention = { state: 'needs_you', ask: 'Miguel wants the raw files. Send them?' };
  s.st.rows = s.st.rows.map(r => r.id === sid('b') ? { ...r, state: 'needs_you', quiet: false } : r);
  const before = told; for (const fn of s.listeners) fn();
  assert.ok(s.inbox().includes('quiet') && !s.sentList().includes('quiet'));
  assert.equal(told, before + 1, 'the Inbox ids changed: one repaint for layouts that draw their own Inbox');
  for (const fn of s.listeners) fn(); assert.equal(told, before + 1, 'no change: no repaint');
});

test('opening an Inbox thread keeps it there until Archive (#1810); a reply that ends quiet takes it to Sent', () => {
  const s = shell();
  assert.ok(s.inbox().includes('mac'));
  // read (unread never decides) — still in Inbox; Archive: out of both lists.
  assert.ok(s.inbox().includes('mac'), 'opened: still in Inbox');
  s.threads.find(x => x.id === 'mac').archived = true;
  assert.ok(!s.inbox().includes('mac'), 'archived: gone from Inbox');
  // He replies "done" in an Inbox thread and the agent answers quietly: it goes to Sent.
  const n = s.threads.find(x => x.id === 'alert'); n.quietReply = true; s.st.rows.unshift(sentRow({ id: sid('1'), at: NOW, route: 'thread', state: 'done', thread: 'alert', record: null, wantsReply: false, quiet: true }));
  assert.ok(!s.inbox().includes('alert') && s.sentList().includes('alert'));
});

test('new chats from the orb / typed: the Sent row\'s final state and wants_reply decide; missing or unknown goes to Inbox', () => {
  const f = { needs, quiet: () => false, working: () => false };
  const t = { id: 'x', status: 'completed' };
  assert.equal(M.placeOf(t, [{ state: 'done', wantsReply: false, at: 1 }], f), 'sent', 'done, asked for nothing');
  assert.equal(M.placeOf(t, [{ state: 'done', wantsReply: true, at: 1 }], f), 'inbox', 'done, he asked: Inbox');
  assert.equal(M.placeOf(t, [{ state: 'unknown', wantsReply: false, at: 1 }], f), 'inbox', 'unknown outcome: Inbox');
  assert.equal(M.placeOf(t, [{ state: 'running', at: 1 }], f), 'inbox', 'the log still says running but the run ended: Inbox');
  assert.equal(M.placeOf(t, [], f), 'inbox', 'no Sent row: Inbox');
  assert.equal(M.placeOf(t, undefined, f), 'inbox');
  assert.equal(M.placeOf(t, [{ state: 'done', quiet: true, at: 1 }, { state: 'needs_you', at: 2 }], f), 'inbox', 'the newest row decides');
  assert.equal(M.placeOf({ id: 'y', status: 'running' }, [], { ...f, working: () => true }), 'inbox', 'a run he didn\'t start stays visible in Inbox');
  assert.equal(M.placeOf({ id: 'y', status: 'running' }, [{ state: 'running', at: 1 }], { ...f, working: () => true }), 'sent');
  assert.equal(M.placeOf({ id: 'z', status: 'waiting_for_approval' }, [{ state: 'running', at: 1 }], f), 'inbox', 'approval: Inbox');
});

test('Inbox rows (on for everyone): the same split, no working mark in Inbox', () => {
  const s = shell({ tweaks: '' });
  s.ctx.WizCore.inboxRowsFacts = () => ({ quiet, pin: () => 0, extra: () => 0 });
  const inbox = s.inbox(), sent = s.sentList();
  assert.deepEqual(inbox.filter(id => sent.includes(id)), []);
  assert.ok(!inbox.includes('run') && sent.includes('run'));
  assert.ok(!inbox.includes('quiet') && sent.includes('quiet'));
  const src = read('web/core/chats-inboxrows.js');
  assert.doesNotMatch(src, /'Working…'/, 'no "Working…" line on an Inbox row');
});

test('no switch (Inbox rows on for everyone, wizard-ux issue 1779): with no data-tweaks the split holds, one place per thread', () => {
  const s = shell({ tweaks: '' });
  const inbox = s.inbox(), sent = s.sentList();
  assert.deepEqual(inbox, ['alert', 'failed', 'mac', 'needs'], 'Inbox placement with no switch on');
  assert.deepEqual(sent, ['quiet', 'run'], 'Sent keeps the quiet reply and the running send');
  assert.equal(s.ctx.WizCore.inboxKeep(), true);
  assert.notEqual(s.ctx.WizCore.inboxPlace(s.LIVE), null);
});
