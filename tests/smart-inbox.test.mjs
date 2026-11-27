// Smart inbox (wizard-ux issue 1883, switch wizard/smart-inbox, off by default; James, 26 Nov 2026: "things I send that
// don't require my reply or attention just stay in sent. The only things that come into my inbox are things that
// require my attention in a timely manner"). Runs the real list model (placeOf, sentAsked, sentRest, activityGroups),
// the real Chats ready part (core/chats-ready.js: inboxIds, inboxPlace), the real Inbox rows part (core/chats-inboxrows.js)
// and the real Sent part (core/chats-sent.js) over one fake box. Browser proof: tests/qa-chats-smart-inbox.cjs (30
// threads; phone, Classic, AI apps sidebar; two skins).
// Run: node --test tests/smart-inbox.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { modelContext } from './fixtures/chats-list-model.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const J = v => JSON.parse(JSON.stringify(v));
const SW = 'wizard/smart-inbox';
const M = modelContext({}).WizChatsListModel;
const H = 3600e3, NOW = Date.now();
const sid = c => 'sent_' + c.repeat(24);
const iso = t => new Date(t).toISOString();
const att = (state, ask) => ({ state, ask });
// Owner-started threads have a Sent row; agent-started ones (watch, schedule, helper result, older than the log) don't.
const THREADS = () => [
  { id: 'needs-mine', title: 'Flight seat', status: 'completed', at: NOW - 0.1 * H, attention: att('needs_you', 'Window or aisle?') },
  { id: 'needs-agent', title: 'Weekly payroll', status: 'completed', at: NOW - 0.2 * H, attention: att('needs_you', 'Move €240 from savings?') },
  { id: 'check-mine', title: 'Signal chat names', status: 'completed', at: NOW - 0.3 * H, attention: att('check', 'Check the names look right.') },
  { id: 'check-agent', title: 'Forum setup', status: 'completed', at: NOW - 0.4 * H, attention: att('check', 'Have a look.') },
  { id: 'done-mine', title: 'Clip edit', status: 'completed', at: NOW - 0.5 * H, attention: att('done', 'Sent it.') },
  { id: 'done-agent', title: 'Nightly backup', status: 'completed', at: NOW - 0.6 * H, attention: att('done', 'Backup finished.') },
  { id: 'fyi-mine', title: 'Launch plan', status: 'completed', at: NOW - 0.7 * H, attention: att('fyi', 'Plan updated.') },
  { id: 'fyi-agent', title: 'Morning report', status: 'completed', at: NOW - 0.8 * H, attention: att('fyi', 'Three meetings.') },
  { id: 'failed-agent', title: 'Calendar sync', status: 'failed', at: NOW - 0.9 * H },
  { id: 'approval', title: 'Pay the plumber', status: 'waiting_for_approval', at: NOW - 1.0 * H },
  { id: 'asked', title: 'Mac app', status: 'completed', at: NOW - 1.1 * H, attention: att('fyi', 'Still building.') },
  { id: 'run-mine', title: 'Photo folder', status: 'running', at: NOW - 0.05 * H },
  { id: 'run-agent', title: 'Price watch', status: 'running', at: NOW - 0.06 * H },
  { id: 'new-chat', title: 'Shopping list', status: 'completed', at: NOW - 1.2 * H, attention: att('done', 'Started the list.') },
  { id: 'old', title: 'Tax folder', status: 'completed', at: NOW - 30 * H },
  { id: 'gone', title: 'Archived', status: 'completed', at: NOW - 2 * H, archived: true },
].map(s => ({ preview: s.attention?.ask || 'Done.', previewRole: 'assistant', messageCount: 2, ...s }));
const sentRow = r => ({ text: 'Do the thing', rules: [], tags: [], source: 'orb', urgent: false, corrected: null, wouldRoute: null, decidedBy: 'owner_words', answer: '', record: null, wantsReply: true, quiet: false, route: 'agent', state: 'done', ...r });
const SENT = () => [
  { id: sid('1'), at: NOW - 0.1 * H, thread: 'needs-mine', text: 'Book the Friday flight', state: 'needs_you' },
  { id: sid('2'), at: NOW - 0.3 * H, thread: 'check-mine', text: 'Rename the Signal chats', state: 'needs_you' },
  { id: sid('3'), at: NOW - 0.5 * H, thread: 'done-mine', text: 'Send the clip edit to Miguel', rules: ['task_verb'] },
  { id: sid('4'), at: NOW - 0.7 * H, thread: 'fyi-mine', text: 'Keep the launch plan current', route: 'thread', wantsReply: false, rules: ['statement'] },
  { id: sid('5'), at: NOW - 1.1 * H, thread: 'asked', text: 'is the mac app ready?', route: 'thread', rules: ['short_question'] },
  { id: sid('6'), at: NOW - 0.05 * H, thread: 'run-mine', text: 'Clean the photo folder', state: 'running' },
  { id: sid('7'), at: NOW - 1.2 * H, thread: 'new-chat', text: 'Start a shopping list for the party', source: 'new_chat', rules: ['new_chat'] },
].map(sentRow);
const INBOX = ['approval', 'asked', 'failed-agent', 'needs-agent', 'needs-mine'];
const SENT_IDS = ['check-agent', 'check-mine', 'done-agent', 'done-mine', 'fyi-agent', 'fyi-mine', 'new-chat', 'old', 'run-agent', 'run-mine'];
const needs = s => !s.archived && s.status !== 'running' && (['waiting_for_approval', 'unknown'].includes(s.status) || ['needs_you', 'check'].includes(s.attention?.state));
let UNREAD = () => true; // everything unread: being unread never decides
const unread = s => UNREAD(s);
const quiet = s => s.quietReply === true;
const groups = rows => ({ working: rows.filter(s => s.status === 'running'), errors: rows.filter(s => s.status === 'failed'), ready: rows.filter(s => !['running', 'failed'].includes(s.status) && !s.archived && !s.deferred), deferred: rows.filter(s => s.deferred && !s.archived), archive: rows.filter(s => s.archived) });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function shell({ tweaks = `wizard/sent-threads ${SW}`, threads = THREADS(), sent = SENT() } = {}) {
  const ctx = { console, Date, Map, Set, structuredClone, document: { documentElement: { dataset: { tweaks } }, addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} } };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.addEventListener = () => {}; ctx.WizCore = { chatsParts: {} };
  modelContext(ctx);
  const st = { ok: true, gone: false, rows: sent, next: null };
  const LIVE = { ok: true, sessionsFor: () => threads.filter(s => !s.hidden), session: id => threads.find(s => s.id === id) || null, cardAt: s => iso(s.at), workGroups: rows => groups(rows || threads), quietReply: quiet, onChange() {},
    agentInbox: { records: () => [], needs: () => [] }, sentLog: { state: () => st, fresh() {}, read: async () => st } };
  for (const f of ['chats-ready.js', 'chats-inboxrows.js', 'chats-sent.js']) vm.runInContext(read('web/core/' + f), ctx);
  ctx.WizCore.chatsParts.ready({ actNeeds: needs, actUnread: unread, CH: {}, chanAt: s => s.at, elOf: () => null, H: { root: () => ({ querySelectorAll: () => [] }) }, LIST_PLACE_KEY: 'k', LIST_PLACE_TTL: 1, listPlace: () => null, listSig: () => '', LIVE, W: {} });
  const ib = ctx.WizCore.chatsParts.inboxrows({ actMark: s => s.status === 'running' ? 'working' : needs(s) ? 'needs' : '', actNeeds: needs, actUnread: unread, AGS: () => ({ sigil: a => `<span class="ag-sig">${a.id}</span>`, defaultId: () => 'hermes' }), agentName: id => id || 'Wizard', agentRec: id => ({ id }),
    ago: () => '3m', attOf: s => s.attention || null, chanAt: s => s.at, chanFace: n => ({ emoji: '💬', label: n, own: false }), chanStore: () => null, chatVars: { secOpen: {} }, ch: () => ({}), clip: (s, n) => String(s).slice(0, n), elOf: () => null, esc, isWorking: s => s.status === 'running', LIVE,
    noteAt: () => 0, noteRow: () => '', renderChatList() {}, rowAgent: () => 'hermes', spacesOf: () => [], threadAct() {}, toast() {}, W: {}, winAgent: () => '' });
  const facts = ctx.WizCore.inboxRowsFacts?.();
  const W = { main: { id: 'main', thread: null, agent: '' } }, CH = { main: { sent: true } }, chatVars = { chanView: 'activity', secOpen: {}, rowSheet: null };
  const p = ctx.WizCore.chatsParts.sent({ ago: () => '3m', ch: id => CH[id], CH, CHAN_VIEW_KEY: 'k', chanElsewhere: () => false, chanSide: () => false, chatVars, clip: (s, n) => String(s).slice(0, n), closeRowSheet() {}, elOf: () => null, esc, H: { win: id => W[id] },
    ibMark: ib.ibMark, ibRow: ib.ibRow, ibTagFace: ib.ibTagFace, ibThreadRow: ib.ibThreadRow, LIVE, openChat() {}, renderChatList() {}, rerenderList() {}, toast() {}, W, winAgent: () => '' });
  const inbox = () => J((ctx.WizCore.inboxIds(LIVE) ? [...ctx.WizCore.inboxIds(LIVE)] : []).sort());
  const body = () => p.sentBody(W.main);
  const sentList = () => [...body().matchAll(/<button type="button" data-part="thread-row"[^>]*?data-chopen="([^"]+)"/g)].map(m => m[1]).sort();
  const working = () => { const b = body(), i = b.indexOf('data-sec="sentProcessed"'); return [...(i < 0 ? b : b.slice(0, i)).matchAll(/data-chopen="([^"]+)"/g)].map(m => m[1]).sort(); };
  return { ctx, LIVE, st, threads, inbox, sentList, working, body, p, facts, ib };
}

