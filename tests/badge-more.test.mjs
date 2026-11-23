// An app that lists only its newest items (Mail: newest 50 unread) shows "50+", not a number that looks exact
// (Miguel, 1 Nov 2026). Its own badge and, when routed to Chats, the Chats badge both say so.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withAppParts } from './fixtures/app-parts.mjs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { withServicesParts } from './fixtures/app-services-parts.mjs';
import { appClient } from './fixtures/app-client-harness.mjs';
import { block, runRecording } from './fixtures/source-slice.mjs';
const read = p => withAppParts(withShellParts(readFileSync(new URL('../' + p, import.meta.url), 'utf8')));

function nav() {
  const events = [], window = { WizCore: {}, dispatchEvent: e => events.push(e), CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } } };
  vm.runInNewContext(read('web/core/workspace-navigation.js'), { window, CustomEvent: window.CustomEvent });
  return { N: window.WizCore.workspaceNav, events };
}

test('fmt adds a plus for a capped count and keeps 99+ above 99', () => {
  const { N } = nav();
  assert.equal(N.fmt(50, true), '50+'); assert.equal(N.fmt(50), '50'); assert.equal(N.fmt(150, true), '99+');
});

test('an app reporting more shows N+ on its desk mark; turning it off repaints', () => {
  const { N, events } = nav();
  const desk = { wins: ['w1'] }, wins = { w1: { app: 'frame' } }, appOf = () => ({ id: 'wizard-mail' });
  N.setCount('wizard-mail', 50, true);
  assert.equal(N.deskMore(desk, wins, appOf), true);
  const n = events.length; N.setCount('wizard-mail', 50, false);
  assert.ok(events.length > n, 'losing the plus repaints even when the number is the same');
  assert.equal(N.deskMore(desk, wins, appOf), false);
});

const cut = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };

