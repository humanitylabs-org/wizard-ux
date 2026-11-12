// Activity as a short what-needs-me list (wizard-ux issue 1336, switch wizard/chat-channels): the real Chats renderer
// for the phone / Classic list and the real AI apps sidebar paint, on the real list model.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { modelContext } from './fixtures/chats-list-model.mjs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const chats = read('web/core/chats.js'), aad = read('web/layouts/ai-apps/desktop.js'), host = read('web/core/skin-host.js');
const between = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, a); const j = s.indexOf(b, i); assert.ok(j > i, b); return s.slice(i, j); };
const H = 3600e3, NOW = Date.now();
const row = (id, h, extra = {}) => ({ id, title: 'T ' + id, status: 'completed', at: NOW - h * H, updatedAt: new Date(NOW - h * H).toISOString(), ...extra });
const needs = s => s.status === 'waiting_for_approval' || s.attention?.state === 'needs_you';
const unread = s => !!s.fresh && s.status !== 'running';
const groups = rows => ({ working: rows.filter(s => s.status === 'running'), ready: rows.filter(s => s.status !== 'running' && !s.archived && !s.deferred), deferred: rows.filter(s => s.deferred && !s.archived), archive: rows.filter(s => s.archived) });
const ROWS = () => [row('w1', 1, { status: 'running' }), row('y1', 30, { attention: { state: 'needs_you', ask: 'Pick' } }), row('g1', 2, { fresh: true }),
  row('r1', 3), row('r2', 50), row('old', 10 * 24), row('s1', 4, { deferred: true }), row('a1', 5, { archived: true })];

function phone({ order = 'newest', open = {}, older = false } = {}) {
  const c = { console, Date, localStorage: { getItem: () => null, setItem() {} } };
  c.window = c; modelContext(c);
  Object.assign(c, { readyOrder: order, actOlder: older, SEC_PAGE: 40, secOpen: { working: true, ready: true, recent: true, snoozed: false, archived: false, ...open },
    ch: () => ({ more: {} }), LIVE: { workGroups: groups }, actNeeds: needs, actUnread: unread, chanAt: s => s.at, noteAt: n => n.time * 1000,
    chatRow: s => `<row ${s.id}>`, noteRow: n => `<note ${n.id}>` });
  vm.runInContext(between(chats, '  const ACT_SORTS = () =>', '  // The sort and Show older taps').replace('let actOlder = false;', ''), c);
  return c;
}
const secs = html => [...html.matchAll(/<section class="ch-sec ch-act( open)?" data-sec="([^"]+)">(?:<div class="ch-sec-hl">)?<button class="ch-sec-h" data-sectoggle="[^"]+" aria-expanded="(true|false)"><span>([^<]+)<\/span><small>([^<]*)<\/small>/g)].map(m => [m[4], m[5], m[3] === 'true']);
const rowsIn = (html, k) => [...(html.split(`data-sec="${k}"`)[1] || '').split('</section>')[0].matchAll(/<row ([^>]+)>/g)].map(m => m[1]);

