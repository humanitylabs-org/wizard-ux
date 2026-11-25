// Quiet inbox: replies typed in a thread (wizard-ux issue 1808; switches wizard/agent-inbox + wizard/chats-inbox).
// The box (wizard-agent-service, same issue) logs every reply in a thread as a Sent row (source reply, route thread)
// and marks a thread whose newest answer was to a reply that asked for none, ended done or fyi (quietReply). Here:
// the real live.js quietReply + isNew + groups lines, the real Sent log reader (live-channels.js) and the real Sent
// part (core/chats-sent.js). Browser proof: tests/qa-quiet-thread-replies.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { between } from './fixtures/source-slice.mjs';
import { withLiveParts } from './fixtures/live-parts.mjs';

const live = withLiveParts(readFileSync(new URL('../web/live.js', import.meta.url), 'utf8'));
const clone = v => JSON.parse(JSON.stringify(v));
const ON = 'wizard/agent-inbox wizard/chats-inbox';

// live.js: quietReply and the three places that count a thread as new (isNew, visibleUnread, groups).
function liveCtx(tweaks = ON) {
  const ctx = { document: { documentElement: { dataset: { tweaks } } }, WizChatsListModel: { isListWorking: s => s.status === 'running' }, console };
  ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(between(live, '  function tweakOn(id)', '  function backgroundOn()') + `
    const hasNew = () => true, snoozeLast = () => false, isDeferred = () => false, inWorking = () => false, seenKeyOf = s => s.id, assistantAt = s => s.at, WEEK = 7 * 864e5;
    const groupWork = rows => ({ ready: rows });
    this.L = { inArchive: () => false, seenOf: () => ({}), deferred: {}, sessionsFor: (agent = '') => this.rows.filter(s => (s.agent || '') === agent),
      ${between(live, '    isNew(s) {', '\n')}
      ${between(live, '    quietReply,', '\n')}
      ${between(live, '    visibleUnread(rows) {', '\n')}
      ${between(live, "    groups(agent = '') {", '    // chat-power.js')} };`, ctx);
  return ctx;
}
const at = new Date().toISOString();
const quiet = (extra = {}) => ({ id: 'clips', status: 'completed', at, updatedAt: at, quietReply: true, attention: { state: 'fyi', ask: 'Clip edit is with Miguel. Nothing needed from you.' }, ...extra });

test('issue 1808: a quiet reply\'s answer is not new: no dot, not counted, not in Ready', () => {
  const c = liveCtx();
  const clips = quiet(), mac = { id: 'mac', status: 'completed', at, updatedAt: at, attention: { state: 'fyi', ask: 'The Mac app build is still running.' } };
  c.rows = [clips, mac];
  assert.equal(c.L.isNew(clips), false, '"Sent to Miguel, done" answered fyi: no unread dot');
  assert.equal(c.L.isNew(mac), true, 'the answer to "is the mac app ready?" is new');
  assert.deepEqual(clone(c.L.visibleUnread(c.rows).map(s => s.id)), ['mac'], 'the unread count leaves it out');
  assert.deepEqual(clone(c.L.groups().ready.map(s => s.id)), ['mac'], 'Ready leaves it out');
});

test('issue 1808: an ask, a failure or a run still going is never quiet, whatever the box marked', () => {
  const c = liveCtx();
  for (const [why, s] of [['needs you', quiet({ attention: { state: 'needs_you', ask: 'Reply ship' } })], ['check', quiet({ attention: { state: 'check', ask: 'Try it' } })],
    ['failed', quiet({ status: 'failed' })], ['interrupted', quiet({ status: 'interrupted' })], ['running', quiet({ status: 'running' })], ['critical', quiet({ critical: true })]])
    assert.equal(c.L.isNew(s), true, why);
  assert.equal(c.L.isNew(quiet({ quietReply: 'yes' })), true, 'only a real true counts');
});

test('issue 1808: main versus routed: only the main agent\'s list drops a quiet reply; host-profile, container and restricted lists are unchanged', () => {
  const c = liveCtx();
  const main = quiet(), routed = ['host-profile', 'container', 'restricted'].map(agent => quiet({ id: `${agent}-clips`, agent }));
  c.rows = [main, ...routed];
  assert.equal(c.L.isNew(main), false, 'main: no dot');
  assert.equal(clone(c.L.groups('').ready).length, 0, 'main: out of Ready');
  for (const s of routed) {
    assert.equal(c.L.isNew(s), true, `${s.agent}: a routed row never counts as quiet (its list keeps today\'s dot)`);
    assert.deepEqual(clone(c.L.groups(s.agent).ready.map(x => x.id)), [s.id], `${s.agent}: still in its own Ready, never in another list`);
  }
  assert.deepEqual(clone(c.L.visibleUnread(c.rows).map(s => s.id)), routed.map(s => s.id), 'counts: the routed rows only');
  assert.equal(c.L.isNew(quiet({ agent: 'hermes' })), false, 'a row pinned to the main agent by id is main');
});

test('issue 1808: switch off (either of the two): unchanged from today', () => {
  for (const tweaks of ['', 'wizard/agent-inbox', 'wizard/chats-inbox']) {
    const c = liveCtx(tweaks); c.rows = [quiet()];
    assert.equal(c.L.isNew(c.rows[0]), true, `tweaks "${tweaks}": unread as today`);
    assert.equal(c.L.groups().ready.length, 1, `tweaks "${tweaks}": in Ready as today`);
  }
});

