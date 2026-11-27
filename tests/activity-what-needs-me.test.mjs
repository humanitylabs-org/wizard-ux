// Activity as a short what-needs-me list (wizard-ux issue 1336, part of Channels, on for everyone since issue 1258): the real Chats renderer
// for the phone / Classic list and the real AI apps sidebar paint, on the real list model.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { modelContext } from './fixtures/chats-list-model.mjs';
import { withSkinHostParts } from './fixtures/skin-host-parts.mjs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withWebParts } from './fixtures/web-parts.mjs';
const read = p => withWebParts(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const chats = withParts(read('web/core/chats.js')), aad = read('web/layouts/ai-apps/desktop.js'), host = withSkinHostParts(read('web/core/skin-host.js'));
const between = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, a); const j = s.indexOf(b, i); assert.ok(j > i, b); return s.slice(i, j); };
const H = 3600e3, NOW = Date.now();
const row = (id, h, extra = {}) => ({ id, title: 'T ' + id, status: 'completed', at: NOW - h * H, updatedAt: new Date(NOW - h * H).toISOString(), ...extra });
const needs = s => s.status === 'waiting_for_approval' || s.attention?.state === 'needs_you';
const unread = s => !!s.fresh && s.status !== 'running';
const groups = rows => ({ working: rows.filter(s => s.status === 'running'), ready: rows.filter(s => s.status !== 'running' && !s.archived && !s.deferred), deferred: rows.filter(s => s.deferred && !s.archived), archive: rows.filter(s => s.archived) });
const ROWS = () => [row('w1', 1, { status: 'running' }), row('y1', 30, { attention: { state: 'needs_you', ask: 'Pick' } }), row('g1', 2, { fresh: true }),
  row('r1', 3), row('r2', 50), row('old', 10 * 24), row('s1', 4, { deferred: true }), row('a1', 5, { archived: true })];

// The phone / Classic Chats list: Chats › Inbox (wizard-ux issue 1779, on for everyone), the real chats-inboxrows.js
// part behind the real activityBody line (core/chats-spaces.js).
function phone({ order = 'newest', open = {} } = {}) {
  const c = vm.createContext({ console, Date, Promise, String, Number, Set, Map, Array, Object, JSON, setTimeout });
  c.window = c; c.globalThis = c; modelContext(c);
  c.document = { documentElement: { dataset: { tweaks: '' } } }; c.WizCore = { chatsParts: {} };
  vm.runInContext(read('web/core/chats-inboxrows.js'), c);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[x]);
  const api = c.WizCore.chatsParts.inboxrows({
    actMark: s => s.status === 'running' ? 'working' : needs(s) ? 'needs' : unread(s) ? 'new' : '', actNeeds: needs, actUnread: unread,
    AGS: () => ({ sigil: () => '', defaultId: () => 'hermes' }), agentName: id => id || 'Wizard', agentRec: id => ({ id }), ago: () => '1h', attOf: s => s.attention || null,
    chanAt: s => s.at, chanFace: n => ({ emoji: '💬', label: n, own: false }), chanStore: () => ({ channels: [] }), chatVars: { readyOrder: order, secOpen: { snoozed: false, archived: false, ...open } },
    ch: () => ({ more: {} }), clip: (s, n) => String(s).slice(0, n), elOf: () => null, esc, isWorking: s => s.status === 'running',
    LIVE: { workGroups: groups, cardAt: s => new Date(s.at).toISOString(), quietReply: () => false, chanDaily: { state: () => null }, sentLog: { state: () => ({ ok: true, rows: [] }) }, agentInbox: { needs: () => [] } },
    noteAt: n => n.time * 1000, noteRow: n => `<note ${n.id}>`, renderChatList: () => {}, rowAgent: () => 'hermes', spacesOf: () => [], threadAct: () => {}, toast: () => {}, W: {}, winAgent: () => '',
  });
  c.inboxRowsBody = api.inboxRowsBody;
  vm.runInContext(between(chats, '  function activityBody(', "  // The Inbox's taps") + '\nthis.activityBody = activityBody;', c);
  return c;
}
const secs = html => [...html.matchAll(/<section class="ch-sec ch-act(?: ch-ib)?( open)?" data-sec="([^"]+)">(?:<div class="ch-sec-hl">)?<button class="ch-sec-h" data-sectoggle="[^"]+" aria-expanded="(true|false)"><span>([^<]+)<\/span>(?:<small>([^<]*)<\/small>)?/g)].map(m => [m[4], m[5] || '', m[3] === 'true']);

