// Inbox until archived (wizard-ux issue 1810, on for everyone; James, 25 Nov 2026: "let's go back to manually archiving
// things when they are done ... treat it like an inbox again"). Chats › Inbox is one list: Working on top (a running
// thread no Sent row names: one the agent started), then Inbox (every thread that is not working, snoozed or archived,
// read or not), no Recent. With Smart inbox off (everyone's default, wizard-ux issue 1962) a run he sent is in Working
// on top too; only Smart inbox moves it to Sent › Working (issue 1829). Runs
// the real list model, the real AI apps sidebar paint and the real skin-host activity rows. The phone / Classic Inbox
// draws Inbox rows (wizard-ux issue 1779, on for everyone; tests/inbox-rows.test.mjs), which keep every row until archived.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { modelContext } from './fixtures/chats-list-model.mjs';
import { withSkinHostParts } from './fixtures/skin-host-parts.mjs';
import { withWebParts } from './fixtures/web-parts.mjs';
const read = p => withWebParts(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const aad = read('web/layouts/ai-apps/desktop.js'), host = withSkinHostParts(read('web/core/skin-host.js'));
const between = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, a); const j = s.indexOf(b, i); assert.ok(j > i, b); return s.slice(i, j); };
const H = 3600e3, NOW = Date.now();
const row = (id, h, extra = {}) => ({ id, title: 'T ' + id, status: 'completed', at: NOW - h * H, updatedAt: new Date(NOW - h * H).toISOString(), ...extra });
const needs = s => s.attention?.state === 'needs_you';
const unread = s => !!s.fresh && s.status !== 'running';
const groups = rows => ({ working: rows.filter(s => s.status === 'running'), ready: rows.filter(s => s.status !== 'running' && !s.archived && !s.deferred), deferred: rows.filter(s => s.deferred && !s.archived), archive: rows.filter(s => s.archived) });
// w1 his send still running, w2 a run the agent started (2 h back, so newer finished rows sort above it by time), y1
// needs you, g1 unread, r1 / r2 read, old read 10 days back, s1 snoozed, a1 archived.
const ROWS = () => [row('w1', 1, { status: 'running' }), row('w2', 2.5, { status: 'running' }), row('y1', 30, { attention: { state: 'needs_you' } }), row('g1', 2, { fresh: true }),
  row('r1', 3), row('r2', 50), row('old', 10 * 24), row('s1', 4, { deferred: true }), row('a1', 5, { archived: true })];
const M = modelContext({}).WizChatsListModel;
const facts = { needs, unread, at: s => s.at };
// w1 is a send of his still running: the box's Sent log names its thread. With Smart inbox off that keeps it in Inbox ›
// Working all the same (issue 1962: nothing is routed out of Inbox).
const PLACE = () => ({ sent: M.sentIndex([{ id: 'sent_w1', thread: 'w1', state: 'running', at: NOW - H }]) });
const J = v => JSON.parse(JSON.stringify(v)); // vm arrays are from another realm

test('the switch is gone: not in the catalog, and a saved choice for it is cleared', () => {
  const cat = JSON.parse(readFileSync(new URL('../web/tweaks/catalog.json', import.meta.url), 'utf8'));
  assert.ok(!JSON.stringify(cat).includes('wizard/inbox-until-archived'));
  assert.equal(M.inboxKeep, undefined); assert.equal(M.INBOX_KEEP, undefined);
});

test('list model: Working on top, then every thread waits in Inbox until archived, no Recent', () => {
  const g = M.activityGroups(groups(ROWS()), facts, { place: PLACE() });
  assert.deepEqual(J(g.working.map(s => s.id)), ['w1', 'w2'], 'every running thread is in Working, his own send too (issue 1962)');
  assert.deepEqual(J(g.ready.map(s => s.id)), ['g1', 'r1', 'y1', 'r2', 'old'], 'read, unread, needs you and old alike, newest first; no running thread mixed in');
  assert.deepEqual([g.recent.length, g.older], [0, 0], 'no Recent and no Show older');
  assert.deepEqual(J(g.snoozed.map(s => s.id)), ['s1'], 'snoozed leave until the snooze ends');
  assert.deepEqual(J(g.archive.map(s => s.id)), ['a1'], 'archived stay reachable');
});

