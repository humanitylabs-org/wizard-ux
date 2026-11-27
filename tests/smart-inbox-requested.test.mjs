// Smart inbox: requested information lands in Inbox (wizard-ux issue 1927, same switch wizard/smart-inbox, off by
// default). placeOf's smart rule for what he asked for or set up, and what still finishes in Sent. Browser proof:
// tests/qa-chats-smart-inbox-requested.cjs (the 1883 list plus 11 threads; phone, Classic, AI apps sidebar; two skins).
// Run: node --test tests/smart-inbox-requested.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { modelContext } from './fixtures/chats-list-model.mjs';

const M = modelContext({}).WizChatsListModel;
const H = 3600e3, NOW = Date.UTC(2026, 10, 27, 2);
const iso = t => new Date(t).toISOString();
const att = (state, ask) => ({ state, ask });
const needs = s => !s.archived && s.status !== 'running' && (['waiting_for_approval', 'unknown'].includes(s.status) || ['needs_you', 'check'].includes(s.attention?.state));
const PINS = new Set(['wizard_topics']);
const facts = (o = {}) => ({ needs, quiet: s => s.quietReply === true, working: s => s.status === 'running', smart: true, pinned: s => PINS.has(s.id), ...o });
const t = (o = {}) => ({ id: 'x', status: 'completed', previewRole: 'assistant', preview: o.attention?.ask || 'Done.', messageCount: 2, lastAssistantAt: iso(NOW), ...o });
const row = (o = {}) => ({ id: 'sent_' + 'a'.repeat(24), at: NOW - 60e3, text: 'Do the thing', rules: [], route: 'agent', state: 'done', quiet: false, wantsReply: true, corrected: null, ...o });
const P = (s, rows, f) => M.placeOf(s, rows, facts(f));

// owner-correction: humanitylabs-org/wizard-ux#1927 · 2026-11-27 · "Threads with information I request shouldn't skip the inbox"
test('James: what he asked for or set up is in Inbox', () => {
  assert.equal(P(t({ id: 'wizard_topics', title: 'Wizard Topics', attention: att('fyi', 'Wizard Topics · Fri 27 Nov, 2 of 29 topics moved') }), []), 'inbox', 'Topics roundup: agent-started, pinned, from a subscription');
  assert.equal(P(t({ id: 'cron_ab12_20261127', source: 'cron', attention: att('fyi', 'Time to call the dentist.') }), []), 'inbox', 'a scheduled reminder firing');
  assert.equal(P(t({ source: 'cron', attention: att('fyi', 'Your Friday: two meetings.') }), []), 'inbox', 'the Daily brief');
  assert.equal(P(t({ attention: att('fyi', 'Reviewed 12 items.') }), [row({ text: 'Review everything in my inbox', rules: ['task_verb'] })]), 'inbox', '"Review everything in my inbox" answered fyi');
  assert.equal(P(t({ attention: att('done', 'Summary in five points.') }), [row({ text: 'summarize this transcript', rules: ['task_verb'] })]), 'inbox', '"summarize this transcript" answered done');
  assert.equal(P(t({ attention: att('fyi', 'Time to call mum.') }), [row({ text: 'remind me to call mum at 6', at: NOW - 3 * H })]), 'inbox', 'his "remind me" fired later');
});

test('what still finishes in Sent', () => {
  assert.equal(P(t({ attention: att('done', 'Fixed and merged.') }), [row({ text: 'Fix the login bug in Messenger', rules: ['task_verb'] })]), 'sent', 'a build confirmation done');
  assert.equal(P(t({ attention: att('check', 'Have a look.') }), [row({ text: 'Review the forum setup', state: 'needs_you' })]), 'sent', 'a check ask, even after a request');
  assert.equal(P(t({ source: 'cron', attention: att('check', 'Cleaned 40 files. Have a look.') }), []), 'sent', 'a scheduled check ask');
  assert.equal(P(t({ source: 'cron', preview: '[SILENT]' }), []), 'sent', 'a watch wake [SILENT]');
  assert.equal(P(t({ id: 'wizard_topics', preview: '[SILENT]' }), []), 'sent', 'a pinned thread whose run said [SILENT]');
  assert.equal(P(t({ quietReply: true, attention: att('done', 'Ok') }), [row({ text: 'thanks', route: 'thread', rules: ['statement'], wantsReply: false, quiet: true })]), 'sent', 'a quiet reply to "thanks"');
  assert.equal(P(t({ attention: att('done', 'Okay, I will remind you at 6.') }), [row({ text: 'remind me to water the plants at 6' })]), 'sent', 'a reminder just set');
  assert.equal(P(t({ attention: att('done', 'Matched 12 invoices.') }), []), 'sent', 'a helper result that only confirms');
  assert.equal(P(t({ attention: att('fyi', 'Three meetings.') }), []), 'sent', 'agent-started, not scheduled, not pinned');
  assert.equal(P(t({ attention: att('fyi', 'Still on it.') }), [row({ text: 'Summarize the report', state: 'running' })]), 'sent', 'not answered yet');
  assert.equal(P(t({ attention: att('done', 'Started') }), [row({ text: 'Start a shopping list for the party', rules: ['new_chat'] })]), 'sent', '"list" as a noun is not a request');
  assert.equal(P(t({ attention: att('done', 'Done') }), [row({ text: 'Fix the login and when it works deploy it' })]), 'sent', 'a "when" inside a task is not a question');
  assert.equal(P(t({ attention: att('done', 'Ok') }), [row({ text: 'Summarize it', rules: ['no_reply:no need to reply'] })]), 'sent', 'he said no reply');
  assert.equal(P(t({ attention: att('done', 'Ok') }), [row({ text: 'Summarize it', corrected: { shouldReply: false, at: 1 } })]), 'sent', 'his correction: no reply');
});

