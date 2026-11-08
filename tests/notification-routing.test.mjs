// Settings › Notifications: each app's notifications go to ONE place, a badge on its icon or Chats (Miguel, 1 Nov
// 2026: "things should either send notifications as badges or into the unified inbox, but not both"). Chats itself is
// the inbox: its badge counts what waits there, routed app items included.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

function boot({ storage = new Map(), inboxList = true, notifications = true } = {}) {
  const calls = [], listeners = {};
  const json = (body, status = 200, type = 'application/json') => ({ ok: status < 400, status, headers: { get: () => type }, json: async () => body });
  const fetch = async (url, opts = {}) => {
    calls.push([opts.method || 'GET', url]);
    if (url.startsWith('/notifications/api/count')) return json({ unread: 3, needs: 0 });
    if (url.startsWith('/notifications/api/items')) return json({ items: [{ id: 'n1', time: 10, title: 'Backup failed', message: 'Disk full' }] });
    if (url.startsWith('/notifications/api/marks')) return json({ marks: {} });
    if (url === '/messenger/api/inbox') return json({ inbox: 1, items: [{ key: 'chat:1', title: 'Ana', text: '2 new', time: 20 }] });
    if (url === '/files/api/inbox') return json('<html>', 200, 'text/html');
    return json({ error: 'not found' }, 404);
  };
  const ctx = {
    WosSkinHost: { inboxList }, CSS: { escape: s => s },
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)) },
    WizCanOpen: id => id === 'messenger' || (notifications && id === 'notifications'),
    WizCore: {
      apps: () => ({ APPS: [
        { id: 'messenger', kind: 'wizard', source: 'apps.json', url: '/messenger/', name: 'Messenger' },
        { id: 'money', kind: 'wizard', source: 'apps.json', url: '/money/', name: 'Money' },
        { id: 'files', kind: 'wizard', source: 'apps.json', url: '/files/', name: 'Files' },
        { id: 'wizard', kind: 'chats', name: 'Chats' },
      ] }),
      backendApps: () => notifications ? [{ id: 'notifications', url: '/notifications/', name: 'Notifications' }] : [],
      appMetadata: id => ({ messenger: { name: 'Messenger' }, money: { name: 'Money' }, notifications: { name: 'Notifications' } })[id],
    },
    document: { querySelectorAll: () => [], addEventListener() {}, hidden: false },
    location: { origin: 'https://wizard.test' },
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    dispatchEvent: e => { for (const fn of listeners[e.type] || []) fn(e); return true; },
    CustomEvent: class { constructor(type, o = {}) { this.type = type; this.detail = o.detail; } },
    setTimeout: () => 0, setInterval: () => 0, fetch, calls, listeners, storage,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('web/core/workspace-navigation.js'), ctx);
  vm.runInContext(read('web/core/notif-bell.js'), ctx);
  return ctx;
}
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
const fetched = (w, url) => w.calls.filter(([m, u]) => m === 'GET' && u.startsWith(url)).length;

// Miguel, 3 Nov 2026: "notifications should come in the same place chat threads come in" — Chats is the default for
// Notifications' alerts AND every app with a feed; Badge is the step down he picks per app.
test('defaults: Notifications and every app with a feed go to Chats; Badge only when picked', async () => {
  const w = boot(), B = w.WosBell;
  assert.equal(B.route('notifications'), 'chats');
  assert.equal(B.route('messenger'), 'chats');
  assert.equal(B.route('anything-new'), 'chats');
  // An app without a feed has nothing Chats could list: it stays a badge whatever the route says.
  await B.discover(); await settle();
  assert.equal(B.inChats('messenger'), true);
  assert.equal(B.inChats('files'), false, 'HTML 200 is not a feed');
  assert.equal(B.inChats('money'), false, '404 is not a feed');
  assert.equal(B.setRoute('messenger', 'badge'), true); assert.equal(B.route('messenger'), 'badge');
});

