// Inbox until archived (wizard-ux issue 1810, switch wizard/inbox-until-archived; James, 25 Nov 2026: "let's go back to
// manually archiving things when they are done ... treat it like an inbox again"). With the switch on, Chats › Inbox is
// one list: Working, then Inbox (every thread that is not working, snoozed or archived, read or not), no Recent. Runs
// the real list model, the real phone / Classic Activity renderer, the real AI apps sidebar paint and the real skin-host
// activity rows. With the switch off every one of them is today's Ready / Recent split.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { modelContext } from './fixtures/chats-list-model.mjs';
import { withSkinHostParts } from './fixtures/skin-host-parts.mjs';
import { withParts } from './fixtures/chats-parts.mjs';
import { withWebParts } from './fixtures/web-parts.mjs';
const read = p => withWebParts(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const chats = withParts(read('web/core/chats.js')), aad = read('web/layouts/ai-apps/desktop.js'), host = withSkinHostParts(read('web/core/skin-host.js'));
const between = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, a); const j = s.indexOf(b, i); assert.ok(j > i, b); return s.slice(i, j); };
const H = 3600e3, NOW = Date.now(), SW = 'wizard/inbox-until-archived';
const row = (id, h, extra = {}) => ({ id, title: 'T ' + id, status: 'completed', at: NOW - h * H, updatedAt: new Date(NOW - h * H).toISOString(), ...extra });
const needs = s => s.attention?.state === 'needs_you';
const unread = s => !!s.fresh && s.status !== 'running';
const groups = rows => ({ working: rows.filter(s => s.status === 'running'), ready: rows.filter(s => s.status !== 'running' && !s.archived && !s.deferred), deferred: rows.filter(s => s.deferred && !s.archived), archive: rows.filter(s => s.archived) });
// w1 working, y1 needs you, g1 unread, r1 / r2 read, old read 10 days back, s1 snoozed, a1 archived.
const ROWS = () => [row('w1', 1, { status: 'running' }), row('y1', 30, { attention: { state: 'needs_you' } }), row('g1', 2, { fresh: true }),
  row('r1', 3), row('r2', 50), row('old', 10 * 24), row('s1', 4, { deferred: true }), row('a1', 5, { archived: true })];
const M = modelContext({}).WizChatsListModel;
const facts = { needs, unread, at: s => s.at };
const J = v => JSON.parse(JSON.stringify(v)); // vm arrays are from another realm

test('list model: the switch id is read from data-tweaks', () => {
  assert.equal(M.INBOX_KEEP, SW);
  assert.equal(M.inboxKeep(`wizard/desktop-chats ${SW}`), true);
  assert.equal(M.inboxKeep('wizard/desktop-chats'), false);
  assert.equal(M.inboxKeep(undefined), false);
});

test('list model: on, every thread waits in Inbox until archived; off, read ones fall to Recent as today', () => {
  const on = M.activityGroups(groups(ROWS()), facts, { now: NOW, keep: true });
  assert.deepEqual(J(on.working.map(s => s.id)), ['w1']);
  assert.deepEqual(J(on.ready.map(s => s.id)), ['g1', 'r1', 'y1', 'r2', 'old'], 'read, unread, needs you and old alike, newest first');
  assert.deepEqual([on.recent.length, on.older], [0, 0], 'no Recent and no Show older');
  assert.deepEqual(J(on.snoozed.map(s => s.id)), ['s1'], 'snoozed leave until the snooze ends');
  assert.deepEqual(J(on.archive.map(s => s.id)), ['a1'], 'archived stay reachable');
  const off = M.activityGroups(groups(ROWS()), facts, { now: NOW });
  assert.deepEqual(J(off.ready.map(s => s.id)), ['g1', 'y1']);
  assert.deepEqual(J(off.recent.map(s => s.id)), ['r1', 'r2']);
  assert.equal(off.older, 1);
});

test('list model: a thread only aged past "archive after" stays in Inbox; one the owner archived does not', () => {
  const g = groups(ROWS()); g.archive.push(row('aged', 9 * 24));   // in Archive by age only (archived is false)
  const on = M.activityGroups(g, facts, { now: NOW, keep: true });
  assert.ok(on.ready.some(s => s.id === 'aged'), 'aged: still in Inbox');
  assert.deepEqual(J(on.archive.map(s => s.id)), ['a1'], 'only what the owner archived');
  const off = M.activityGroups(g, facts, { now: NOW });
  assert.deepEqual(J(off.archive.map(s => s.id)), ['a1', 'aged'], 'off: as today');
});