test('list model with Inbox rows facts: running threads are in Working, not mixed into Inbox', () => {
  const inbox = { quiet: () => false, pin: () => 0 };
  const g = M.activityGroups(groups(ROWS()), facts, { inbox, place: PLACE() });
  assert.deepEqual(J(g.working.map(s => s.id)), ['w1', 'w2']);
  assert.ok(!g.ready.some(s => s.id === 'w1' || s.id === 'w2'), 'no running thread in Inbox');
  assert.ok(g.ready.some(s => s.id === 'y1'), 'what needs him stays in Inbox');
});

test('list model: a thread only aged past "archive after" stays in Inbox; one the owner archived does not', () => {
  const g = groups(ROWS()); g.archive.push(row('aged', 9 * 24));   // in Archive by age only (archived is false)
  const out = M.activityGroups(g, facts, {});
  assert.ok(out.ready.some(s => s.id === 'aged'), 'aged: still in Inbox');
  assert.deepEqual(J(out.archive.map(s => s.id)), ['a1'], 'only what the owner archived');
});

test('regression: open an unread Inbox thread and go Back: still in Inbox, now read; Archive it: gone from Inbox, in Archived', () => {
  const rows = ROWS(), inbox = () => M.activityGroups(groups(rows), facts, {});
  assert.ok(inbox().ready.some(s => s.id === 'g1' && unread(s)));
  rows.find(s => s.id === 'g1').fresh = false;                       // opened: markSeen
  assert.ok(inbox().ready.some(s => s.id === 'g1'), 'still in Inbox after reading');
  assert.ok(!unread(rows.find(s => s.id === 'g1')), 'now read');
  rows.find(s => s.id === 'g1').archived = true;                     // Archive
  assert.ok(!inbox().ready.some(s => s.id === 'g1'), 'gone from Inbox');
  assert.ok(inbox().archive.some(s => s.id === 'g1'), 'in Archived');
});

test('list model activityList: Working rows carry the spinner, Inbox rows their read / unread marks', () => {
  const f = { live: { cardAt: s => s.updatedAt }, chats: { activityNeeds: needs, activityUnread: unread, inboxPlace: () => PLACE(), threadActions: () => ['snooze', 'done'], channelOf: () => 'General', agentLabelOf: () => '' } };
  const l = M.activityList(groups(ROWS()), f, {});
  assert.deepEqual(J(l.working.map(r => [r.id, r.mark])), [['w1', 'working'], ['w2', 'working']]);
  assert.deepEqual(J(l.ready.map(r => [r.id, r.mark])), [['g1', 'new'], ['r1', ''], ['y1', 'needs'], ['r2', ''], ['old', '']], 'marks tell read from unread in the one list');
  assert.equal(l.recent.length, 0);
});

