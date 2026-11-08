import { modelContext, runWithChatsModel } from './fixtures/chats-list-model.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
const source = f => fs.readFileSync(process.env.QA_TREE ? path.join(process.env.QA_TREE, f) : new URL('../' + f, import.meta.url), 'utf8');
const live = source('web/live.js'), nav = source('web/core/workspace-navigation.js');

function harness(shell = 'web/app.js') {
  const storage = new Map(), calls = [], events = [];
  const c = { console, AbortSignal, document: { documentElement: { dataset: {} }, readyState: 'loading', hidden: false, addEventListener() {} }, navigator: {},
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    setInterval() {}, setTimeout() {}, addEventListener() {}, dispatchEvent: e => events.push(e), CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } },
    WizConfig: { dayStart: n => n - n % 864e5 },
    WosAgents: { isOther: id => id !== 'hermes', get: id => ({ id, privacy: 'standard' }) },
    fetch: async url => { calls.push(url); return { ok: true, json: async () => ({}) }; },
    WizSigil: { of: () => ({ color: 'purple' }), html: () => '<i></i>' },
    WosBell: { readyCount: () => 0, unreadCount: () => 0, readyMore: () => false, inChats: () => false, isOff: () => false },
  };
  c.window = c; modelContext(c); vm.runInContext(live, c); vm.runInContext(nav, c);
  const L = c.WizLive, N = c.WizCore.workspaceNav;
  L.ok = true; L.seen = { initializedAt: 1, threads: {} };
  // Execute the actual shell's badge publication statement, not a test-owned copy of its rule.
  const statement = source(shell).split('\n').find(l => /workspaceNav\.(?:setCount|refreshChats)\(/.test(l));
  assert.ok(statement, shell + ' publishes Chats through the shared registry');
  Object.assign(c, { LIVE: L, C: c.WizCore, CHATS_APP: { id: 'wizard' }, APP: { wizard: { id: 'wizard' } } });
  return { c, L, N, calls, events, paint() { vm.runInContext(statement, c); return N.counts.wizard || 0; } };
}
const row = (id, extra = {}) => ({ id, title: id, updatedAt: new Date(Date.now() - 60000).toISOString(), runtime: 'direct', status: 'completed', attention: { state: 'needs_you' },
  previewRole: 'assistant', preview: 'Synthetic reply', previewAt: new Date(Date.now() - 60000).toISOString(),
  lastAssistantAt: new Date(Date.now() - 60000).toISOString(), messageCount: 2, ...extra });

for (const shell of ['web/app.js', 'web/desktop/desktop.js']) {
  test(shell + ': read Ready = zero; done/FYI unread = one each, never the message count', () => {
    const h = harness(shell), { L } = h;
    const read = row('read'), done = row('done', { attention: { state: 'done' }, messageCount: 40 }), fyi = row('fyi', { attention: { state: 'fyi' } });
    L.sessions = [read]; L.markSeen(read.id);
    assert.equal(L.workGroups().ready.length, 1);
    assert.equal(h.paint(), 0, 'a read Ready thread must not badge');
    L.sessions.push(done); assert.equal(h.paint(), 1, 'forty messages in one unread Done thread count once');
    L.sessions.push(fyi); assert.equal(h.paint(), 2, 'FYI counts even though it needs no action');
  });
  test(shell + ': reading clears the badge while Ready persists; a later reply restores it', () => {
    const h = harness(shell), { L, N } = h, s = row('reply'); L.sessions = [s];
    assert.equal(h.paint(), 1); L.markSeen(s.id); assert.equal(h.paint(), 0);
    assert.equal(L.workGroups().ready.length, 1, 'reading does not complete/archive Ready');
    s.lastAssistantAt = s.previewAt = new Date(Date.now() + 1000).toISOString(); s.messageCount += 3;
    assert.equal(h.paint(), 1, 'several unseen replies still count one thread');
    const d = { wins: ['a', 'b'], focus: 'a' }, wins = { a: {}, b: {} }, app = () => ({ id: 'wizard' });
    assert.equal(N.deskCount(d, wins, app), 1, 'two Chats windows do not double the app badge');
    assert.match(N.icon(d, wins, app), /class="dbg">1</); assert.equal(N.label('wizard'), '1');
    L.markSeen(s.id); h.paint(); assert.doesNotMatch(N.icon(d, wins, app), /class="dbg"/); assert.equal(N.label('wizard'), '');
  });
  test(shell + ': canonical visibility, archive, snooze, agent and Space peek policies stay intact', () => {
    const h = harness(shell), { L } = h, hidden = row('hidden', { hidden: true }), archived = row('archived', { archived: true }), snoozed = row('snoozed', { deferred: true, deferredAt: new Date().toISOString() });
    const done = row('done', { attention: { state: 'done' } }), routed = row('routed', { agent: 'qa-host' });
    L.sessions = [hidden, archived, snoozed, done]; L.agentSessions['qa-host'] = [routed, done];
    assert.equal(h.paint(), 2, 'only two visible unread threads, deduped across loaded agents');
    assert.equal(L.visibleUnread(L.sessionsFor('qa-host')).length, 2);
    L.markSeen(routed.id); assert.equal(h.paint(), 1, 'qualified routed receipt clears only its own thread');
    assert.ok(L.seen.threads['agent/qa-host/direct:routed']);
    const before = h.calls.length;
    assert.equal(L.visibleUnread(L.spaceSessions(['done', 'missing'], { peek: true }).rows).length, 1);
    h.paint(); assert.equal(h.calls.length, before, 'badge/Focus peek starts no reads');
  });
}

test('badge publication preserves other app counts and only unread routed notification items contribute', () => {
  const h = harness(), { N, c } = h;
  N.setCount('mail', 7, true); c.WosBell.readyCount = () => 9; c.WosBell.unreadCount = () => 2; c.WosBell.readyMore = () => true;
  assert.equal(h.paint(), 2); assert.equal(N.label('wizard'), '2+'); assert.equal(N.label('mail'), '7+');
  c.WosBell.unreadCount = () => 0; assert.equal(h.paint(), 0); assert.equal(N.label('wizard'), '');
});

test('AI Apps menu and folded Orb conversations use the same badge feed and say unread, not Ready', () => {
  const ai = source('web/layouts/ai-apps/layout.js'), orb = source('web/layouts/orb/layout.js');
  assert.doesNotMatch(ai.slice(ai.indexOf('  function paintBadges()'), ai.indexOf('  /* ---------- a chat row')), /\$\{rt\} ready/);
  const paint = orb.slice(orb.indexOf('  function paintReady()'), orb.indexOf('  function fold('));
  assert.match(paint, /badgeMap\[.*wizard.*\]/); assert.doesNotMatch(paint, /L\.ready|\$\{n\} ready/);
});