test('regression: open an unread Inbox thread and go Back: still in Inbox, now read; Archive it: gone from Inbox, in Archived', () => {
  const rows = ROWS(), inbox = () => M.activityGroups(groups(rows), facts, { now: NOW, keep: true });
  assert.ok(inbox().ready.some(s => s.id === 'g1' && unread(s)));
  rows.find(s => s.id === 'g1').fresh = false;                       // opened: markSeen
  assert.ok(inbox().ready.some(s => s.id === 'g1'), 'still in Inbox after reading');
  assert.ok(!unread(rows.find(s => s.id === 'g1')), 'now read');
  rows.find(s => s.id === 'g1').archived = true;                     // Archive
  assert.ok(!inbox().ready.some(s => s.id === 'g1'), 'gone from Inbox');
  assert.ok(inbox().archive.some(s => s.id === 'g1'), 'in Archived');
});

test('list model activityList: the shell\'s own switch read decides, and the badge count is the Inbox count', () => {
  const f = keep => ({ live: { cardAt: s => s.updatedAt }, chats: { activityNeeds: needs, activityUnread: unread, inboxKeep: () => keep, threadActions: () => ['snooze', 'done'], channelOf: () => 'General', agentLabelOf: () => '' } });
  const on = M.activityList(groups(ROWS()), f(true), { now: NOW });
  assert.deepEqual(J(on.ready.map(r => [r.id, r.mark])), [['g1', 'new'], ['r1', ''], ['y1', 'needs'], ['r2', ''], ['old', '']], 'marks tell read from unread in the one list');
  assert.equal(on.recent.length, 0);
  const off = M.activityList(groups(ROWS()), f(false), { now: NOW });
  assert.deepEqual(J(off.ready.map(r => r.id)), ['g1', 'y1']); assert.deepEqual(J(off.recent.map(r => r.id)), ['r1', 'r2']);
});

function phone(keep) {
  const c = { console, Date, localStorage: { getItem: () => null, setItem() {} } };
  c.window = c; modelContext(c);
  Object.assign(c, { readyOrder: 'newest', actOlder: false, SEC_PAGE: 40, secOpen: { working: true, ready: true, recent: true, snoozed: false, archived: false },
    ch: () => ({ more: {} }), LIVE: { workGroups: groups }, actNeeds: needs, actUnread: unread, chanAt: s => s.at, noteAt: n => n.time * 1000,
    chatRow: s => `<row ${s.id}>`, noteRow: n => `<note ${n.id}>`, inboxKeep: () => keep });
  vm.runInContext(between(chats, '  const ACT_SORTS = () =>', '  // The sort and Show older taps').replace('let actOlder = false;', ''), c);
  return c;
}
const secs = html => [...html.matchAll(/data-sec="([^"]+)">(?:<div class="ch-sec-hl">)?<button class="ch-sec-h" data-sectoggle="[^"]+" aria-expanded="(?:true|false)"><span>([^<]+)<\/span>(?:<small>([^<]*)<\/small>)?/g)].map(m => [m[1], m[2], m[3] || '']);
const rowsIn = (html, k) => [...(html.split(`data-sec="${k}"`)[1] || '').split('</section>')[0].matchAll(/<(?:row|note) ([^>]+)>/g)].map(m => m[1]);

test('phone / Classic: Working, then Inbox with its count, no Recent; a read (kept) alert waits with Snoozed, as on the AI apps sidebar', () => {
  const nt = { awake: [{ id: 'n1', time: (NOW - 0.5 * H) / 1000 }], later: [{ id: 'n2', time: (NOW - 6 * H) / 1000 }] };
  const html = phone(true).activityBody({ id: 'w' }, ROWS(), nt);
  assert.deepEqual(secs(html), [['working', 'Working', '1'], ['ready', 'Inbox', '6'], ['snoozed', 'Snoozed', '2'], ['archived', 'Archived', '1']]);
  assert.deepEqual(rowsIn(html, 'ready'), ['n1', 'g1', 'r1', 'y1', 'r2', 'old']);
  assert.doesNotMatch(html, /data-sec="recent"|data-chactolder/);
  assert.match(html, /aria-label="Sort Inbox"/);
});

test('phone / Classic, switch off: today\'s Ready and Recent', () => {
  const html = phone(false).activityBody({ id: 'w' }, ROWS(), null);
  assert.deepEqual(secs(html).map(s => s.slice(0, 2)), [['working', 'Working'], ['ready', 'Ready'], ['recent', 'Recent'], ['snoozed', 'Snoozed'], ['archived', 'Archived']]);
  assert.match(html, /aria-label="Sort Ready"/);
});