// owner-correction: humanitylabs-org/wizard-ux#1883 · 2026-11-26 · "things I send that don't require my reply or attention just stay in sent. The only things that come into my inbox are things that require my attention in a timely manner"
test('James: Inbox holds only blocking needs you, failed, approval and the answer he asked for; everything else is in Sent', () => {
  const s = shell();
  const inbox = s.inbox(), sent = s.sentList();
  assert.deepEqual(inbox, INBOX, 'Inbox: what blocks him');
  assert.deepEqual(sent, SENT_IDS, 'Sent: every other thread, with or without a Sent row');
  assert.deepEqual(inbox.filter(id => sent.includes(id)), [], 'never in both');
  assert.deepEqual(THREADS().filter(t => !t.archived).map(t => t.id).filter(id => !inbox.includes(id) && !sent.includes(id)), [], 'and none in neither');
  assert.ok(!sent.includes('gone') && !inbox.includes('gone'), 'an archived thread is in neither');
  assert.deepEqual(s.working(), ['run-agent', 'run-mine'], 'Sent › Working: both running threads, whoever started them');
});

test('unread alone never puts a thread in Inbox', () => {
  UNREAD = () => true; const a = shell().inbox();
  UNREAD = () => false; const b = shell().inbox();
  UNREAD = () => true;
  assert.deepEqual(a, INBOX); assert.deepEqual(b, INBOX);
});