test('Notifications on Chats: its items are in Chats and counted there, its own badge and the bell are gone', async () => {
  const w = boot(), B = w.WosBell, N = w.WizCore.workspaceNav;
  B.watch(() => {}); await B.refresh(true); await settle();
  assert.deepEqual([...B.items()].map(i => i.id).sort(), ['a-messenger-6e3ac07612d9ea80', 'n1'], 'its alert and Messenger\'s item (default Chats)');
  assert.equal(B.readyCount(), 2, 'Chats Ready counts both');
  assert.equal(N.counts.notifications || 0, 0, 'no badge on the Notifications icon');
  assert.match(B.html(), /data-chbell hidden/, 'no bell beside Chats search either');
});

test('Notifications on Badge: nothing in Chats, its count is a badge (and the bell shows it)', async () => {
  const w = boot(), B = w.WosBell, N = w.WizCore.workspaceNav;
  B.watch(() => {}); await B.refresh(true); await settle();
  assert.equal(B.setRoute('notifications', 'badge'), true); await settle();
  assert.ok(!B.items().some(i => !i.app), 'gone from Chats at once');
  assert.equal(B.readyCount(), 1, 'and from the Chats count (Messenger\'s item stays)');
  assert.equal(N.counts.notifications, 3, 'its badge comes back');
  assert.match(B.html(), /class="ch-bell"[^>]*aria-label="Notifications, 3 unread"/);
  await B.refresh(true); await settle();
  assert.ok(!B.items().some(i => !i.app), 'its list is still read (System rows need it), but nothing of it is listed in Chats');
});

test('an app on Badge puts nothing in Chats and keeps its badge; set to Chats it swaps', async () => {
  const w = boot({ storage: new Map([['wos.notify.route.v1', JSON.stringify({ messenger: 'badge' })]]) }), B = w.WosBell, N = w.WizCore.workspaceNav;
  B.watch(() => {}); await B.refresh(true); await settle();
  assert.equal(fetched(w, '/messenger/api/inbox'), 0, 'an app on Badge is never asked for its items');
  await B.discover(); await settle();
  assert.deepEqual([...B.routes()].map(r => r.id), ['notifications', 'messenger'], 'only apps with a feed can choose Chats; HTML 200 and 404 are not feeds');
  N.setCount('messenger', 5);
  assert.equal(N.counts.messenger, 5, 'Badge: its icon shows its count');
  assert.ok(!B.items().some(i => i.app), 'Badge: nothing of it in Chats');

  B.setRoute('messenger', 'chats'); await settle();
  const it = B.items().find(i => i.app === 'messenger');
  assert.ok(it, 'Chats: its needs-you item is a Chats row');
  assert.equal(it.appName, 'Messenger'); assert.match(it.id, /^a-messenger-[0-9a-f]{16}$/);
  assert.equal(B.readyCount(), 2, 'the Chats badge counts it with the Notifications item');
  assert.equal(N.counts.messenger, 0, 'and its own icon shows no count');
  N.setCount('messenger', 7); assert.equal(N.counts.messenger, 0, 'whatever it reports later');

  B.setRoute('messenger', 'badge'); await settle();
  assert.ok(!B.items().some(i => i.app), 'back on Badge: out of Chats');
  assert.equal(N.counts.messenger, 7, 'and its latest count is its badge again');
});

test('Archive / Snooze on an app item are inbox marks, so it leaves the Chats count', async () => {
  const w = boot({ storage: new Map([['wos.notify.route.v1', JSON.stringify({ messenger: 'chats' })], ['wos.inbox.feeds.v2', JSON.stringify({ messenger: { s: 'yes', at: Date.now() } })]]) });
  const B = w.WosBell;
  B.watch(() => {}); await B.refresh(true); await settle();
  const it = B.items().find(i => i.app === 'messenger'); assert.ok(it);
  const pending = B.mark([it.id], { archived: true, read: true });
  assert.equal(B.readyCount(), 1, 'moves at once');
  await pending;
  const post = w.calls.find(([m, u]) => m === 'POST' && u === '/notifications/api/mark'); assert.ok(post, 'saved with the Notifications app marks');
  assert.ok(JSON.parse(w.storage.get('wos.inbox.appmarks.v1'))[it.id].archived, 'and on the device');
});

