import { modelContext } from './fixtures/chats-list-model.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// wizard-os issue 510 (Miguel, 10 Nov 2026): "nothing is in my Ready, yet I see a notification for three". With Snooze =
// bottom of Ready (miguel/snooze-someday) three unread snoozed chats lit the Ready badge while the AI apps view listed
// them under Snoozed and Ready was empty. Snoozed chats are never unread for any Ready / Chats count.
const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const live = src('web/live.js'), nav = src('web/core/workspace-navigation.js');

function harness(snoozeLast) {
  const storage = new Map();
  const c = { console, AbortSignal, document: { documentElement: { dataset: {} }, readyState: 'loading', hidden: false, addEventListener() {} }, navigator: {},
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    setInterval() {}, setTimeout() {}, addEventListener() {}, dispatchEvent() {}, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } },
    WizConfig: { dayStart: n => n - n % 864e5 },
    WosAgents: { isOther: id => id !== 'hermes', get: id => ({ id, privacy: 'standard' }) },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    WosBell: { unreadCount: () => 0, readyMore: () => false, inChats: () => false, isOff: () => false },
    WosSkinHost: { snoozeOrder: snoozeLast ? 'last' : 'default' } };
  c.window = c; modelContext(c); vm.runInContext(live, c); vm.runInContext(nav, c);
  const L = c.WizLive; L.ok = true; L.seen = { initializedAt: 1, threads: {} };
  const facts = { live: L, chats: { stiKind: () => '', threadActions: () => [] } };
  return { c, L, count: () => c.WizCore.workspaceNav.chatsCount(L), list: () => c.WizChatsListModel.sessionList(L.workGroups(), facts) };
}
const ago = ms => new Date(Date.now() - ms).toISOString();
const row = (id, extra = {}) => ({ id, title: id, updatedAt: ago(60000), status: 'completed', attention: { state: 'fyi' }, previewRole: 'assistant',
  preview: 'Synthetic reply', previewAt: ago(60000), lastAssistantAt: ago(60000), messageCount: 2, ...extra });
const snoozed = id => row(id, { deferred: true, deferredAt: ago(30000) });

for (const last of [false, true]) {
  test(`snooze ${last ? 'last' : 'stock'}: three unread snoozed chats and an empty Ready badge nothing`, () => {
    const h = harness(last);
    h.L.sessions = ['a', 'b', 'c'].map(snoozed);
    const l = h.list();
    assert.equal(l.ready.length, 0, 'the AI apps view lists nothing in Ready');
    assert.equal(l.snoozed.length, 3, 'the three chats are under Snoozed');
    assert.equal(h.count(), 0, 'the Ready / Chats badge must not say 3');
    assert.equal(h.L.visibleUnread(h.L.unified()).length, 0);
  });
  test(`snooze ${last ? 'last' : 'stock'}: an awake unread chat still counts, a reply after snoozing wakes it`, () => {
    const h = harness(last);
    const woke = snoozed('woke'); woke.lastUserAt = ago(1000);   // the owner wrote after snoozing: it is awake again
    h.L.sessions = [snoozed('a'), row('awake'), woke];
    assert.equal(h.count(), 2);
    assert.equal(h.list().ready.length, 2);
  });
}

// Agent chat parity: the same rule on the main agent and on routed threads (host-profile, container, restricted), which
// reach the shared count through agentSessions / unified() and sessionsFor(agent).
for (const last of [false, true]) for (const agent of ['host-profile', 'container', 'restricted']) {
  test(`snooze ${last ? 'last' : 'stock'}: main versus routed ${agent}: snoozed never counts, awake counts once`, () => {
    const h = harness(last), routed = (id, mk) => ({ ...mk(id), agent });
    h.L.sessions = [snoozed('main-snoozed'), row('main-awake')];
    h.L.agentSessions[agent] = [routed('r-snoozed-1', snoozed), routed('r-snoozed-2', snoozed), routed('r-awake', row)];
    assert.equal(h.count(), 2, 'one awake main chat + one awake routed chat');
    assert.deepEqual([...h.L.visibleUnread(h.L.sessionsFor(agent)).map(s => s.id)], ['r-awake'], 'routed list: only the awake chat is unread');
    assert.deepEqual([...h.L.visibleUnread(h.L.sessions).map(s => s.id)], ['main-awake'], 'main list: same rule');
    const l = h.list();
    assert.deepEqual([...l.ready.map(r => r.id)].sort(), ['main-awake', 'r-awake']);
    assert.equal(l.snoozed.length, 3);
  });
}

test('Chats list Ready header (snooze last) does not count the snoozed tail as unread', () => {
  const chats = src('web/core/chats.js');
  const line = chats.split('\n').find(l => l.includes('const secN = unreadSec ?'));
  assert.match(line, /LIVE\.isNew\(s\) && !\(snoozeLast\(\) && deferredOf\(s\) && !isWorking\(s\)\)/);
});

test('AI apps desktop rail: no Ready row (and no number) when Ready lists nothing', () => {
  const d = src('web/layouts/ai-apps/desktop.js');
  const paint = d.slice(d.indexOf('  function paintRail('), d.indexOf('  /* the hover flyout'));
  assert.match(paint, /else if \(ready\.length\) out\.push\(railRow\('ready', unread, 'Ready'/);
  assert.doesNotMatch(paint, /ready\.length \|\| unread/);
});
