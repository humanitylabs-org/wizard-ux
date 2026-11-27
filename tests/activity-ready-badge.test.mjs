// wizard-ux issue 1504: the orb badge and Home's Ready card said 3 while Activity listed 6 ready (2 green, 4 amber).
// The badges counted unread threads only, so a needs-you thread the owner had already opened dropped out of them.
// They now count Activity's own Ready (chats.js activityReady through workspace-navigation chatsCount).
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
import { runRecording } from './fixtures/source-slice.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const live = withLiveParts(read('web/live.js')), chats = withParts(read('web/core/chats.js')), nav = read('web/core/workspace-navigation.js');
const block = (text, a, b) => { const i = text.indexOf(a); assert.ok(i >= 0, a); const j = text.indexOf(b, i); assert.ok(j > i, b); return text.slice(i, j); };
const line = (text, token) => { const l = text.split('\n').find(x => x.includes(token)); assert.ok(l, token); return l; };
const NOW = Date.now(), H = 3600e3;
const iso = h => new Date(NOW - h * H).toISOString();
const row = (id, h, extra = {}) => ({ id, title: 'T ' + id, status: 'completed', updatedAt: iso(h), lastUserAt: iso(h + 1), previewAt: iso(h), ...extra });
const amber = (id, h) => row(id, h, { attention: { state: 'needs_you', ask: 'Pick one' } });

