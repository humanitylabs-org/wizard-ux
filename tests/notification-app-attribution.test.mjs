import { runWithChatsModel } from './fixtures/chats-list-model.mjs';
// Notifications about an app are that app's (Miguel, 4 Nov 2026: the agent's "Oscar" group held Sniper scans, backup
// checks and Marketplace sales). A sender tags an item `app:<id>` (the Notifications cron relay's CRON_JOB_APPS, the
// notify tool's `app`); core lists it under that app (name, mark, fold) and routes it by that app's own choice: in
// Chats when the app is set to Chats, on the app's badge when set to Badge, nowhere when Off. Needs-you items keep
// following Notifications' choice. An app that is not installed leaves the item the agent's own.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { core, settle, read } from './fixtures/notification-levels.mjs';

const NOTES = [
  { id: 's1', time: 40, title: 'Sniper daily scan', message: 'All clear', priority: 2, tags: ['cron', 'clock', 'app:sniper'] },
  { id: 'b1', time: 39, title: 'Oscar R2 backup verified status', message: 'OK', priority: 2, tags: ['cron', 'clock', 'app:backup'] },
  { id: 'c1', time: 38, title: 'Monthly Amex-Chase MLA review', message: 'Review', priority: 2, tags: ['cron', 'clock', 'app:card-benefits'] },
  { id: 'h1', time: 37, title: 'Aree replied', message: 'Is it available?', priority: 3, tags: ['app:second-hand'] },
  { id: 'f1', time: 36, title: 'Failed: Oscar R2 backup verified status', message: 'disk full', priority: 4, tags: ['cron', 'warning', 'app:backup'] },
  { id: 'o1', time: 35, title: 'Hermes release safety review', message: 'Nothing new', priority: 2, tags: ['cron', 'clock'] },
];
const INSTALLED = ['notifications', 'sniper', 'backup', 'card-benefits'];   // second-hand not installed (yet)
const ROUTES = { notifications: 'chats', sniper: 'chats', 'card-benefits': 'badge' };

function boot({ routes: saved = ROUTES, installed = INSTALLED } = {}) {
  let routes = { ...saved };
  const storage = new Map(), listeners = {}, calls = [];
  const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body });
  const fetch = async (url, opts = {}) => {
    calls.push([opts.method || 'GET', url]);
    if (url.startsWith('/notifications/api/count')) return json({ unread: NOTES.length, needs: 1 });
    if (url.startsWith('/notifications/api/items')) return json({ items: NOTES.map(i => ({ ...i, read: false })) });
    if (url.startsWith('/notifications/api/routes')) {
      if (opts.method === 'POST') { const b = JSON.parse(opts.body); routes = { ...routes, ...(b.routes || b) }; }
      return json({ routes, saved: true });
    }
    if (url.startsWith('/notifications/api/marks')) return json({ marks: {} });
    return json({ error: 'not found' }, 404);   // no app has a feed of its own here
  };
  return core({
    WosSkinHost: { inboxList: true }, CSS: { escape: s => s },
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)) },
    WizCanOpen: id => installed.includes(id),
    WizCore: { apps: () => ({ APPS: [] }), backendApps: () => installed.map(id => ({ id, url: `/${id}/`, name: id })),
      appMetadata: id => ({ sniper: { name: 'Sniper' }, backup: { name: 'Backup' }, 'card-benefits': { name: 'Card Benefits' }, notifications: { name: 'Notifications' } })[id] },
    document: { querySelectorAll: () => [], addEventListener() {}, hidden: false },
    location: { origin: 'https://wizard.test' },
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    dispatchEvent: () => true, CustomEvent: class { constructor(type, o = {}) { this.type = type; this.detail = o.detail; } },
    setTimeout: () => 0, setInterval: () => 0, fetch, calls,
  });
}
async function ready(w) { const B = w.WosBell; B.watch(() => {}); await B.refresh(true); await settle(); await B.refresh(true); await settle(); return B; }
const byId = B => Object.fromEntries([...B.items()].map(i => [i.id, i]));

test('tagged items carry their installed app; untagged and not-installed stay the agent\'s own', async () => {
  const B = await ready(boot()), got = byId(B);
  assert.equal(got.s1.from, 'sniper'); assert.equal(got.s1.fromName, 'Sniper');
  assert.equal(got.b1.from, 'backup');
  assert.equal(got.o1.from, undefined, 'an unlisted job is the agent\'s');
  assert.equal(got.h1.from, undefined, 'Second Hand not installed: falls back to the agent');
  assert.equal(got.s1.app, undefined, 'never an app-feed item: marks stay Notifications marks');
});

test('each tagged item follows its app\'s own route; needs-you follows Notifications\'', async () => {
  const B = await ready(boot()), got = byId(B);
  assert.equal(B.routeIdOf(got.s1), 'sniper');
  assert.equal(B.routeIdOf(got.f1), 'notifications', 'a failure that needs him is never silenced by an app\'s Badge or Off');
  assert.ok(got.s1 && got.b1, 'Sniper (Chats) and Backup (no saved choice = Chats) wait in Chats without a feed of their own');
  assert.equal(got.c1, undefined, 'Card Benefits is Badge: its item leaves Chats');
  assert.equal(B.itemInChats({ ...NOTES[2], from: 'card-benefits' }), false);
  assert.ok(got.f1 && got.o1 && got.h1, 'needs-you, the agent\'s own and not-installed stay in Chats as Notifications');
});

test('carried-only installed apps remain configurable after Off, even without a feed', async () => {
  const B = await ready(boot());
  assert.ok(B.routes().some(r => r.id === 'sniper'));
  B.setRoute('sniper', 'off'); await settle();
  assert.equal(B.item('s1'), null);
  assert.equal(B.routes().find(r => r.id === 'sniper').route, 'off');
  B.setRoute('sniper', 'chats'); await settle(); assert.ok(B.item('s1'));
});