// The AI apps sidebar (layouts/ai-apps/desktop.js paintList and paintAgents), on a small fake DOM.
class Node {
  constructor(tag = 'div', cls = '', attrs = {}) { this.tag = tag; this.cls = cls; this.attrs = { ...attrs }; this.children = []; this.dataset = {}; this.textContent = attrs.text || ''; this.hidden = false; this.classList = { contains: () => false }; }
  append(...n) { this.children.push(...n); } replaceChildren(...n) { this.children = n; } setAttribute(k, v) { this.attrs[k] = v; } getAttribute(k) { return this.attrs[k]; }
  get childElementCount() { return this.children.length; }
  all() { return this.children.flatMap(n => [n, ...(n.all ? n.all() : [])]); }
}
function sidebar({ order = 'newest', agents = 3, rows = null } = {}) {
  const c = { console, Date, JSON, String, Object, Array };
  c.window = c; c.globalThis = c; modelContext(c);
  const M = c.WizChatsListModel, listens = [], set = [];
  const facts = { live: { cardAt: s => s.updatedAt, isNew: unread }, chats: { activityNeeds: needs, activityUnread: unread, threadActions: () => ['snooze', 'done'], channelOf: () => 'General', agentLabelOf: s => s.owner === 'host' ? 'Host' : '' } };
  const asked = [];
  const api = { listen: (n, k, fn) => listens.push([n, k, fn]), storage: { set: (k, v) => set.push([k, v]), get: () => undefined },
    sessions: { order: () => order, list: o => { asked.push(o); return o?.activity ? M.activityList(groups(rows || [...ROWS(), row('h1', 1, { owner: 'host', fresh: true })]), facts, { order: M.activitySortOf(order), now: NOW, older: o.older }) : { working: [], snoozed: [], ready: [row('legacy', 1)], archive: [] }; } },
    agents: { focus: () => ({ id: '', agents: Array.from({ length: agents }, (_, i) => ({ id: 'a' + i, label: 'A' + i })) }) } };
  Object.assign(c, { api, root: { dataset: { aadSide: 'open' } }, scroll: new Node(), q: '', secOpen: { ready: true, working: false, snoozed: false, archive: false },
    sessions: null, drawn: '', KINDS: ['working', 'snoozed', 'ready', 'archive'], EMPTY: {}, sectionsFor: () => [['working', 'Working'], ['snoozed', 'Snoozed'], ['ready', 'Ready'], ['archive', 'Archive']],
    archiveTop: () => false, workingOrder: () => 'alphabetical', readyOrder: () => 'newest', badgeText: () => '', CHATS: 'wizard', here: () => ({ thread: null }),
    el: (...a) => new Node(...a), icon: () => new Node('i'), label: t => new Node('h3', 'aad-lab', { text: t }), markCurrent() {}, closeMenu() {}, openSortMenu() {},
    chatRow: r => new Node('div', 'aad-rw', { text: r.id + (r.mark ? ':' + r.mark : '') + (r.agentName ? '·' + r.agentName : '') }), agentsRow: Object.assign(new Node(), { hidden: true }), agentsDrawn: '', pickAgent() {},
    groupBy: () => 'none', GROUP_ORDERS: [['newest', 'Newest first'], ['oldest', 'Oldest first']], GROUP_MODES: M.GROUP_MODES, readyGroups: M.readyGroups, projectGroups: M.projectGroups, readyFlat: M.readyFlat });
  vm.runInContext(between(aad, '  const actOn = () =>', '  /* The app panel on the left'), c);
  vm.runInContext('var readSessions = () => { sessions = api.sessions.list(actOn() ? { activity: true } : { focused: true }); return sessions; };', c);
  vm.runInContext(between(aad, '  const actOrder = () =>', '  const setActOrder = o =>'), c);
  vm.runInContext(between(aad, '  function paintAgents()', '  function pickAgent('), c);
  vm.runInContext(between(aad, '  function paintList(', '  /** the chat in front'), c);
  return { c, asked, listens, set };
}
const heads = sc => sc.all().filter(n => n.cls === 'aad-lab aad-sec').map(n => [n.attrs['data-sec'], n.attrs['aria-expanded']]);
const texts = (sc, cls) => sc.all().filter(n => n.cls === cls).map(n => n.textContent);