class Node {
  constructor(tag = 'div', cls = '', attrs = {}) { this.tag = tag; this.cls = cls; this.attrs = { ...attrs }; this.children = []; this.dataset = {}; this.textContent = attrs.text || ''; this.hidden = false; this.classList = { contains: () => false }; }
  append(...n) { this.children.push(...n); } replaceChildren(...n) { this.children = n; } setAttribute(k, v) { this.attrs[k] = v; } getAttribute(k) { return this.attrs[k]; }
  get childElementCount() { return this.children.length; }
  all() { return this.children.flatMap(n => [n, ...(n.all ? n.all() : [])]); }
}
function sidebar() {
  const c = { console, Date, JSON, String, Object, Array };
  c.window = c; c.globalThis = c; modelContext(c);
  const Mc = c.WizChatsListModel;
  const f = { live: { cardAt: s => s.updatedAt, isNew: unread }, chats: { activityNeeds: needs, activityUnread: unread, inboxPlace: () => PLACE(), threadActions: () => ['snooze', 'done'], channelOf: () => 'General', agentLabelOf: () => '' } };
  const api = { listen() {}, storage: { set() {}, get: () => undefined },
    sessions: { order: () => 'newest', list: o => o?.activity ? Mc.activityList(groups(ROWS()), f, { order: 'newest' }) : { working: [], snoozed: [], ready: [], archive: [] } },
    agents: { focus: () => ({ id: '', agents: [] }) } };
  Object.assign(c, { api, root: { dataset: { aadSide: 'open' } }, scroll: new Node(), q: '', secOpen: { ready: true, working: true, snoozed: false, archive: false },
    sessions: null, drawn: '', KINDS: ['working', 'snoozed', 'ready', 'archive'], EMPTY: {}, sectionsFor: () => [['working', 'Working'], ['snoozed', 'Snoozed'], ['ready', 'Ready'], ['archive', 'Archive']],
    archiveTop: () => false, workingOrder: () => 'alphabetical', readyOrder: () => 'newest', badgeText: () => '', CHATS: 'wizard', here: () => ({ thread: null }),
    el: (...a) => new Node(...a), icon: () => new Node('i'), label: t => new Node('h3', 'aad-lab', { text: t }), markCurrent() {}, closeMenu() {}, openSortMenu() {},
    chatRow: r => new Node('div', 'aad-rw', { text: r.id + (r.mark ? ':' + r.mark : '') }), agentsRow: Object.assign(new Node(), { hidden: true }), agentsDrawn: '', pickAgent() {},
    groupBy: () => 'none', GROUP_ORDERS: [['newest', 'Newest first'], ['oldest', 'Oldest first']], GROUP_MODES: Mc.GROUP_MODES, readyGroups: Mc.readyGroups, projectGroups: Mc.projectGroups, readyFlat: Mc.readyFlat });
  vm.runInContext(between(aad, '  const actOn = () =>', '  /* The app panel on the left'), c);
  vm.runInContext('var readSessions = () => { sessions = api.sessions.list(actOn() ? { activity: true } : { focused: true }); return sessions; };', c);
  vm.runInContext(between(aad, '  const actOrder = () =>', '  const setActOrder = o =>'), c);
  vm.runInContext(between(aad, '  function paintList(', '  /** the chat in front'), c);
  c.readSessions(); c.paintList(true);
  return c;
}
const words = sc => sc.all().filter(n => n.cls === 'aad-sec-w').map(n => n.textContent);
const rws = sc => sc.all().filter(n => n.cls === 'aad-rw').map(n => n.textContent);

test('AI apps desktop sidebar: Working on top, then Inbox, Snoozed, Archived; every thread in Inbox with its marks', () => {
  const on = sidebar();
  assert.deepEqual(words(on.scroll), ['Working', 'Inbox', 'Snoozed', 'Archived']);
  assert.deepEqual(rws(on.scroll), ['w1:working', 'w2:working', 'g1:new', 'r1', 'y1:needs', 'r2', 'old']);
  assert.equal(on.scroll.all().filter(n => n.cls === 'aad-more-older').length, 0, 'no Show older');
});

test('skin-host activity rows: a snoozed alert waits with the snoozed chats, never in a Recent section', () => {
  const c = { console, structuredClone }; c.window = c; modelContext(c);
  c.readReadyOrder = () => 'newest';
  c.noteRows = () => [{ id: 'notif:x', note: true, rank: 1, at: new Date(NOW).toISOString(), snoozed: false }, { id: 'notif:y', note: true, rank: 3, at: new Date(NOW - 9 * H).toISOString(), snoozed: true }];
  vm.runInContext(between(host, '  function activityRows(l) {', '  function withNoteRows('), c);
  const out = c.activityRows({ working: [], ready: [{ id: 'g', at: new Date(NOW - H).toISOString(), mark: 'new' }], recent: [], snoozed: [], archive: [], older: 0 });
  assert.deepEqual([...out.ready].map(r => r.id), ['notif:x', 'g']);
  assert.deepEqual([...out.recent].map(r => r.id), []);
  assert.deepEqual([...out.snoozed].map(r => r.id), ['notif:y']);
});
