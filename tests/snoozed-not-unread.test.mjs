import { modelContext } from './fixtures/chats-list-model.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { withLiveParts } from './fixtures/live-parts.mjs'; // live.js parts moved out verbatim (issue 1665)
import { withWebParts } from './fixtures/web-parts.mjs';

// wizard-os issue 510 (Miguel, 10 Nov 2026): "nothing is in my Ready, yet I see a notification for three". With Snooze =
// bottom of Ready (miguel/snooze-someday) three unread snoozed chats lit the Ready badge while the AI apps view listed
// them under Snoozed and Ready was empty. Snoozed chats are never unread for any Ready / Chats count.
const src = f => withWebParts(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
const live = withLiveParts(src('web/live.js')), nav = src('web/core/workspace-navigation.js');

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

// The Ready section header count line of the Chats list, run with the real list model.
function readyHeader(list, snoozeLastOn) {
  const chats = src('web/core/chats.js');
  const line = chats.split('\n').find(l => l.includes('const secN = unreadSec ?'));
  assert.ok(line, 'secN line');
  const h = harness(snoozeLastOn);
  const ctx = { window: { WizChatsListModel: h.c.WizChatsListModel }, unreadSec: true, list, nt: null, extra: { n: 0 }, notesN: 0,
    LIVE: { isNew: s => !!s.unread }, snoozeLast: () => snoozeLastOn, deferredOf: s => !!s.deferred, isWorking: s => s.status === 'running' };
  return vm.runInNewContext(`${line}\nsecN`, ctx);
}
test('Chats list Ready header (snooze last) does not count the snoozed tail as unread', () => {
  const list = [{ id: 'a', unread: true }, { id: 'z1', unread: true, deferred: true }, { id: 'z2', unread: true, deferred: true }, { id: 'w', unread: true, deferred: true, status: 'running' }];
  assert.equal(readyHeader(list, true), 2, 'the awake chat and the snoozed one that is working again; never the snoozed tail');
  assert.equal(readyHeader(list, false), 4, 'stock Snooze: rows in Ready are not snoozed there, so each unread counts');
  assert.equal(readyHeader([{ id: 'z', unread: true, deferred: true }], true), 0);
});

// paintRail from the AI apps desktop layout, with a fake rail list and plain row stubs.
function rail({ ready = [], snoozed = [], working = [], unread = 0 }) {
  const d = src('web/layouts/ai-apps/desktop.js');
  const i = d.indexOf('  function paintRail('), j = d.indexOf('  /* the hover flyout', i);
  assert.ok(i >= 0 && j > i, 'paintRail');
  const rows = [];
  const ctx = { root: { dataset: { aadSide: 'rail' } }, sessions: { ready, snoozed, working }, readSessions: () => ({}), groupBy: () => 'none', projectGroups: () => [], stateGroups: () => [],
    readyOrder: () => [], railNow: () => '', badgeMap: { chats: unread }, CHATS: 'chats', badgeText: () => (unread ? String(unread) : ''), railDrawn: '', fly: null, globalThis: { WizChatsListModel: { unreadCount: () => 0 } },
    railRow: (kind, n, word) => `${kind}:${n}:${word}`, rList: { childElementCount: 0, replaceChildren: (...r) => { rows.push(...r); } } };
  vm.runInNewContext(d.slice(i, j) + '\npaintRail(true);', ctx);
  return rows;
}
test('AI apps desktop rail: no Ready row (and no number) when Ready lists nothing', () => {
  // Three snoozed chats, nothing in Ready, a stale unread count of 3: the rail shows Snoozed only.
  assert.deepEqual(rail({ snoozed: [{}, {}, {}], unread: 3 }), ['snoozed:3:Snoozed']);
  assert.deepEqual(rail({ working: [{}], unread: 2 }), ['working:1:Working']);
  // Something ready: its Ready row carries the unread count.
  assert.deepEqual(rail({ ready: [{ id: 'a' }], snoozed: [{}], unread: 1 }), ['snoozed:1:Snoozed', 'ready:1:Ready']);
});