// wizard-ux issue 1966 (one design on phone and desktop): the sidebar's Inbox is Chats' own list in its pane (the phone's
// title bar, Working / Inbox / Snoozed / Archived, rows and sort), so the layout draws no sections or rows of its own.
test('AI apps sidebar: no agent chips, every agent; Inbox is the pane\'s shared list, never rows of the sidebar\'s own (issue 1966)', () => {
  const { c, asked } = sidebar();
  c.paintAgents(); assert.equal(c.agentsRow.hidden, true, 'the agent chip strip is gone'); assert.equal(c.agentsRow.children.length, 0);
  c.paintChan = () => true; // the pane drew Chats' own list
  c.readSessions(); c.scroll.append(new Node('div', 'aad-rw')); c.paintList(true);
  assert.deepEqual(JSON.parse(JSON.stringify(asked.at(-1))), { activity: true }, 'every agent, never the focused list');
  assert.equal(c.scroll.children.length, 0, 'nothing of its own under the shared list');
  c.paintChan = () => false; c.paintList(true); // the pane not drawn yet
  assert.deepEqual(heads(c.scroll), [], 'no Working / Inbox section rows of its own');
  assert.deepEqual(texts(c.scroll, 'aad-rw'), [], 'no compact rows of its own');
  assert.equal(c.scroll.all().filter(n => /aad-sortb|aad-groupb/.test(n.cls)).length, 0, 'no sort or group drop-down of its own');
  assert.deepEqual(texts(c.scroll, 'aad-empty'), ['Loading your chats…']);
});

test('AI apps sidebar: Needs you first puts amber first (the shared Inbox rows the pane draws)', () => {
  const ids = html => [...html.matchAll(/data-chopen="([^"]+)"/g)].map(m => m[1]);
  const all = [...ROWS(), row('h1', 1, { owner: 'host', fresh: true })];
  assert.deepEqual(ids(phone({ order: 'priority' }).activityBody({ id: 'w' }, all, null, 0)).filter(id => id !== 'w1').slice(0, 1), ['y1']);
  assert.notEqual(ids(phone({ order: 'newest' }).activityBody({ id: 'w' }, all, null, 0)).filter(id => id !== 'w1')[0], 'y1');
});