test('the choice is saved per device and survives a reload', () => {
  const storage = new Map();
  boot({ storage }).WosBell.setRoute('notifications', 'badge');
  assert.equal(JSON.parse(storage.get('wos.notify.route.v1')).notifications, 'badge');
  assert.equal(boot({ storage }).WosBell.route('notifications'), 'badge');
  assert.equal(boot().WosBell.setRoute('wizard', 'badge'), false, 'Chats is the inbox, not a choice');
  assert.equal(boot().WosBell.setRoute('../x', 'chats'), false);
  assert.equal(boot().WosBell.setRoute('messenger', 'both'), false, 'one place, never both');
});

test('without the inbox in Chats everything is a badge, and Chats\' own count is never suppressed', async () => {
  const w = boot({ inboxList: false }), B = w.WosBell, N = w.WizCore.workspaceNav;
  await B.refresh(true); await settle();
  assert.equal(B.inChats('notifications'), false);
  assert.equal(N.counts.notifications, 3, 'Notifications keeps its badge when Chats cannot list it');
  N.setCount('wizard', 4); assert.equal(N.counts.wizard, 4);
  // The inbox package arrives: Notifications moves to Chats and its badge goes.
  w.WosSkinHost.inboxList = true; w.dispatchEvent(new w.CustomEvent('wos:prefs')); await settle();
  assert.equal(N.counts.notifications || 0, 0);
});