test('the same with only the smart switch (no Inbox rows, no Sent rows, no Sent threads)', () => {
  const s = shell({ tweaks: SW });
  assert.deepEqual(s.inbox(), INBOX);
  assert.deepEqual(s.sentList(), SENT_IDS);
  assert.equal(s.ctx.WizCore.inboxPlace(s.LIVE).smart, true);
});

test('placeOf, smart rule, for every row type', () => {
  const f = { needs, quiet: () => false, working: s => s.status === 'running', smart: true };
  const t = (o = {}) => ({ id: 'x', status: 'completed', ...o });
  const row = (o = {}) => sentRow({ id: sid('x'), at: 1, ...o });
  const P = (s, rows) => M.placeOf(s, rows, f);
  // needs you / check
  assert.equal(P(t({ attention: att('needs_you', 'Which?') }), []), 'inbox', 'blocking needs you, agent-started');
  assert.equal(P(t({ attention: att('needs_you', 'Which?') }), [row()]), 'inbox', 'blocking needs you, his');
  assert.equal(P(t({ attention: att('check', 'Try it') }), []), 'sent', 'check, agent-started');
  assert.equal(P(t({ attention: att('check', 'Try it') }), [row({ state: 'needs_you' })]), 'sent', 'check (the Sent log says needs_you for a check too)');
  // done / fyi, with and without a Sent row
  for (const st of ['done', 'fyi']) {
    assert.equal(P(t({ attention: att(st, 'Ok') }), []), 'sent', `${st}, agent-started`);
    assert.equal(P(t({ attention: att(st, 'Ok') }), [row({ rules: ['task_verb'], text: 'Send it' })]), 'sent', `${st}, his, nothing asked`);
  }
  assert.equal(P(t(), undefined), 'sent', 'older than the log: no Sent row, no status');
  // failed / approval
  assert.equal(P(t({ status: 'failed' }), []), 'inbox', 'failed run');
  assert.equal(P(t({ status: 'interrupted' }), []), 'inbox', 'interrupted run');
  assert.equal(P(t(), [row({ state: 'failed' })]), 'inbox', 'his newest send failed');
  assert.equal(P(t({ status: 'waiting_for_approval' }), [row({ state: 'running' })]), 'inbox', 'approval');
  assert.equal(P(t({ status: 'unknown' }), []), 'inbox', 'needs recovery');
  // running
  assert.equal(P(t({ status: 'running' }), []), 'sent', 'running, agent-started');
  assert.equal(P(t({ status: 'running', attention: att('needs_you', 'x') }), [row({ state: 'running' })]), 'sent', 'running, his');
  // answers he asked for
  assert.equal(P(t(), [row({ rules: ['short_question'], text: 'is it ready' })]), 'inbox', 'short question');
  assert.equal(P(t(), [row({ rules: ['wants_reply:tell me'] })]), 'inbox', 'a wants-reply phrase');
  assert.equal(P(t(), [row({ text: 'Where is the folder?' })]), 'inbox', 'a question mark');
  assert.equal(P(t(), [row({ text: 'Review the contract and let me know when it is done' })]), 'inbox', '"let me know when"');
  assert.equal(P(t(), [row({ route: 'thread', rules: ['voice'], text: 'Voice message' })]), 'inbox', 'a voice reply with no words yet');
  assert.equal(P(t(), [row({ text: 'Did it go?', rules: ['no_reply:no need to reply'] })]), 'sent', 'he said no reply');
  assert.equal(P(t(), [row({ text: 'Is it done?', quiet: true })]), 'sent', 'the box marked the answer quiet');
  assert.equal(P(t(), [row({ text: 'Is it done?', corrected: { shouldReply: false, at: 2 } })]), 'sent', 'his correction: no reply');
  assert.equal(P(t(), [row({ text: 'Send it', corrected: { shouldReply: true, at: 2 } })]), 'inbox', 'his correction: reply');
  assert.equal(P(t(), [row({ text: 'Is it ready?', state: 'running' })]), 'sent', 'not answered yet (and not running): nothing to read');
  assert.equal(P(t(), [row({ text: 'Is it ready?', at: 1 }), row({ id: sid('y'), text: 'thanks', rules: ['statement'], route: 'thread', at: 2 })]), 'sent', 'the newest send decides');
  assert.equal(P(t(), [row({ text: 'Reply to Bob about the invoice', rules: ['task_verb'] })]), 'sent', 'a task about replying is not asking for one');
  // a new chat's first message
  assert.equal(P(t({ attention: att('done', 'Started') }), [row({ source: 'new_chat', rules: ['new_chat'], text: 'Start a shopping list' })]), 'sent', 'new chat, nothing asked');
});