test('skin-host: list({ activity: true }) reads the shell\'s activity list; unread alerts wait in Inbox, read ones with Snoozed', () => {
  const c = { console, structuredClone }; c.window = c; modelContext(c);
  c.readReadyOrder = () => 'newest';
  c.noteRows = () => [{ id: 'notif:x', note: true, rank: 1, at: new Date(NOW).toISOString(), snoozed: false }, { id: 'notif:y', note: true, rank: 3, at: new Date(NOW - 9 * H).toISOString(), snoozed: true }];
  vm.runInContext(between(host, '  function activityRows(l) {', '  function withNoteRows('), c);
  const o = c.activityRows({ working: [], ready: [{ id: 'g', at: new Date(NOW - H).toISOString(), mark: 'new' }], recent: [], snoozed: [], archive: [], older: 0 });
  assert.deepEqual([...o.ready].map(r => [r.id, r.mark]), [['notif:x', 'needs'], ['g', 'new']]);
  assert.deepEqual([...o.recent].map(r => r.id), [], 'no Recent (issue 1810)');
  assert.deepEqual([...o.snoozed].map(r => r.id), ['notif:y']);
  // the real host list(): { activity: true } asks the shell's activityList in the saved order and runs it through activityRows
  const asked = [], l0 = { working: [], ready: [{ id: 'g', at: new Date(NOW - H).toISOString(), mark: 'new' }], recent: [], snoozed: [], archive: [], older: 0 };
  c.live = () => true;
  c.shell = { activityList: o => { asked.push(JSON.parse(JSON.stringify(o))); return structuredClone(l0); }, sessionList: () => null };
  vm.runInContext(`this.api = ({ ${between(host, '        list: opts =>', '        open: id =>')} });`, c);
  const a = c.api.list({ activity: true });
  assert.deepEqual([...a.ready].map(r => r.id), ['notif:x', 'g'], 'unread alerts join Inbox through activityRows');
  c.api.list({ activity: true, older: true });
  assert.deepEqual(asked, [{ order: 'newest' }, { order: 'newest' }], 'no Show older to ask for');
  assert.equal(c.api.list({ activity: 1 }), null, 'only activity: true reads the activity list');
  c.live = () => false; assert.equal(c.api.list({ activity: true }), null, 'nothing before the shell is live');
  assert.equal(asked.length, 2);
});

// wizard-ux issue 1360: one "waiting on you" rule. The real chanNeeds / attOf / chanUnread from chats.js drive the real
// Activity grouping, so a Your call (check) thread keeps its amber marker after it is opened, green loses its dot on
// open, and Mark done clears amber; every thread stays in Inbox until archived (issue 1810).
function realRule() {
  const line = t => { const i = chats.indexOf('\n  ' + t); assert.ok(i >= 0, t); return chats.slice(i + 1, chats.indexOf('\n', i + 1)); };
  const read = new Set(), handled = new Set();
  const c = { console, Date, JSON, String, Object, Array };
  c.window = c; c.globalThis = c; modelContext(c);
  Object.assign(c, { LIVE: { isNew: s => !!s.fresh && !read.has(s.id), handled: s => handled.has(s.id) }, snoozeLast: () => false, deferredOf: s => !!s.deferred });
  vm.runInContext(['const WORKING_ST =', 'const isWorking =', 'const handledNow =', 'const chanNeeds =',
    'const chanUnread =', 'const actNeeds =', 'const actUnread =', 'const attOf ='].map(line).join('\n')
    + '\nthis.needs = actNeeds; this.unread = actUnread; this.attOf = attOf;', c);
  return { c, open: id => read.add(id), markDone: id => { handled.add(id); read.add(id); } };
}
test('issue 1360: one waiting-on-you rule for Inbox and the amber marker; opening never clears amber, only green', () => {
  const { c, open, markDone } = realRule(), M = c.WizChatsListModel;
  const done = new Date(NOW - 2 * H).toISOString();
  const rows = [row('chk', 2, { fresh: true, attention: { state: 'check', ask: 'Try it and say what to tweak' }, lastAssistantAt: done }),
    row('ny', 3, { fresh: true, attention: { state: 'needs_you', ask: 'Pick one' } }), row('apr', 4, { status: 'waiting_for_approval' }),
    row('grn', 1, { fresh: true, attention: { state: 'done', ask: 'Shipped' } }), row('fyi', 5, { attention: { state: 'fyi', ask: 'FYI' } })];
  const list = () => M.activityList(groups(rows), { live: { cardAt: s => s.updatedAt, isNew: c.unread }, chats: { activityNeeds: c.needs, activityUnread: c.unread, threadActions: () => [], channelOf: () => 'General', agentLabelOf: () => '' } }, { order: 'newest' });
  const marks = l => [...l.ready].map(r => r.id + (r.mark ? ':' + r.mark : ''));
  let l = list();
  assert.deepEqual(marks(l), ['grn:new', 'chk:needs', 'ny:needs', 'apr:needs', 'fyi']);
  assert.equal(l.recent.length, 0, 'no Recent');
  for (const id of ['chk', 'ny', 'grn']) open(id); // open each thread and go back
  l = list();
  assert.deepEqual(marks(l), ['grn', 'chk:needs', 'ny:needs', 'apr:needs', 'fyi'], 'Your call and Needs you keep amber; green loses its dot and stays');
  markDone('chk'); markDone('ny');
  l = list();
  assert.deepEqual(marks(l), ['grn', 'chk', 'ny', 'apr:needs', 'fyi'], 'Mark done clears amber; the thread stays until archived');
  assert.equal(c.attOf(rows[0]), null, 'Mark done clears a Your call status too');
});