test('the box\'s quiet mark (Smart inbox marks every run nobody typed, and sends with no question) does not hide them', () => {
  assert.equal(P(t({ id: 'wizard_topics', quietReply: true, attention: att('fyi', 'Topics · 2 moved') }), []), 'inbox', 'Topics, quiet-marked as the box does');
  assert.equal(P(t({ source: 'cron', quietReply: true, attention: att('fyi', 'Your Friday') }), []), 'inbox', 'a scheduled brief, quiet-marked');
  assert.equal(P(t({ quietReply: true, attention: att('fyi', 'Reviewed 12 items.') }), [row({ text: 'Review everything in my inbox', quiet: true, wantsReply: false })]), 'inbox', 'his request, quiet-marked');
  assert.equal(P(t({ quietReply: true, attention: att('done', 'Matched 12 invoices.') }), []), 'sent', 'a helper result, quiet-marked');
});

test('request words, with and without a question mark', () => {
  for (const text of ['Review everything in my inbox', 'evaluate this', 'compress this transcript', 'extract the dates from this', 'summarize the call',
    'find me a flight', 'look up the opening hours', 'research heat pumps', 'compare these two offers', 'explain the invoice', 'show me the photos from Friday',
    'give me the numbers', 'list my meetings tomorrow', 'what is on my calendar', 'how much did we spend', 'why did the build fail', 'who called',
    'when is the dentist', 'Please review the draft', 'Can you summarise this', 'Read this and give me a summary', 'catch me up'])
    assert.equal(M.sentRequested(row({ text })), true, text);
  for (const text of ['Fix the login bug', 'Send the clip edit to Miguel', 'Start a shopping list for the party', 'Keep the launch plan current',
    'Note: check the weather for the hike', 'Order the usual groceries', 'File these notes', 'Reply to Bob about the invoice', 'thanks', 'Deploy it and when done ping Jan'])
    assert.equal(M.sentRequested(row({ text })), false, text);
});

test('an owner thread he pinned or scheduled: a later delivery is Inbox, the answer to a task is not', () => {
  const s = t({ id: 'wizard_topics', attention: att('fyi', 'Topics · 2 moved') });
  assert.equal(P(s, [row({ text: 'Add AI chips to my topics', at: NOW - 30 * H })]), 'inbox', 'a roundup a day after his last send');
  assert.equal(P(s, [row({ text: 'Add AI chips to my topics' })]), 'sent', 'the answer to his send, right after it');
});

test('blockers keep their place; Inbox and Sent stay one place each', () => {
  assert.equal(P(t({ source: 'cron', status: 'running' }), []), 'sent', 'a scheduled run still running: Sent › Working');
  assert.equal(P(t({ source: 'cron', status: 'failed' }), []), 'inbox', 'failed');
  assert.equal(P(t({ id: 'wizard_topics', attention: att('needs_you', 'Which?') }), []), 'inbox', 'blocking needs you');
  for (const s of [t({ source: 'cron' }), t({ id: 'wizard_topics' }), t()]) assert.ok(['inbox', 'sent'].includes(P(s, [])));
});

test('switch off: the same threads are placed as today', () => {
  const off = { needs, quiet: () => false, working: s => s.status === 'running' };
  assert.equal(M.placeOf(t({ source: 'cron', preview: '[SILENT]' }), [], off), 'inbox', 'off: an agent-started thread stays in Inbox');
  assert.equal(M.placeOf(t({ attention: att('done', 'Fixed') }), [row({ text: 'Fix the login bug' })], off), 'inbox', 'off: today\'s rule');
  assert.equal(M.placeOf(t({ attention: att('done', 'Ok') }), [row({ text: 'Summarize it', wantsReply: false })], off), 'sent', 'off: today\'s rule');
  assert.equal(M.placeOf(t({ id: 'wizard_topics', attention: att('fyi', 'Topics') }), [], { ...off, pinned: () => true }), 'inbox', 'off: pins change nothing');
});