class Node {
  constructor(tag = 'div', cls = '', attrs = {}) { this.tag = tag; this.cls = cls; this.attrs = { ...attrs }; this.children = []; this.dataset = {}; this.textContent = attrs.text || ''; this.hidden = false; this.classList = { contains: () => false }; }
  append(...n) { this.children.push(...n); } replaceChildren(...n) { this.children = n; } setAttribute(k, v) { this.attrs[k] = v; } getAttribute(k) { return this.attrs[k]; }
  get childElementCount() { return this.children.length; }
  all() { return this.children.flatMap(n => [n, ...(n.all ? n.all() : [])]); }
}
function sidebar(keep) {
  const c = { console, Date, JSON, String, Object, Array };
  c.window = c; c.globalThis = c; modelContext(c);
  c.WizCore = { inboxKeep: () => keep };
  const Mc = c.WizChatsListModel;
  const f = { live: { cardAt: s => s.updatedAt, isNew: unread }, chats: { activityNeeds: needs, activityUnread: unread, inboxKeep: () => keep, threadActions: () => ['snooze', 'done'], channelOf: () => 'General', agentLabelOf: () => '' } };
  const api = { listen() {}, storage: { set() {}, get: () => undefined },
    sessions: { order: () => 'newest', list: o => o?.activity ? Mc.activityList(groups(ROWS()), f, { order: 'newest', now: NOW, older: o.older }) : { working: [], snoozed: [], ready: [], archive: [] } },
    agents: { focus: () => ({ id: '', agents: [] }) } };
  Object.assign(c, { api, root: { dataset: { aadSide: 'open' } }, scroll: new Node(), q: '', secOpen: { ready: true, working: false, snoozed: false, archive: false },
    sessions: null, drawn: '', KINDS: ['working', 'snoozed', 'ready', 'archive'], EMPTY: {}, sectionsFor: () => [['working', 'Working'], ['snoozed', 'Snoozed'], ['ready', 'Ready'], ['archive', 'Archive']],
    archiveTop: () => false, workingOrder: () => 'alphabetical', readyOrder: () => 'newest', badgeText: () => '', CHATS: 'wizard', here: () => ({ thread: null }),
    el: (...a) => new Node(...a), icon: () => new Node('i'), label: t => new Node('h3', 'aad-lab', { text: t }), markCurrent() {}, closeMenu() {}, openSortMenu() {},
    chatRow: r => new Node('div', 'aad-rw', { text: r.id + (r.mark ? ':' + r.mark : '') }), agentsRow: Object.assign(new Node(), { hidden: true }), agentsDrawn: '', pickAgent() {},
    groupBy: () => 'none', GROUP_ORDERS: [['newest', 'Newest first'], ['oldest', 'Oldest first']], GROUP_MODES: Mc.GROUP_MODES, readyGroups: Mc.readyGroups, projectGroups: Mc.projectGroups, readyFlat: Mc.readyFlat });
  vm.runInContext(between(aad, '  const actOn = () =>', '  let actOlder = false;') + 'var actOlder = false;', c);
  vm.runInContext('var readSessions = () => { sessions = api.sessions.list(actOn() ? { activity: true, older: actOlder } : { focused: true }); return sessions; };', c);
  vm.runInContext(between(aad, '  const actOrder = () =>', '  const setActOrder = o =>'), c);
  vm.runInContext(between(aad, '  function paintList(', '  /** the chat in front'), c);
  c.readSessions(); c.paintList(true);
  return c;
}
const words = sc => sc.all().filter(n => n.cls === 'aad-sec-w').map(n => n.textContent);
const rws = sc => sc.all().filter(n => n.cls === 'aad-rw').map(n => n.textContent);

test('AI apps desktop sidebar: Working, Inbox, Snoozed, Archived; every thread in Inbox with its marks', () => {
  const on = sidebar(true);
  assert.deepEqual(words(on.scroll), ['Working', 'Inbox', 'Snoozed', 'Archived']);
  assert.deepEqual(rws(on.scroll), ['g1:new', 'r1', 'y1:needs', 'r2', 'old']);
  assert.equal(on.scroll.all().filter(n => n.cls === 'aad-more-older').length, 0, 'no Show older');
  const off = sidebar(false);
  assert.deepEqual(words(off.scroll), ['Working', 'Ready', 'Recent', 'Snoozed', 'Archived']);
});

test('skin-host activity rows: with the switch on a snoozed alert waits with the snoozed chats, never in a Recent section', () => {
  const run = keep => {
    const c = { console, structuredClone }; c.window = c; modelContext(c);
    c.WizCore = { inboxKeep: () => keep };
    c.readReadyOrder = () => 'newest';
    c.noteRows = () => [{ id: 'notif:x', note: true, rank: 1, at: new Date(NOW).toISOString(), snoozed: false }, { id: 'notif:y', note: true, rank: 3, at: new Date(NOW - 9 * H).toISOString(), snoozed: true }];
    vm.runInContext(between(host, '  function activityRows(l) {', '  function withNoteRows('), c);
    return c.activityRows({ working: [], ready: [{ id: 'g', at: new Date(NOW - H).toISOString(), mark: 'new' }], recent: [], snoozed: [], archive: [], older: 0 });
  };
  const on = run(true);
  assert.deepEqual([...on.ready].map(r => r.id), ['notif:x', 'g']);
  assert.deepEqual([...on.recent].map(r => r.id), []);
  assert.deepEqual([...on.snoozed].map(r => r.id), ['notif:y']);
  const off = run(false);
  assert.deepEqual([...off.recent].map(r => r.id), ['notif:y'], 'off: as today');
});