test('issue 1808: the list keeps the box\'s mark from both list shapes, and only when it is true', () => {
  const ctx = { console, globalThis: null, WizChatsListModel: { executionStatus: s => s } }; ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext("const WORKING = new Set(['submitting', 'queued', 'running', 'stopping']);\n" + between(live, '  const ALIASES', '  /* ---- thread-seen') + '\nthis.normalize = normalize;', ctx);
  assert.equal(ctx.normalize({ id: 'wizard_a', title: 'A', wizard_quiet_reply: true }).quietReply, true, 'full rows: wizard_quiet_reply');
  assert.equal('quietReply' in ctx.normalize({ id: 'wizard_b', title: 'B' }), false);
  assert.equal(ctx.normalize({ listVersion: 1, id: 'wizard_c', title: 'C', status: 'completed', quietReply: true }).quietReply, true, 'view=list rows: quietReply');
  assert.equal('quietReply' in ctx.normalize({ listVersion: 1, id: 'wizard_d', title: 'D', status: 'completed', quietReply: 'x' }), false, 'anything else is dropped');
});

// The Sent log reader: a reply row's route, answer and quiet come through.
test('issue 1808: the Sent log reader keeps a reply row (route thread, answer, quiet)', async () => {
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(between(live, '  /* ---- sent log (wizard-ux issue 1778)', '/* ---- end sent log ---- */') + '\nthis.sentLog = sentLog;', ctx);
  const rows = [{ id: 'sent_' + 'a'.repeat(24), at: 5, source: 'reply', text: 'Sent to Miguel, done', route: 'thread', decided_by: 'owner_words', rules_matched: ['statement'], state: 'done', thread_id: 'wizard_clips', wants_reply: false, quiet: true, answer: 'Clip edit is with Miguel. Nothing needed from you.' }];
  const log = ctx.sentLog({ req: async () => ({ json: async () => ({ rows }) }), emit() {} });
  const s = await log.read();
  assert.deepEqual(clone(s.rows[0]), { id: 'sent_' + 'a'.repeat(24), at: 5, source: 'reply', text: 'Sent to Miguel, done', route: 'thread', decidedBy: 'owner_words', rules: ['statement'], state: 'done', thread: 'wizard_clips', record: null, tags: [], urgent: false, wouldRoute: null, corrected: null, error: '', wantsReply: false, answer: 'Clip edit is with Miguel. Nothing needed from you.', quiet: true });
});

// The real Sent part: Reply rows say so, show the agent's answer, offer no routing correction, and a tap opens the thread.
function part(rows) {
  const opened = [], CH = { main: {} }, W = { main: { id: 'main', thread: null } }, state = { ok: true, gone: false, rows, next: null };
  const ctx = { document: { documentElement: { dataset: { tweaks: ON } } }, window: { WizCore: {}, addEventListener() {} }, localStorage: { setItem() {} }, console, fetch: async () => ({ ok: false }) };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../web/core/chats-sent.js', import.meta.url), 'utf8'), ctx);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LIVE = { sentLog: { state: () => state, fresh() {}, read: async () => state }, onChange() {} };
  const p = ctx.window.WizCore.chatsParts.sent({ ago: () => '4m', ch: id => CH[id], CH, CHAN_VIEW_KEY: 'k', chanElsewhere: () => false, chanSide: () => false, chatVars: { chanView: 'activity' }, clip: (s, n) => String(s).slice(0, n), elOf: () => ({}), esc, H: { win: id => W[id] },
    LIVE, openChat: (wid, t) => opened.push([wid, t]), renderChatList() {}, rerenderList() {}, toast() {}, W, winAgent: () => '' });
  CH.main.sent = true;
  return { p, W, opened };
}
const view = (c, extra) => ({ id: 'sent_' + c.repeat(24), at: 1000, source: 'reply', text: 'Words ' + c, route: 'thread', decidedBy: 'owner_words', rules: [], state: 'done', thread: 'wizard_' + c, record: null, tags: [], urgent: false, wouldRoute: null, corrected: null, error: '', wantsReply: false, answer: '', quiet: false, ...extra });

test('issue 1808: Sent shows each reply as Reply with the agent\'s one-line answer, and a tap opens its thread', async () => {
  const rows = [view('a', { text: 'Sent to Miguel, done', quiet: true, answer: 'Clip edit is with Miguel. Nothing needed from you.' }), view('b', { text: 'is the mac app ready?', wantsReply: true, answer: 'The Mac app build is still running.' }),
    view('c', { text: 'ok, approve it', state: 'needs_you', answer: 'Phone update is ready. Reply ship to send it' })];
  const f = part(rows), body = f.p.sentBody(f.W.main);
  const text = body.split('<div class="ch-sent-row').slice(1).map(x => x.replace(/^[^>]*>/, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  assert.match(text[0], /^✓ Sent to Miguel, done 4m Reply · Done · nothing needed from you Clip edit is with Miguel\. Nothing needed from you\.$/, text[0]);
  assert.match(text[1], /is the mac app ready\? 4m Reply · Done · you asked The Mac app build is still running\./);
  assert.match(text[2], /ok, approve it 4m Reply · Needs you Phone update is ready/);
  assert.doesNotMatch(body, /data-chsentfix/, 'a reply stays in its thread: no routing correction');
  const click = attrs => f.p.sentClick({ target: { closest: sel => { const k = /\[data-([a-z]+)\]/.exec(sel)?.[1]; return k && k in attrs ? { dataset: { [k]: attrs[k] } } : null; } } }, 'main', f.W.main);
  assert.equal(click({ chsentopen: rows[0].id }), true);
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(f.opened, [['main', 'wizard_a']], 'the tap opens the thread he replied in');
});
