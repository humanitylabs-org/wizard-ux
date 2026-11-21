// wizard-ux issue 1504: the orb badge and Home's Ready card said 3 while Activity listed 6 ready (2 green, 4 amber).
// The badges counted unread threads only, so a needs-you thread the owner had already opened dropped out of them.
// With Channels on they now count Activity's own Ready (chats.js activityReady through workspace-navigation chatsCount).
// Real live.js grouping + visibleUnread, real chats.js rule lines, real list model, real chatsCount.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { modelContext } from './fixtures/chats-list-model.mjs';
import { withAppParts } from './fixtures/app-parts.mjs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withLiveParts } from './fixtures/live-parts.mjs'; // live.js parts moved out verbatim (issue 1665)
import { withDesktopParts } from './fixtures/desktop-parts.mjs';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const live = withLiveParts(read('web/live.js')), chats = withParts(read('web/core/chats.js')), nav = read('web/core/workspace-navigation.js');
const block = (text, a, b) => { const i = text.indexOf(a); assert.ok(i >= 0, a); const j = text.indexOf(b, i); assert.ok(j > i, b); return text.slice(i, j); };
const line = (text, token) => { const l = text.split('\n').find(x => x.includes(token)); assert.ok(l, token); return l; };
const NOW = Date.now(), H = 3600e3;
const iso = h => new Date(NOW - h * H).toISOString();
const row = (id, h, extra = {}) => ({ id, title: 'T ' + id, status: 'completed', updatedAt: iso(h), lastUserAt: iso(h + 1), previewAt: iso(h), ...extra });
const amber = (id, h) => row(id, h, { attention: { state: 'needs_you', ask: 'Pick one' } });

function harness(rows, { on = true, bellUnread = 0 } = {}) {
  const fresh = new Set(rows.filter(s => s.fresh).map(s => s.id)), handled = new Set();
  const c = modelContext({ Date, JSON, console, CHAN_SWITCH: 'wizard/chat-channels',
    document: { documentElement: { dataset: { tweaks: on ? 'wizard/chat-channels' : '' } } }, localStorage: { getItem: () => null },
    snoozeLast: () => false, seenKeyOf: s => s.id, assistantAt: s => s.previewAt, hasNew: s => fresh.has(s.id), WEEK: 7 * 864e5 });
  c.window = c; c.WizChatsListModel = c.WizChatsListModel; c.WizConfig = { dayStart: n => n - n % 864e5 }; c.WosSkinHost = { snoozeOrder: '' };
  c.WosBell = { unreadCount: () => bellUnread };
  vm.runInContext(block(live, '  const DAY = 864e5;', '  // Agent Service owns box-wide preferences.') + block(live, '  const sectionTime =', '  async function fetchDispositions()') + '\nthis.group = groupWork;', c);
  c.input = rows;
  vm.runInContext(`this.LIVE = { deferred: {}, ok: true, sessionsFor: () => input, unified: () => input, seenOf: () => ({}), cardAt: s => s.updatedAt,
    isNew: s => hasNew(s), handled: s => handledSet.has(s.id), workGroups(r) { return groupWork(r || input); },
    ${block(live, "    groups(agent = '') {", '    async refresh() {')} ${line(live, '    visibleUnread(rows)')} };`, Object.assign(c, { handledSet: handled }));
  c.WizCore = {};
  vm.runInContext(['const WORKING_ST =', 'const isWorking =', 'const channelsOn =', 'const markDoneOn =', 'const handledNow =', 'const deferredOf =', 'const attOf =',
    'const chanNeeds =', 'const chanUnread =', 'const actNeeds =', 'const actUnread =', 'const chanAt ='].map(t => line(chats, '  ' + t)).join('\n')
    + '\n' + block(chats, '  function activityReady(live) {', '  /* Activity with Channels on') + '\nthis.needs = actNeeds; this.unread = actUnread; this.chanAt = chanAt;', c);
  vm.runInContext(block(nav, '  function chatsCount(live) {', '  function refreshChats(') + '\nthis.badge = chatsCount; this.word = readyWord;', c);
  // What Activity's Ready section lists: the same model call activityBody makes (phone/Classic) and the AI apps sidebar's.
  const M = c.WizChatsListModel;
  const activity = () => M.activityGroups(c.LIVE.workGroups(rows), { needs: c.needs, unread: c.unread, at: c.chanAt }, { order: 'newest', now: NOW }).ready.map(s => s.id);
  const sidebar = () => M.activityList(c.LIVE.workGroups(rows), { live: { cardAt: s => s.updatedAt, isNew: c.unread }, chats: { activityNeeds: c.needs, activityUnread: c.unread, threadActions: () => [], channelOf: () => 'General', agentLabelOf: () => '' } }, { order: 'newest', now: NOW }).ready.length;
  return { c, activity, sidebar, open: id => fresh.delete(id), markDone: id => { handled.add(id); fresh.delete(id); } };
}