test('a thread moves with no reload: needs you → done to Sent, done → failed back to Inbox', () => {
  const s = shell();
  const n = s.threads.find(x => x.id === 'needs-mine'); n.attention = att('done', 'Booked 14A.');
  s.st.rows.unshift(sentRow({ id: sid('8'), at: NOW, thread: 'needs-mine', route: 'thread', text: 'window', rules: ['statement'], wantsReply: false }));
  assert.ok(!s.inbox().includes('needs-mine') && s.sentList().includes('needs-mine'), 'answered done: Sent');
  const d = s.threads.find(x => x.id === 'done-agent'); d.status = 'failed'; delete d.attention;
  assert.ok(s.inbox().includes('done-agent') && !s.sentList().includes('done-agent'), 'failed: Inbox');
  assert.match(s.ib.ibThreadRow(d, 0), /Didn’t finish · open it to retry/, 'one line saying why');
  // The real WosModels.smartFail: the named reason when the box gives one (no failure-reason tweak needed).
  s.ctx.WosModels = models(SW);
  d.runError = { code: 'provider_quota', provider: 'anthropic', message: '' };
  assert.match(s.ib.ibThreadRow(d, 0), /Claude usage limit reached/, 'the named reason when the box knows it');
  delete d.runError;
  assert.match(s.ib.ibThreadRow(d, 0), /Didn’t finish · open it to retry/);
});