test('phone / Classic Activity: Working, Ready, Recent, then folded Snoozed and Archived, with their counts', () => {
  const c = phone(), html = c.activityBody({ id: 'w' }, ROWS(), null);
  assert.deepEqual(secs(html), [['Working', '1', true], ['Ready', '2', true], ['Recent', '', true], ['Snoozed', '1', false], ['Archived', '1', false]]);
  assert.deepEqual(rowsIn(html, 'ready'), ['g1', 'y1'], 'amber and green mixed in the one sort: Newest first');
  assert.deepEqual(rowsIn(html, 'recent'), ['r1', 'r2'], 'the rest, newest first, about a week back');
  assert.match(html, /<button class="ch-more ch-act-older" data-chactolder>Show older · 1<\/button>/);
  assert.doesNotMatch(html, /<row s1>|<row a1>/, 'Snoozed and Archived fold shut');
  assert.deepEqual([...html.matchAll(/<option value="([^"]+)"( selected)?>([^<]+)</g)].map(m => [m[1], !!m[2], m[3]]),
    [['newest', true, 'Newest first'], ['oldest', false, 'Oldest first'], ['priority', false, 'Needs you first']], 'the one sort sits on Ready');
  // wizard-ux issue 1354: one compact menu on Ready's header line (beside the fold button), not a row of pills under it
  assert.match(html, /data-sec="ready"><div class="ch-sec-hl"><button class="ch-sec-h" data-sectoggle="ready"[^]*?<\/button><label class="ch-act-sort"><select data-chactorder aria-label="Sort Ready">/);
  assert.doesNotMatch(html, /ch-rdy-bar|data-chactsort|role="radio"/, 'no pill row');
  assert.equal((html.match(/<select/g) || []).length, 1, 'one menu, on Ready only');
  assert.doesNotMatch(html, /A to Z|data-workorder|data-rdyorder|By status|By project|One list/, 'no Working sort and no layout choices');
});

test('phone / Classic Activity: the sort menu shows the saved order and stays on the header line when Ready is folded (issue 1354)', () => {
  const html = phone({ order: 'priority', open: { ready: false } }).activityBody({ id: 'w' }, ROWS(), null);
  assert.match(html, /<option value="priority" selected>Needs you first</); assert.doesNotMatch(html, /<option value="newest" selected>/);
  assert.match(html, /data-sec="ready"><div class="ch-sec-hl"><button class="ch-sec-h" data-sectoggle="ready" aria-expanded="false">[^]*?<\/button><label class="ch-act-sort">[^]*?<\/label><\/div><\/section>/);
});

test('phone Activity: Needs you first and Oldest first; Show older and unread notifications in Ready', () => {
  let html = phone({ order: 'priority' }).activityBody({ id: 'w' }, ROWS(), null);
  assert.deepEqual(rowsIn(html, 'ready'), ['y1', 'g1']);
  html = phone({ order: 'oldest' }).activityBody({ id: 'w' }, ROWS(), null);
  assert.deepEqual(rowsIn(html, 'ready'), ['y1', 'g1']); assert.deepEqual(rowsIn(html, 'recent'), ['r1', 'r2'], 'Recent stays newest first');
  html = phone({ older: true, open: { snoozed: true, archived: true } }).activityBody({ id: 'w' }, ROWS(), { awake: [{ id: 'n1', time: (NOW - 0.5 * H) / 1000 }], later: [] });
  assert.deepEqual(rowsIn(html, 'recent'), ['r1', 'r2', 'old']); assert.doesNotMatch(html, /data-chactolder/);
  assert.match(html.split('data-sec="ready"')[1].split('</section>')[0], /^[^]*<note n1>[^]*<row g1>[^]*<row y1>/, 'an unread alert waits in Ready by time');
  assert.deepEqual(rowsIn(html, 'snoozed'), ['s1']); assert.deepEqual(rowsIn(html, 'archived'), ['a1']);
});

