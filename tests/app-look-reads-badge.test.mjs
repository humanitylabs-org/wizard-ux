// Issue 1701: opening an app never cleared the Notifications items counted on its badge. Messenger showed 9 for days
// while its Inbox said "No unread chats": agent notes tagged `app:messenger` routed to Badge, which nothing inside
// Messenger shows or clears. Now a look at the app (its window in view and in front) reads those items through
// POST /notifications/api/mark, so the badge never outlives a look. Needs-you items follow Notifications' own route
// and are never touched; items of other apps, or of an app set to Chats, stay as they are.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { core, settle } from './fixtures/notification-levels.mjs';
import { withServicesParts } from './fixtures/app-services-parts.mjs';

const NOTES = [
  { id: 'm1', time: 40, title: 'Apartment agent replied', message: 'Viewing at 5', priority: 3, tags: ['app:messenger'] },
  { id: 'm2', time: 39, title: 'Draft keeper error', message: 'retry', priority: 2, tags: ['app:messenger'] },
  { id: 'm3', time: 38, title: 'Needs your OK', message: 'Pay deposit?', priority: 4, tags: ['app:messenger', 'needs-you'] },
  { id: 'h1', time: 37, title: 'Aree replied', message: 'Is it available?', priority: 3, tags: ['app:second-hand'] },
  { id: 's1', time: 36, title: 'Sniper scan', message: 'All clear', priority: 2, tags: ['app:sniper'] },
];
const INSTALLED = ['notifications', 'messenger', 'second-hand', 'sniper'];

function boot({ routes: saved = { messenger: 'badge', 'second-hand': 'badge', sniper: 'chats' }, watch = true } = {}) {
  let routes = { ...saved };
  const read = new Set(), storage = new Map([['wos.notify.route.v1', JSON.stringify(saved)]]), calls = [];  // this device's copy of the box's choices
  const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body });
  const fetch = async (url, opts = {}) => {
    calls.push([opts.method || 'GET', url, opts.body]);
    if (url.startsWith('/notifications/api/count')) return json({ unread: NOTES.filter(i => !read.has(i.id)).length, needs: 1 });
    if (url.startsWith('/notifications/api/items')) return json({ items: NOTES.map(i => ({ ...i, read: read.has(i.id) })) });
    if (url.startsWith('/notifications/api/mark') && opts.method === 'POST') { const b = JSON.parse(opts.body); if (b.read) for (const id of b.ids) read.add(id); return json({ ok: true }); }
    if (url.startsWith('/notifications/api/routes')) return json({ routes, saved: true });
    if (url.startsWith('/notifications/api/marks')) return json({ marks: {} });
    return json({ error: 'not found' }, 404);
  };
  const w = core({
    WosSkinHost: { inboxList: true }, CSS: { escape: s => s },
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)) },
    WizCanOpen: id => INSTALLED.includes(id),
    WizCore: { apps: () => ({ APPS: [] }), backendApps: () => INSTALLED.map(id => ({ id, url: `/${id}/`, name: id })), appMetadata: () => null },
    document: { querySelectorAll: () => [], addEventListener() {}, hidden: false },
    location: { origin: 'https://wizard.test' },
    addEventListener() {}, dispatchEvent: () => true, CustomEvent: class { constructor(type, o = {}) { this.type = type; this.detail = o.detail; } },
    setTimeout: () => 0, setInterval: () => 0, fetch, calls,
  });
  return { w, calls, read, marks: () => calls.filter(([m, u]) => m === 'POST' && u === '/notifications/api/mark').map(c => JSON.parse(c[2])), watch };
}
async function ready(h) { const B = h.w.WosBell; if (h.watch) B.watch(() => {}); await B.refresh(true); await settle(); await B.refresh(true); await settle(); return B; }