function models(tweaks) {
  const window = { WosAgents: { lock: () => '' } };
  const document = { documentElement: { dataset: { tweaks } } };
  vm.runInContext(read('web/core/chat-models.js'), modelContext({ window, document, localStorage: { getItem: () => null, setItem() {} }, fetch: async () => ({}), console }));
  return window.WosModels;
}

test('WosModels.smartFail: only with the switch on and only for a failed thread', () => {
  const on = models(SW), off = models(''), reason = models('wizard/failure-reason');
  const f = { id: 'f', status: 'failed', provider: 'openai-codex', runError: { code: 'provider_billing', provider: 'openai-codex', message: '' } };
  assert.equal(on.smartFail(f).line, 'ChatGPT isn’t available: subscription ended');
  assert.equal(on.smartFail(f).smart, true);
  assert.equal(on.smartFail({ id: 'g', status: 'failed' }).line, 'Didn’t finish · open it to retry');
  assert.equal(on.smartFail({ id: 'h', status: 'completed' }), null, 'not failed');
  assert.equal(off.smartFail(f), null, 'switch off');
  assert.equal(off.runError(f), null, 'switch off: runError still needs its own tweak');
  assert.equal(reason.smartFail(f), null); assert.match(reason.runError(f).line, /subscription ended/, 'the failure-reason tweak is unchanged');
});

test('switch off: placeOf and the lists are today\'s', () => {
  const f = { needs, quiet: () => false, working: s => s.status === 'running' };
  assert.equal(M.placeOf({ id: 'x', status: 'completed', attention: att('check', 'Try') }, [], f), 'inbox', 'check stays in Inbox');
  assert.equal(M.placeOf({ id: 'x', status: 'completed' }, [], f), 'inbox', 'no Sent row stays in Inbox');
  assert.equal(M.placeOf({ id: 'x', status: 'running' }, [], f), 'inbox', 'an agent-started run stays in Inbox');
  const s = shell({ tweaks: 'wizard/sent-threads' });
  assert.equal(s.ctx.WizCore.inboxPlace(s.LIVE).smart, undefined, 'no smart fact');
  assert.ok(s.inbox().includes('check-agent') && s.inbox().includes('done-agent'), 'today: agent-started threads in Inbox');
  assert.ok(!s.sentList().includes('old'), 'today: Sent only lists threads with a Sent row');
  const bare = shell({ tweaks: '' });
  assert.equal(bare.ctx.WizCore.inboxPlace(bare.LIVE).smart, undefined, 'nothing on: the plain one-place rule (Inbox rows are on for everyone), no smart fact');
});