// The AI apps sidebar (layouts/ai-apps/desktop.js paintList and paintAgents), on a small fake DOM.
class Node {
  constructor(tag = 'div', cls = '', attrs = {}) { this.tag = tag; this.cls = cls; this.attrs = { ...attrs }; this.children = []; this.dataset = {}; this.textContent = attrs.text || ''; this.hidden = false; this.classList = { contains: () => false }; }
  append(...n) { this.children.push(...n); } replaceChildren(...n) { this.children = n; } setAttribute(k, v) { this.attrs[k] = v; } getAttribute(k) { return this.attrs[k]; }
  get childElementCount() { return this.children.length; }
  all() { return this.children.flatMap(n => [n, ...(n.all ? n.all() : [])]); }
}
function sidebar({ on = true, order = 'newest', agents = 3 } = {}) {
  const c = { console, Date, JSON, String, Object, Array };
  c.window = c; c.globalThis = c; modelContext(c);
  const M = c.WizChatsListModel, listens = [], set = [];
  const facts = { live: { cardAt: s => s.updatedAt, isNew: unread }, chats: { activityNeeds: needs, activityUnread: unread, threadActions: () => ['snooze', 'done'], channelOf: () => 'General', agentLabelOf: s => s.owner === 'host' ? 'Host' : '' } };
  const asked = [];
  const api = { listen: (n, k, fn) => listens.push([n, k, fn]), storage: { set: (k, v) => set.push([k, v]), get: () => undefined },
    sessions: { order: () => order, list: o => { asked.push(o); return o?.activity ? M.activityList(groups([...ROWS(), row('h1', 1, { owner: 'host', fresh: true })]), facts, { order: M.activitySortOf(order), now: NOW, older: o.older }) : { working: [], snoozed: [], ready: [row('legacy', 1)], archive: [] }; } },
    agents: { focus: () => ({ id: '', agents: Array.from({ length: agents }, (_, i) => ({ id: 'a' + i, label: 'A' + i })) }) } };
  Object.assign(c, { api, root: { dataset: { tweaks: on ? 'wizard/chat-channels' : '', aadSide: 'open' } }, scroll: new Node(), q: '', secOpen: { ready: true, working: false, snoozed: false, archive: false },
    sessions: null, drawn: '', KINDS: ['working', 'snoozed', 'ready', 'archive'], EMPTY: {}, sectionsFor: () => [['working', 'Working'], ['snoozed', 'Snoozed'], ['ready', 'Ready'], ['archive', 'Archive']],
    archiveTop: () => false, workingOrder: () => 'alphabetical', readyOrder: () => 'newest', badgeText: () => '', CHATS: 'wizard', here: () => ({ thread: null }),
    el: (...a) => new Node(...a), icon: () => new Node('i'), label: t => new Node('h3', 'aad-lab', { text: t }), markCurrent() {}, closeMenu() {}, openSortMenu() {},
    chatRow: r => new Node('div', 'aad-rw', { text: r.id + (r.mark ? ':' + r.mark : '') + (r.agentName ? '·' + r.agentName : '') }), agentsRow: Object.assign(new Node(), { hidden: true }), agentsDrawn: '', pickAgent() {},
    groupBy: () => 'none', GROUP_ORDERS: [['newest', 'Newest first'], ['oldest', 'Oldest first']], GROUP_MODES: M.GROUP_MODES, readyGroups: M.readyGroups, projectGroups: M.projectGroups, readyFlat: M.readyFlat });
  vm.runInContext(between(aad, '  const actOn = () =>', '  let actOlder = false;') + 'var actOlder = false;', c);
  vm.runInContext('var readSessions = () => { sessions = api.sessions.list(actOn() ? { activity: true, older: actOlder } : { focused: true }); return sessions; };', c);
  vm.runInContext(between(aad, '  const actOrder = () =>', '  const setActOrder = o =>'), c);
  vm.runInContext(between(aad, '  function paintAgents()', '  function pickAgent('), c);
  vm.runInContext(between(aad, '  function paintList(', '  /** the chat in front'), c);
  return { c, asked, listens, set };
}
const heads = sc => sc.all().filter(n => n.cls === 'aad-lab aad-sec').map(n => [n.attrs['data-sec'], n.attrs['aria-expanded']]);
const texts = (sc, cls) => sc.all().filter(n => n.cls === cls).map(n => n.textContent);