test('looking at an app reads the Notifications items on its badge, and the badge goes', async () => {
  const h = boot(), B = await ready(h), N = h.w.WizCore.workspaceNav;
  assert.equal(N.counts.messenger, 2, 'before: two agent notes on Messenger\'s badge (needs-you is not one of them)');
  assert.equal(N.counts['second-hand'], 1);
  assert.equal(B.looked('messenger'), 2);
  assert.equal(N.counts.messenger || 0, 0, 'the badge goes at once');
  assert.deepEqual(h.marks(), [{ ids: ['m1', 'm2'], read: true }], 'read through POST /notifications/api/mark');
  await settle(); await settle();
  assert.equal(N.counts.messenger || 0, 0, 'and stays gone after the reload');
  assert.equal(h.read.has('m3'), false, 'the needs-you item is never touched');
  assert.equal(N.counts['second-hand'], 1, 'another app\'s badge stays');
  assert.equal(B.looked('messenger'), 0, 'a second look has nothing left to read');
  assert.equal(h.marks().length, 1);
});

test('an app set to Chats, Notifications itself and unknown ids are left alone', async () => {
  const h = boot(), B = await ready(h);
  assert.equal(B.looked('sniper'), 0, 'Sniper is in Chats: its item waits there, not on a badge');
  assert.equal(B.looked('notifications'), 0);
  assert.equal(B.looked('nope'), 0);
  assert.equal(B.looked(''), 0);
  assert.deepEqual(h.marks(), []);
});

test('a look before Notifications\' list has loaded is settled on the first read', async () => {
  const h = boot({ watch: false }), B = h.w.WosBell;
  assert.equal(B.looked('messenger'), 0, 'nothing read yet');
  await B.refresh(true); await settle(); await settle();
  assert.deepEqual(h.marks()[0], { ids: ['m1', 'm2'], read: true });
  assert.equal(h.w.WizCore.workspaceNav.counts.messenger || 0, 0);
});

function services() {
  const src = withServicesParts(readFileSync(new URL('../web/core/app-services.js', import.meta.url), 'utf8'));
  const looks = [], view = { seen: false, front: false }, doc = { hidden: false, readyState: 'loading', listeners: {}, addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); } };
  const location = new URL('https://wizard.example/wizard-os-home/');
  const child = { location: new URL('/messenger/', location), document: {}, addEventListener() {}, postMessage() {} };
  const frame = { tagName: 'IFRAME', src: child.location.href, isConnected: true, contentWindow: child, hasAttribute: () => false, addEventListener() {}, removeEventListener() {} };
  const app = { id: 'messenger', kind: 'wizard', url: '/messenger/', name: 'Messenger' };
  const window = { WizCore: { apps: () => ({ APPS: [app] }), workspaceNav: { setCount() {} } }, WosBell: { looked: id => { looks.push(id); return 0; } }, dispatchEvent() {} };
  vm.runInNewContext(src, { window, location, URL, addEventListener() {}, setInterval() {}, setTimeout, clearTimeout, document: doc, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } }, navigator: {} });
  const S = window.WizAppServices;
  S.attach(frame, { appId: 'messenger', path: app.url, isVisible: () => view.seen, isFront: () => view.front });
  return { S, view, doc, looks };
}

test('the shell counts a look when an app window comes into view in front, once per look', () => {
  const h = services(), look = () => h.S.fresh.look();
  look(); assert.deepEqual(h.looks, [], 'closed: no look');
  h.view.seen = true; look(); assert.deepEqual(h.looks, [], 'in view behind another window: no look');
  h.view.front = true; look(); look(); look(); assert.deepEqual(h.looks, ['messenger'], 'in front: one look, not one per tick');
  h.view.front = false; look(); h.view.front = true; look(); assert.deepEqual(h.looks, ['messenger', 'messenger'], 'back to the front: a new look');
  h.doc.hidden = true; look(); assert.equal(h.looks.length, 2, 'the page hidden: no look');
  h.doc.hidden = false; look(); assert.equal(h.looks.length, 3, 'Wizard back with the app in front: a new look');
});

test('a page hidden with no tick (timers suspended) still ends the look, and coming back counts at once', () => {
  const h = services(), vis = () => { for (const fn of h.doc.listeners.visibilitychange || []) fn(); };
  h.view.seen = h.view.front = true; h.S.fresh.look(); assert.equal(h.looks.length, 1);
  h.doc.hidden = true; vis();
  h.doc.hidden = false; vis(); assert.equal(h.looks.length, 2, 'back to Wizard: a new look with no timer tick in between');
});