// wizard-ux issue 1731: a fresh box shows one empty state; a section appears only while it holds something; no empty
// count, no Ready sort without Ready.
// owner-correction: humanitylabs-org/wizard-ux#1731 · 2026-11-22 · "don't display these empty sections if there's nothing in them"
test('phone Activity on a fresh box: one empty state, no sections, no None lines, no empty count, no sort (issue 1731)', () => {
  const html = phone().activityBody({ id: 'w' }, [], null);
  assert.deepEqual(secs(html), []);
  assert.match(html, /^<div class="ch-empty ch-act-empty"><b>No chats yet<\/b>[^]*<button type="button" class="ch-fclear" data-chnew data-chemptynew>New chat<\/button><\/div>$/);
  assert.doesNotMatch(html, /ch-none|<small>|data-chactorder/);
  assert.equal(phone().activityBody({ id: 'w' }, [], null, 1), '', 'a draft alone: the Drafts section above stands in, no second New chat');
});

test('phone Inbox: only the sections that hold a chat, with real counts (issue 1731)', () => {
  const one = rows => phone().activityBody({ id: 'w' }, rows, null);
  let html = one([row('w1', 0, { status: 'running' })]);
  assert.deepEqual(secs(html), [['Working', '1', true]], 'a running thread no Sent row names: Working (issue 1810)'); assert.match(html, /ch-ib-empty"><b>Nothing needs you</, 'Inbox itself is empty'); assert.doesNotMatch(html, /ch-none|<small><\/small>|data-chactorder|ch-act-empty/);
  html = one([row('g1', 0, { fresh: true })]);
  assert.deepEqual(secs(html), [['Inbox', '1', true]]); assert.match(html, /data-chactorder/, 'the sort shows while Inbox has a chat');
  html = one([row('s1', 1, { deferred: true })]);
  assert.deepEqual(secs(html), [['Snoozed', '1', false]]); assert.doesNotMatch(html, /data-chactorder/);
  html = one([row('y1', 10 * 24, { attention: { state: 'needs_you', ask: 'Pick' } })]);
  assert.deepEqual(secs(html), [['Inbox', '1', true]], 'no Recent and no Show older: a row stays until archived'); assert.doesNotMatch(html, /data-sec="recent"|data-chactolder/);
  html = phone({ open: { snoozed: true } }).activityBody({ id: 'w' }, [], { awake: [{ id: 'n1', time: (NOW - 0.5 * H) / 1000 }], later: [] });
  assert.deepEqual(secs(html), [['Inbox', '1', true]], 'an unread alert alone still shows Inbox');
});

test('AI apps sidebar on a fresh box: the pane\'s one empty state with New chat, no sections; the sidebar adds none (issues 1731, 1966)', () => {
  const { c } = sidebar({ rows: [] }); c.paintChan = () => true;
  c.readSessions(); c.paintList(true);
  assert.deepEqual(heads(c.scroll), []); assert.equal(c.scroll.children.length, 0, 'no empty state of its own');
  const html = phone().activityBody({ id: 'w' }, [], null, 0);
  assert.match(html, /class="ch-empty ch-act-empty"/); assert.match(html, /data-chnew/); assert.deepEqual(secs(html), []);
});