test('Badge apps count their carried items on their own badge, not on Notifications\'', async () => {
  const w = boot(), B = await ready(w), N = w.WizCore.workspaceNav;
  assert.equal(N.counts['card-benefits'], 1, 'the MLA review is a badge on Card Benefits');
  assert.equal(N.counts.sniper || 0, 0, 'Sniper is in Chats: no badge of its own');
  B.setRoute('sniper', 'badge'); await settle();
  assert.equal(byId(B).s1, undefined, 'Sniper to Badge: out of Chats');
  assert.equal(N.counts.sniper, 1, '… and onto Sniper\'s badge');
  B.setRoute('sniper', 'off'); await settle();
  assert.equal(N.counts.sniper || 0, 0, 'Off: no badge at all');
  B.setRoute('notifications', 'badge'); await settle();
  assert.equal(N.counts.notifications, 3, 'Notifications\' badge counts only its own (6 − Sniper − Card Benefits − Backup)');
});

test('the app\'s own reported badge and the carried count add up', async () => {
  const w = boot(), N = w.WizCore.workspaceNav;
  N.setCount('card-benefits', 2); await ready(w);
  assert.equal(N.counts['card-benefits'], 3);
  N.carry({}); assert.equal(N.counts['card-benefits'], 2, 'carried items gone: the app\'s own count stays');
});

test('chats.js lists them under the app: its name, its mark, one fold per app', () => {
  const src = read('web/core/chats.js');
  const between = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };
  const ctx = { window: { WizConfig: { agent: () => 'Oscar' }, WosBell: { items: () => [], icon: '<svg class="bell"></svg>' }, WizSigil: { html: m => `<i data-sigil="${m.name}"></i>` }, WizCore: { appMetadata: () => null } },
    esc: s => String(s), clip: (s, n) => String(s).slice(0, n), ago: () => '2m' };
  vm.createContext(ctx);
  vm.runInContext(`const noteAt = it => (Number(it.time) || 0) * 1000;
    ${between('  const noteSrc = it =>', '  const noteAt = ')}
    ${between('  function noteIcon(it)', '  const noteTitle')}
    this.api = { fold, noteSrc, noteSrcName, noteIcon };`, ctx);
  const { fold, noteSrcName, noteIcon } = ctx.api;
  const s = (id, t) => ({ id, time: t, priority: 2, title: id, message: '', from: 'sniper', fromName: 'Sniper' });
  const o = (id, t) => ({ id, time: t, priority: 2, title: id, message: '' });
  const rows = fold([s('s1', 3), s('s2', 2), o('o1', 1), o('o2', 0)]);
  assert.equal(JSON.stringify(rows.map(r => r.group).sort()), '["notifications","sniper"]');
  assert.equal(noteSrcName(s('x', 1)), 'Sniper');
  assert.equal(noteSrcName(o('x', 1)), 'Oscar');
  assert.match(noteIcon(s('x', 1)), /data-sigil="Sniper"/);
});

test('sidebar / AI apps rows (skin-host noteRows) fold and name them under the app too', () => {
  const host = read('web/core/skin-host.js');
  const src = host.match(/  const NOTE_ID = [\s\S]*?\n  function inboxAct\(action, id\) \{[^\n]*\n/)[0];
  const items = [{ id: 's1', title: 'Sniper daily scan', time: 30, from: 'sniper', fromName: 'Sniper', priority: 2 }, { id: 's2', title: 'Daily Sniper outcome', time: 20, from: 'sniper', fromName: 'Sniper', priority: 2 },
    { id: 'o1', title: 'Release review', time: 10, priority: 2 }, { id: 'o2', title: 'Whiteboard', time: 5, priority: 2 }];
  const ctx = { isDoc: true, window: { WizConfig: { agent: () => 'Oscar' }, WosBell: { items: () => items } }, inboxThreads: new Map([['p', { list: true, act() {} }]]) };
  runWithChatsModel(src + ';globalThis.noteRows = noteRows;', ctx);
  const rows = JSON.parse(JSON.stringify(ctx.noteRows()));
  assert.deepEqual(rows.map(r => r.title), ['Sniper (2) · Sniper daily scan · Daily Sniper outcome', 'Oscar (2) · Release review · Whiteboard']);
  assert.equal(rows[0].app, 'sniper');
});


test('host note groups retain max-member Check rank; Needs you never folds and state/rank agree', () => {
  const host = read('web/core/skin-host.js');
  const src = host.match(/  const NOTE_ID = [\s\S]*?\n  function inboxAct\(action, id\) \{[^\n]*\n/)[0];
  const items = [{ id: 'new', title: 'New low', time: 30, priority: 1 }, { id: 'check', title: 'Older check', time: 20, priority: 3 }, { id: 'urgent', title: 'Urgent older', time: 10, priority: 5 }];
  const ctx = { isDoc: true, window: { WizConfig: { agent: () => 'Wizard' }, WosBell: { items: () => items } }, inboxThreads: new Map([['p', { list: true, act() {} }]]) };
  runWithChatsModel(src + ';globalThis.noteRows = noteRows;', ctx);
  const rows = ctx.noteRows(), M = ctx.window.WizChatsListModel;
  assert.equal(rows.length, 2, 'priority4+ is excluded from folding before projection');
  const folded = rows.find(r => r.count === 2), urgent = rows.find(r => r.needs);
  assert.equal(folded.rank, 2); assert.equal(M.stateOf(folded), 'fyi');
  assert.equal(urgent.id, 'notif:urgent'); assert.equal(urgent.count, 1);
  for (const row of rows) assert.equal(M.stateOf(row) === 'needs', M.rankOf(row) <= 1);
});