function harness(rows, { bellUnread = 0 } = {}) {
  const fresh = new Set(rows.filter(s => s.fresh).map(s => s.id)), handled = new Set();
  const c = modelContext({ Date, JSON, console, localStorage: { getItem: () => null },
    snoozeLast: () => false, seenKeyOf: s => s.id, assistantAt: s => s.previewAt, hasNew: s => fresh.has(s.id), WEEK: 7 * 864e5 });
  c.window = c; c.WizChatsListModel = c.WizChatsListModel; c.WizConfig = { dayStart: n => n - n % 864e5 }; c.WosSkinHost = { snoozeOrder: '' };
  c.WosBell = { unreadCount: () => bellUnread };
  vm.runInContext(block(live, '  const DAY = 864e5;', '  // Agent Service owns box-wide preferences.') + block(live, '  const sectionTime =', '  async function fetchDispositions()') + '\nthis.group = groupWork;', c);
  c.input = rows;
  vm.runInContext(`this.LIVE = { deferred: {}, ok: true, sessionsFor: () => input, unified: () => input, seenOf: () => ({}), cardAt: s => s.updatedAt,
    isNew: s => hasNew(s), handled: s => handledSet.has(s.id), workGroups(r) { return groupWork(r || input); },
    ${block(live, "    groups(agent = '') {", '    async refresh() {')} ${line(live, '    visibleUnread(rows)')} };`, Object.assign(c, { handledSet: handled }));
  // Inbox rows (wizard-ux issue 1779, on for everyone): the shell's inbox facts; nothing here is quiet or pinned.
  const IB = { quiet: () => false, pin: () => 0 };
  c.WizCore = { inboxRowsFacts: () => IB };
  vm.runInContext(['const WORKING_ST =', 'const isWorking =', 'const handledNow =', 'const deferredOf =', 'const attOf =',
    'const chanNeeds =', 'const chanUnread =', 'const actNeeds =', 'const actUnread =', 'const chanAt ='].map(t => line(chats, '  ' + t)).join('\n')
    + '\n' + block(chats, '  function activityReady(live) {', '  /* Activity with Channels on') + '\nthis.needs = actNeeds; this.unread = actUnread; this.chanAt = chanAt;', c);
  vm.runInContext(block(nav, '  function chatsCount(live) {', '  function refreshChats(') + '\nthis.badge = chatsCount; this.word = readyWord;', c);
  // What the Inbox lists: the same model call the Inbox rows make (phone/Classic) and the AI apps sidebar's.
  const M = c.WizChatsListModel;
  const activity = () => M.activityGroups(c.LIVE.workGroups(rows), { needs: c.needs, unread: c.unread, at: c.chanAt }, { order: 'newest', now: NOW, keep: true, inbox: IB }).ready.map(s => s.id);
  const sidebar = () => M.activityList(c.LIVE.workGroups(rows), { live: { cardAt: s => s.updatedAt, isNew: c.unread }, chats: { activityNeeds: c.needs, activityUnread: c.unread, threadActions: () => [], channelOf: () => 'General', agentLabelOf: () => '', inboxRows: () => IB } }, { order: 'newest', now: NOW, keep: true }).ready.length;
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

// The shells' own Home, orb and bar code over this harness: WizCore is what chats.js exported, workspace-navigation's count.
function shellCtx(h, extra = {}) {
  const C = { ...h.c.WizCore, workspaceNav: { chatsCount: h.c.badge, readyWord: h.c.word, refreshChats: (...a) => refreshed.push(a), slot: i => i + 1 } }, refreshed = [];
  return { refreshed, scope: { LIVE: h.c.LIVE, C, window: { WizCore: C, WizConfig: { hm: () => '9:00', dayParts: () => ({ dow: 1, d: 2, m: 3 }), dateLabel: () => 'Monday' } },
    DOWL: ['Sun', 'Mon'], MON: ['Jan', 'Feb', 'Mar'], esc: String, emoOf: () => '', ago: () => '1h', OUTBOX: null, APPS: [], APP: { wizard: { id: 'wizard' } }, CHATS_APP: { id: 'chats' },
    unsentCard: () => '', sideCard: () => '', live: () => h.c.LIVE.groups(), ico: () => '', MOD: '⌥', ...extra } };
}
const appSrc = withAppParts(read('web/app.js')), deskSrc = withDesktopParts(read('web/desktop/desktop.js'));
test('issue 1504: the shells read the one count (orb badge, desk marks, phone Home card, desktop Home line)', () => {
  const h = harness(robert());
  const phone = shellCtx(h), ph = runRecording(block(appSrc, '  function renderHome() {', '  setInterval(() =>') + '\nglobalThis.home = renderHome;', phone.scope);
  const card = createDocument(); card.body.innerHTML = ph.home();
  assert.equal(card.querySelector('[data-act="ready"]').getAttribute('aria-label'), 'Ready, 6 ready', 'phone Home Ready card = Activity Ready');
  const moons = runRecording(block(appSrc, '  function renderMoons() {', '  function paintOrbBadge()') + '\nglobalThis.moons = renderMoons;', { ...phone.scope, $: () => ({ offsetWidth: 44 }), paintOrbBadge: () => {} });
  moons.moons();
  assert.deepEqual(phone.refreshed.map(([l, id]) => [l === h.c.LIVE, id]), [[true, 'chats']], 'the orb badge and desk marks repaint from the same LIVE');
  const desk = shellCtx(h), d = runRecording(block(deskSrc, '  function homeHtml(i) {', '  stage.addEventListener(') + '\nglobalThis.home = homeHtml;', desk.scope);
  const line = createDocument(); line.body.innerHTML = d.home(0);
  assert.match(line.querySelector('.home-line').textContent, /, 6 ready, /, 'desktop Home line = Activity Ready');
  const bar = runRecording(block(deskSrc, '  function paintBar() {', '  function tickClock()') + '\nglobalThis.bar = paintBar;', { ...desk.scope, homeOpen: false, $: () => ({ setAttribute() {} }) });
  try { bar.bar(); } catch (_) { /* the rest of the bar needs the shell's DOM */ }
  assert.deepEqual(desk.refreshed.map(([l, id]) => [l === h.c.LIVE, id]), [[true, 'wizard']], 'the desktop bar repaints the badges from LIVE');
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

test('issue 1517: desktop Home line, its card, the status bar and the phone Ready card read activityHome', () => {
  const h = harness(robert());
  h.open('y4');   // an amber thread already opened still needs you
  const d = runRecording(block(deskSrc, '  function homeHtml(i) {', '  stage.addEventListener(') + '\nglobalThis.home = homeHtml;', shellCtx(h).scope);
  const doc = createDocument(); doc.body.innerHTML = d.home(0);
  assert.match(doc.querySelector('.home-line b').textContent, /^4 need you$/, 'the amber Activity rows, opened or not');
  assert.deepEqual(doc.querySelector('.home-card').querySelectorAll('[data-thread]').map(b => b.dataset.thread).sort(), ['g1', 'g2', 'y1', 'y2', 'y3', 'y4'], 'Needs you · Unread = Activity Ready');
  const ph = runRecording(block(appSrc, '  function renderHome() {', '  setInterval(() =>') + '\nglobalThis.home = renderHome;', shellCtx(h).scope);
  const card = createDocument(); card.body.innerHTML = ph.home();
  assert.match(card.querySelector('[data-act="ready"]').getAttribute('style'), /--c:var\(--amber\)/, 'phone Ready card is amber while Activity has needs');
  for (const id of ['y1', 'y2', 'y3', 'y4']) h.markDone(id);
  card.body.innerHTML = ph.home();
  assert.match(card.querySelector('[data-act="ready"]').getAttribute('style'), /--c:var\(--green\)/, 'and green once they are done');
  const bar = shellCtx(h), b = runRecording(block(deskSrc, '  function paintBar() {', '  function tickClock()') + '\nglobalThis.bar = paintBar;', { ...bar.scope, homeOpen: false, $: () => ({ setAttribute() {} }) });
  let used = 0; const real = bar.scope.C.activityHome; bar.scope.C.activityHome = l => { used++; return real(l); };
  try { b.bar(); } catch (_) { /* the rest of the bar needs the shell's DOM */ }
  assert.equal(used, 1, 'the status bar asks activityHome');
});