test('AI apps sidebar with the switch on: no agent chips, every agent, Working / Ready / Recent / Snoozed / Archived, one sort', () => {
  const { c, asked, listens } = sidebar();
  c.paintAgents(); assert.equal(c.agentsRow.hidden, true, 'the agent chip strip is gone'); assert.equal(c.agentsRow.children.length, 0);
  c.readSessions(); c.paintList(true);
  assert.deepEqual(JSON.parse(JSON.stringify(asked.at(-1))), { activity: true, older: false }, 'every agent, never the focused list');
  assert.deepEqual(heads(c.scroll), [['working', 'false'], ['ready', 'true'], ['recent', 'true'], ['snoozed', 'false'], ['archive', 'false']]);
  assert.deepEqual(texts(c.scroll, 'aad-sec-w'), ['Working', 'Ready', 'Recent', 'Snoozed', 'Archived']);
  assert.deepEqual(texts(c.scroll, 'aad-rw'), ['h1:new·Host', 'g1:new', 'y1:needs', 'r1', 'r2'], 'Ready then Recent; another agent named after its channel');
  assert.deepEqual(texts(c.scroll, 'aad-more-older'), ['Show older · 1']);
  assert.equal(c.scroll.all().filter(n => /aad-groupb|aad-working-orderb/.test(n.cls)).length, 0, 'no grouping drop-down and no Working sort');
  const sort = c.scroll.all().find(n => n.cls === 'aad-sortb aad-act-orderb'); assert.ok(sort); assert.equal(sort.attrs['aria-label'], 'Sort: Newest first. Change');
  // Show older lists the rest of the live window.
  listens.find(([n]) => n.cls === 'aad-more-older')[2]();
  assert.deepEqual(JSON.parse(JSON.stringify(asked.at(-1))), { activity: true, older: true });
  assert.deepEqual(texts(c.scroll, 'aad-rw').slice(-3), ['r1', 'r2', 'old']);
});

test('AI apps sidebar: Needs you first puts amber first; with one agent or the switch off nothing changes', () => {
  let { c } = sidebar({ order: 'priority' }); c.readSessions(); c.paintList(true);
  assert.deepEqual(texts(c.scroll, 'aad-rw').slice(0, 3), ['y1:needs', 'h1:new·Host', 'g1:new']);
  assert.equal(c.scroll.all().find(n => n.cls === 'aad-sortb aad-act-orderb').attrs['aria-label'], 'Sort: Needs you first. Change');
  ({ c } = sidebar({ on: false })); c.paintAgents(); assert.equal(c.agentsRow.hidden, false, 'switch off: the chips stay');
  c.readSessions(); c.paintList(true);
  assert.deepEqual(heads(c.scroll).map(h => h[0]), ['working', 'snoozed', 'ready', 'archive'].filter(k => k !== 'snoozed'), 'switch off: today\'s sections');
  assert.ok(!texts(c.scroll, 'aad-sec-w').includes('Recent'));
});

test('skin-host: list({ activity: true }) reads the shell\'s activity list; unread alerts wait in Ready, read ones in Recent', () => {
  const c = { console, structuredClone }; c.window = c; modelContext(c);
  c.readReadyOrder = () => 'newest';
  c.noteRows = () => [{ id: 'notif:x', note: true, rank: 1, at: new Date(NOW).toISOString(), snoozed: false }, { id: 'notif:y', note: true, rank: 3, at: new Date(NOW - 9 * H).toISOString(), snoozed: true }];
  vm.runInContext(between(host, '  function activityRows(l) {', '  function withNoteRows('), c);
  const o = c.activityRows({ working: [], ready: [{ id: 'g', at: new Date(NOW - H).toISOString(), mark: 'new' }], recent: [{ id: 'r', at: new Date(NOW - 2 * H).toISOString(), mark: '' }], snoozed: [], archive: [], older: 0 });
  assert.deepEqual([...o.ready].map(r => [r.id, r.mark]), [['notif:x', 'needs'], ['g', 'new']]);
  assert.deepEqual([...o.recent].map(r => r.id), ['r', 'notif:y']);
  assert.match(host, /list: opts => \{ if \(opts\?\.activity === true && live\(\) && shell\.activityList\) return activityRows\(shell\.activityList\(\{ order: readReadyOrder\(\), older: opts\.older === true \}\)\);/);
});