test('apps pass { more } through the badge API; Chats reads it from routed feeds', async () => {
  // The app SDK (core/app-client.js) forwards more, same-origin and by message.
  const seen = [], same = appClient({ service: { badge: { set: (n, o) => (seen.push([n, { ...o }]), true) } } });
  same.api.badge.set(50, { more: true }); same.api.badge.set(3); same.api.badge.set(4, { more: 'yes' });
  assert.deepEqual(seen, [[50, { more: true }], [3, { more: false }], [4, { more: false }]]);
  const framed = appClient(); await framed.hello();
  framed.api.badge.set(50, { more: true });
  assert.deepEqual({ ...framed.requests('badge.set')[0].args }, { n: 50, more: true });
  // The shell (core/app-services.js) hands it to the desk mark, by message and on the same-origin service.
  const counts = [], listeners = [], location = new URL('https://wizard.example/wizard-os-home/');
  const child = { location: new URL('/wizard-mail/', location), document: {}, addEventListener() {}, postMessage() {} };
  const frame = { tagName: 'IFRAME', src: child.location.href, isConnected: true, contentWindow: child, hasAttribute: () => false, addEventListener() {}, removeEventListener() {} };
  const window = { WizCore: { apps: () => ({ APPS: [{ id: 'wizard-mail', kind: 'wizard', url: '/wizard-mail/' }] }), workspaceNav: { setCount: (...x) => counts.push(x) } }, dispatchEvent() {} };
  vm.runInNewContext(withServicesParts(read('web/core/app-services.js')), { window, location, URL, addEventListener: (t, fn) => t === 'message' && listeners.push(fn), setInterval() {}, setTimeout, clearTimeout,
    document: { hidden: false, readyState: 'loading', addEventListener() {} }, CustomEvent: class {}, navigator: {} });
  window.WizAppServices.attach(frame, { appId: 'wizard-mail', path: '/wizard-mail/', isVisible: () => true });
  for (const fn of listeners) await fn({ origin: location.origin, source: child, data: { type: 'wizard:app:request', version: 1, id: 'b1', op: 'badge.set', args: { n: 50, more: true } } });
  for (const fn of listeners) await fn({ origin: location.origin, source: child, data: { type: 'wizard:app:request', version: 1, id: 'b2', op: 'badge.set', args: { n: 50, more: 'true' } } });
  window.WizAppServices.connect(child, {}).badge.set(7, { more: true });
  assert.deepEqual(counts.map(c => [...c]), [['wizard-mail', 50, true], ['wizard-mail', 50, false], ['wizard-mail', 7, true]]);
  // Chats (core/notif-bell.js) reads more from a routed app's feed: its own flag, or more than 50 items.
  const bell = read('web/core/notif-bell.js');
  const feeds = { a: { inbox: 1, items: [], more: true }, b: { inbox: 1, items: Array(51).fill({}) }, c: { inbox: 1, items: [{}] } };
  const b = vm.runInNewContext(cut(bell, '  const FD = {', '\n') + cut(bell, '  async function getFeed(id) {', '  function fromFeed(') + cut(bell, '  const readyMore = ', '\n') + '\n({ getFeed, readyMore, FD })', {
    window: { WosSkinHost: { inboxList: true } }, inChats: id => id !== 'b', timed: x => x,
    fetch: async url => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => feeds[url.split('/')[1]] }) });
  for (const id of ['a', 'b', 'c']) await b.getFeed(id);
  assert.deepEqual({ ...b.FD.more }, { a: true, b: true, c: false });
  assert.equal(b.readyMore(), true, 'a capped feed routed to Chats');
  feeds.a.more = false; await b.getFeed('a');
  assert.equal(b.readyMore(), false, 'only b is capped, and it is not routed to Chats');
  // The Chats pill (core/workspace-navigation.js refreshChats) shows the plus only when routed items are unread.
  let unread = 2, more = true;
  const ctx = { WosBell: { unreadCount: () => unread, readyMore: () => more } };
  const W = vm.runInNewContext(read('web/core/workspace-navigation.js') + '\nwindow.WizCore.workspaceNav', { window: Object.assign({ WizCore: {}, dispatchEvent: () => true, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } } }, ctx), CustomEvent: class {} });
  const live = { ok: true, unified: () => [], visibleUnread: () => [1, 2, 3] };
  W.refreshChats(live);
  assert.equal(W.label('wizard'), '5+', 'three unread threads and two routed items, from a capped feed');
  assert.equal(W.deskMore({ wins: ['c'] }, { c: { app: 'chats' } }, () => ({ id: 'wizard' })), true, 'unread routed items from a capped feed: N+');
  unread = 0; W.refreshChats(live);
  assert.equal(W.label('wizard'), '3');
  assert.equal(W.deskMore({ wins: ['c'] }, { c: { app: 'chats' } }, () => ({ id: 'wizard' })), false, 'no unread routed items: an exact count');
  // Both shells feed that pill from their live Chats list: run the real phone renderMoons and desktop paintBar.
  const LIVE = { ok: true, groups: () => ({ needs: [], ready: [], working: [] }), session: () => null };
  const fed = [];
  const workspaceNav = new Proxy({ refreshChats: (l, id) => fed.push([l, id]), slot: i => i + 1 }, { get: (t, k) => t[k] || (() => '') });
  const el = () => ({ innerHTML: '', offsetWidth: 44, setAttribute() {}, classList: { contains: () => false } });
  runRecording(`(${block(read('web/app.js'), '  function renderMoons() {')})()`, {
    LIVE, CHATS_APP: { id: 'chats' }, live: () => ({ needs: [], working: [], ready: [] }), $: el, Math,
    window: { WizCore: { workspaceNav } } });
  runRecording(`(${block(read('web/desktop/desktop.js'), '  function paintBar() {')})()`, {
    LIVE, APP: { wizard: { id: 'wizard' } }, C: { workspaceNav, activityHome: () => ({}) }, $: el, window: {}, MOD: '⌘',
    homeOpen: true, ws: [{ wins: [] }], cur: 0, W: {} });
  assert.deepEqual(fed.map(([l, id]) => [l === LIVE, id]), [[true, 'chats'], [true, 'wizard']]);
});