test('Settings has a Notifications page with Badge | Chats per app, and Chats rows for app items open the app', () => {
  const s = read('web/core/settings.js');
  assert.match(s, /\{ id: 'notifications', title: 'Notifications', available: /);
  assert.match(s, /register\(\{ id: 'notification-routing', page: 'notifications'/);
  assert.match(read('web/core/notif-bell.js'), /data-notify-route="\$\{escH\(id\)\}" data-notify-to="\$\{to\}"/);
  assert.match(s, /window\.WosBell\?\.setRoute\?\.\(b\.dataset\.notifyRoute, b\.dataset\.notifyTo\)/);
  const c = read('web/core/chats.js');
  assert.match(c, /<span class="ch-notif-from">\$\{esc\(clip\(from, 40\)\)\}<\/span>/, 'an app item names its app in the row');
  assert.match(c, /it\?\.app && !it\.archived && window\.WizCanOpen\?\.\(it\.app\) \? \['app'\]/, 'Open is offered for an app item');
  assert.match(read('web/core/skin-host.js'), /open\(id\) \{\n        if \(a\.dead\) return false;/);
  assert.match(read('web/tweaks/wizard/unified-inbox/tweak.js'), /action === 'app'/);
  assert.doesNotMatch(read('web/tweaks/wizard/unified-inbox/tweak.css'), /\[data-chbell\] \{ display: none/, 'the bell follows the routing, not the tweak');
});

// One simple design everywhere (Miguel, 1 Nov 2026): the picker inside a notification in Chats is THE Settings picker.
test('one picker (Chats · Badge · Morning report · Off): Settings and every notification in Chats render WosBell.picker', () => {
  const w = boot(), B = w.WosBell;
  const html = B.picker('messenger');
  assert.match(html, /role="radiogroup" aria-label="Where Messenger notifications go"/);
  const btns = [...html.matchAll(/<button type="button" role="radio" data-notify-route="messenger" data-notify-to="(badge|chats)" aria-checked="(true|false)">(<svg class="wos-route-ic"[^]*?<\/svg>)<span>(Badge|Chats)<\/span><\/button>/g)];
  assert.deepEqual(btns.map(m => [m[1], m[2], m[4]]), [['chats', 'true', 'Chats'], ['badge', 'false', 'Badge']], 'loudest first, Chats picked by default');
  assert.match(btns[1][3], /<circle /, 'Badge wears a badge dot'); assert.match(btns[0][3], /<path /, 'Chats wears a chat bubble');
  assert.deepEqual([...html.matchAll(/data-notify-to="(\w+)"/g)].map(m => m[1]), ['chats', 'badge', 'daily', 'off']);
  assert.match(html, /data-notify-to="daily" aria-checked="false" disabled title="Messenger would lose its point waiting for the Morning Report"/, 'an app\'s feed cannot wait a day');
  assert.match(B.picker('messenger', { off: true }), /data-notify-to="chats" aria-checked="false" disabled/, 'without Chats only Badge can be picked');
  const s = read('web/core/settings.js'), c = read('web/core/chats.js');
  assert.match(s, /const routeSeg = \(r, off\) => window\.WosBell\.picker\(r\.id, \{ name: r\.name, off \}\);/, 'Settings renders the shared picker');
  assert.match(c, /\$\{B\.picker\(id, \{ name \}\)\}/, 'Chats renders the same shared picker');
  assert.match(c, /if \(NV\) msgs = noteRouteHtml\(NV\) \+ msgs;/, 'on every notification opened in Chats');
  assert.doesNotMatch(s + c, /data-notify-to="\$\{to\}"/, 'nobody builds a second copy of the picker');
  const css = read('web/core/settings.css');
  assert.match(css, /\.st-nr-seg\.wos-route button \{/, 'styled once, for both places');
});

test('one saved setting: a pick in either place updates the other at once', async () => {
  const w = boot(), B = w.WosBell; let heard = 0;
  w.addEventListener('wizard:notify-route', () => heard++);
  B.watch(() => {}); await B.refresh(true); await settle();
  B.setRoute('notifications', 'badge');
  assert.equal(heard, 1, 'both Settings and Chats repaint on wizard:notify-route');
  assert.match(B.picker('notifications'), /data-notify-to="badge" aria-checked="true"/);
  const c = read('web/core/chats.js'), s = read('web/core/settings.js');
  assert.match(c, /window\.addEventListener\('wizard:notify-route', \(\) => \{[^\n]*renderThreadNow\(x\)/, 'an open notification repaints its picker');
  assert.match(s, /window\.addEventListener\?\.\('wizard:notify-route', appsChanged\)/, 'Settings repaints too');
  assert.match(c, /notifRoute\(id, nrt\.dataset\.notifyRoute, nrt\.dataset\.notifyTo\)/, 'a tap in Chats writes the same route');
});

test('Badge from inside a notification: out of Chats at once, toast "<App> moved to badges · Undo", Undo brings it back', async () => {
  const storage = new Map([['wos.notify.route.v1', JSON.stringify({ messenger: 'chats' })], ['wos.inbox.feeds.v2', JSON.stringify({ messenger: { s: 'yes', at: Date.now() } })]]);
  const w = boot({ storage }), B = w.WosBell;
  const mk = tag => { const el = { tag, children: [], classList: { set: new Set(), add(...a) { a.forEach(x => this.set.add(x)); }, remove(...a) { a.forEach(x => this.set.delete(x)); } }, dataset: {}, textContent: '', on: {},
    append(...k) { this.children.push(...k); }, addEventListener(t, fn) { this.on[t] = fn; }, querySelectorAll(sel) { return sel === 'span' ? this.children.filter(k => k.tag === 'span') : []; } }; return el; };
  const t = mk('div'); w.document.getElementById = id => id === 'toast' ? t : null; w.document.createElement = mk; w.document.createTextNode = x => ({ tag: '#text', textContent: x });
  B.watch(() => {}); await B.refresh(true); await settle();
  assert.ok(B.items().some(i => i.app === 'messenger'));
  const toasts = []; const toast = (i, x, ms) => { toasts.push([i, x, ms]); t.children = [mk('span'), mk('span')]; t.classList.add('show'); };
  B.setRoute('messenger', 'badge');
  assert.ok(!B.items().some(i => i.app === 'messenger'), 'its items leave Chats right away');
  const undo = B.movedToast('messenger', toast);
  assert.equal(toasts.length, 1, 'the shell toast shows');
  assert.equal(t.children[1].textContent, 'Messenger moved to badges · ');
  assert.equal(undo.textContent, 'Undo'); assert.ok(t.children.includes(undo));
  undo.on.click({ preventDefault() {}, stopPropagation() {} }); await settle();
  assert.equal(B.route('messenger'), 'chats', 'Undo restores Chats');
  assert.ok(B.items().some(i => i.app === 'messenger'), 'and its items are back');
  assert.ok(!t.classList.set.has('show'), 'the toast goes');
  const c = read('web/core/chats.js');
  assert.match(c, /if \(to !== 'chats'\) \{[^]*chatsBack\(w\);[^]*B\.movedToast\?\.\(app, toast, 5000, from\);/, 'picking Badge in Chats closes the notification and shows the toast');
});

// With Chats the default, an app's badge is hidden while its feed lists it in Chats. A feed that goes away (404) or
// stays offline must give the badge back, or the app's count shows nowhere (Codex on #895).
test('a feed that goes away or stays offline gets its own badge back; answering again moves it back to Chats', async () => {
  let mode = 'ok';
  const w = boot({ storage: new Map([['wos.inbox.feeds.v2', JSON.stringify({ messenger: { s: 'yes', at: Date.now() } })]]) });
  const real = w.fetch;
  w.fetch = async (url, o) => url === '/messenger/api/inbox' && mode !== 'ok' ? (mode === 'gone' ? { ok: false, status: 404, headers: { get: () => 'application/json' }, json: async () => ({}) } : Promise.reject(new Error('offline'))) : real(url, o);
  const B = w.WosBell, N = w.WizCore.workspaceNav;
  B.watch(() => {}); await B.refresh(true); await settle();
  N.setCount('messenger', 4);
  assert.equal(N.counts.messenger || 0, 0, 'in Chats: no badge of its own');
  // Offline past the grace period (no recent items kept): the badge comes back.
  // The shell's clock (its own realm) moves 6 minutes on.
  mode = 'down'; vm.runInContext('globalThis.__now = Date.now; Date.now = () => __now() + 6 * 60e3;', w);
  try { await B.refresh(true); await settle(); } finally { vm.runInContext('Date.now = __now;', w); }
  assert.equal(B.inChats('messenger'), false);
  assert.equal(N.counts.messenger, 4, 'offline: its badge is back');
  mode = 'ok'; await B.refresh(true); await settle();
  assert.equal(B.inChats('messenger'), true); assert.equal(N.counts.messenger || 0, 0, 'answering again: back in Chats');
  mode = 'gone'; await B.refresh(true); await settle();
  assert.equal(B.inChats('messenger'), false);
  assert.equal(N.counts.messenger, 4, 'feed removed: badge at once');
});

test('a minimal replacement router owns absent optional hooks: no stock IO, grouping or attention', async () => {
  const w = boot(), B = w.WosBell;
  const off = B.routing.replace({ route: (id, own) => own || 'chats', accepts: () => true,
    choices: () => [], quiet: () => false, carried: () => false, sourceOf: () => 'notifications' }, { owner: 'fixture', version: 1 });
  assert.equal(typeof off, 'function'); w.calls.length = 0;
  B.entered(); B.setRoute('notifications', 'badge'); await B.refresh(true); await settle();
  assert.deepEqual([...B.groups()], []); assert.equal(B.attention(), null);
  assert.ok(!w.calls.some(([, u]) => u.includes('/notifications/api/routes') || u.includes('/notifications/api/mark')), 'missing hooks never run stock route sync or read marks');
  off(); assert.equal(B.routing.owner, null);
});