const robert = () => [row('g1', 1, { fresh: true }), row('g2', 2, { fresh: true }), amber('y1', 3), amber('y2', 4), amber('y3', 30), { ...amber('y4', 5), fresh: true },
  row('done', 6), row('run', 0, { status: 'running' }), row('arch', 7, { archived: true })];

test('issue 1504: with 2 green and 4 amber, the orb badge and Home count 6, the same as Activity Ready', () => {
  const { c, activity, sidebar } = harness(robert());
  assert.deepEqual([...activity()].sort(), ['g1', 'g2', 'y1', 'y2', 'y3', 'y4']);
  assert.equal(c.LIVE.visibleUnread(c.LIVE.unified()).length, 3, 'the old unread tally: the 3 the reporter saw');
  assert.equal(c.badge(c.LIVE), 6, 'orb badge / Home Ready card = Activity Ready');
  assert.equal(sidebar(), 6, 'the AI apps sidebar Ready lists the same 6');
  assert.equal(c.word(c.LIVE), 'ready', 'Home and the status bar call it ready, not unread (Codex P2)');
});

test('issue 1504: the badge follows Activity as threads are opened and marked done', () => {
  const h = harness(robert());
  h.open('g1'); h.open('y4');
  assert.equal(h.activity().length, 5, 'green g1 leaves Ready on open; amber y4 stays');
  assert.equal(h.c.badge(h.c.LIVE), 5);
  h.markDone('y1'); h.markDone('y2');
  assert.equal(h.activity().length, 3);
  assert.equal(h.c.badge(h.c.LIVE), 3);
});

test('issue 1504: notifications set to Chats still add their unread items on top', () => {
  const { c } = harness(robert(), { bellUnread: 2 });
  assert.equal(c.badge(c.LIVE), 8);
});

test('issue 1504: with Channels off (no Activity view) the badge keeps the unread tally', () => {
  const { c } = harness(robert(), { on: false });
  assert.equal(c.WizCore.activityReady(c.LIVE), null);
  assert.equal(c.badge(c.LIVE), c.LIVE.visibleUnread(c.LIVE.unified()).length);
  assert.equal(c.word(c.LIVE), 'unread');
});

test('issue 1504: the shells read the one count (orb badge, desk marks, phone Home card, desktop Home line)', () => {
  assert.match(withAppParts(read('web/app.js')), /const ready = window\.WizCore\.workspaceNav\.chatsCount\(LIVE\);/);
  assert.match(withAppParts(read('web/app.js')), /workspaceNav\.refreshChats\(LIVE, CHATS_APP\.id\)/);
  assert.match(withDesktopParts(read('web/desktop/desktop.js')), /C\.workspaceNav\.refreshChats\(LIVE, /);
  assert.match(chats, /window\.WizCore\.activityReady = activityReady;/);
});

// wizard-ux issue 1517: desktop Home said "0 need you" and its Needs you · Unread card listed only the 2 unread threads,
// while Activity's Ready showed 4 amber threads already opened. Home now takes Activity's own split (activityHome).
test('issue 1517: Home\'s need-you number and card follow Activity\'s amber rows, opened or not', () => {
  const h = harness(robert());
  h.open('y4');
  const A = h.c.WizCore.activityHome(h.c.LIVE);
  assert.deepEqual([...A.needs.map(s => s.id)].sort(), ['y1', 'y2', 'y3', 'y4'], 'every amber Activity row needs you, opened or not');
  assert.deepEqual([...A.ready.map(s => s.id)].sort(), ['g1', 'g2'], 'the green rest');
  assert.deepEqual([...A.needs, ...A.ready].map(s => s.id).sort(), [...h.activity()].sort(), 'the card lists exactly Activity Ready');
  assert.equal(h.c.LIVE.groups().needs.length, 0, 'the old Chats rule: the "0 need you" the reporter saw');
  h.markDone('y1');
  assert.equal(h.c.WizCore.activityHome(h.c.LIVE).needs.length, 3, 'Mark done takes it off Home too');
});

test('issue 1517: with Channels off Home keeps the Chats groups', () => {
  const { c } = harness(robert(), { on: false });
  assert.equal(c.WizCore.activityHome(c.LIVE), null);
});

test('issue 1517: desktop Home line, its card, the status bar and the phone Ready card read activityHome', () => {
  const desk = withDesktopParts(read('web/desktop/desktop.js')), app = withAppParts(read('web/app.js'));
  const home = block(desk, '  function homeHtml(i) {', '  stage.addEventListener(');
  assert.match(home, /C\.activityHome\?\.\(LIVE\)/);
  assert.match(home, /\$\{L\.needs\.length\} need/);
  assert.match(home, /rows\(L\.needs\.concat\(L\.ready\)\)/);
  assert.match(block(desk, '  function paintBar() {', '  function tickClock()'), /C\.activityHome\?\.\(LIVE\)/);
  assert.match(block(app, '  function renderHome() {', '  setInterval(() =>'), /WizCore\.activityHome\?\.\(LIVE\)/);
  assert.match(chats, /window\.WizCore\.activityHome = activityHome;/);
});
