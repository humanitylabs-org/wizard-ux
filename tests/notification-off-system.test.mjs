// Off and System (Miguel, 2 Nov 2026), built into core since 4 Nov 2026 (was the opt-in miguel/notification-levels
// tweak, #855): a quiet choice, Off (no badge, nothing in Chats, kept in Notifications' own history), and System rows
// for notices about Wizard itself (app updates, app connections, Wizard updates), default Morning report, that count
// on the Settings cog when set to Badge. A System notice that needs the owner is never silenced.
import test from 'node:test';
import assert from 'node:assert/strict';
import { core, settle, read } from './fixtures/notification-levels.mjs';

const NOTES = [
  { id: 'u1', time: 30, title: '1 app updated', message: 'Updated Notifications (2.29.0).', priority: 3, tags: [] },
  { id: 'u2', time: 29, title: 'App updates need a look', message: 'Could not update Money: disk full.', priority: 4, tags: [] },
  { id: 'c1', time: 28, title: 'App connection added', message: 'Money can read SimpleFIN.', priority: 2, tags: ['link', 'wizard-system', 'connections'] },
  { id: 'n1', time: 20, title: 'Backup failed', message: 'Disk full', priority: 3, tags: ['cron'] },
];
function boot({ storage = new Map() } = {}) {
  const calls = [], listeners = {}, events = [], read = new Set();
  const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body });
  const fetch = async (url, opts = {}) => {
    calls.push([opts.method || 'GET', url, opts.body]);
    if (url.startsWith('/notifications/api/count')) return json({ unread: 4, needs: 1 });
    if (url.startsWith('/notifications/api/items')) return json({ items: NOTES.map(i => ({ ...i, read: read.has(i.id) })) });
    if (url.startsWith('/notifications/api/marks')) return json({ marks: {} });
    if (url.startsWith('/notifications/api/mark')) { for (const id of JSON.parse(opts.body).ids) read.add(id); return json({ ok: true }); }
    // An older Notifications without box-saved choices (the device copy is all there is): see notification-daily-sync.
    return json({ error: 'not found' }, 404);
  };
  const ctx = core({
    WosSkinHost: { inboxList: true }, CSS: { escape: s => s },
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)) },
    WizCanOpen: id => id === 'notifications',
    WizCore: { apps: () => ({ APPS: [] }), backendApps: () => [{ id: 'notifications', url: '/notifications/', name: 'Notifications' }], appMetadata: id => ({ notifications: { name: 'Notifications' } })[id] },
    document: { querySelectorAll: () => [], addEventListener() {}, hidden: false },
    location: { origin: 'https://wizard.test' },
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    dispatchEvent: e => { events.push(e.type); for (const fn of listeners[e.type] || []) fn(e); return true; },
    CustomEvent: class { constructor(type, o = {}) { this.type = type; this.detail = o.detail; } },
    setTimeout: () => 0, setInterval: () => 0, fetch, calls, listeners, storage, events,
  });
  return ctx;
}
const ids = B => [...B.items()].map(i => i.id);
const choices = h => [...h.matchAll(/data-notify-to="(\w+)"/g)].map(m => m[1]);

test('the picker has four choices, Chats · Badge · Morning report · Off, everywhere it is drawn', () => {
  const w = boot(), h = w.WosBell.picker('notifications');
  assert.deepEqual(choices(h), ['chats', 'badge', 'daily', 'off'], 'loudest to quietest');
  assert.match(w.WosBell.picker('system:app-updates'), /data-notify-route="system:app-updates" data-notify-to="daily" aria-checked="true"/, 'System rows default to the Morning report');
  assert.match(h, /data-notify-to="off"[^>]*><svg class="wos-route-ic" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5\.5"\/><path d="M4\.2 11\.8l7\.6-7\.6"\/><\/svg><span>Off/, 'Off wears its own icon');
});

test('System notices are classified by tags or known titles; needs-you ones route as Notifications', () => {
  const B = boot().WosBell;
  assert.equal(B.routeIdOf(NOTES[0]), 'system:app-updates');
  assert.equal(B.routeIdOf(NOTES[1]), 'notifications', 'a failed update is never silenced');
  assert.equal(B.routeIdOf(NOTES[2]), 'system:connections', 'tagged by its sender');
  assert.equal(B.routeIdOf(NOTES[3]), 'notifications', 'an agent job is not System');
  assert.equal(B.routeIdOf({ title: 'Connection needs your OK', priority: 4 }), 'notifications');
});

test('default: routine System notices leave Chats and the Notifications badge; the problem stays in Chats', async () => {
  const w = boot(), B = w.WosBell;
  B.watch(() => {}); await B.refresh(true); await settle();
  assert.deepEqual(ids(B), ['u2', 'n1']);
  assert.equal(B.attention(), null, 'Morning report: nothing on the Settings cog');
  B.setRoute('notifications', 'badge'); await settle();
  assert.equal(w.WizCore.workspaceNav.counts.notifications, 2, 'Notifications badge counts only its own (4 unread − 2 System)');
});

test('Off for an app or Notifications: no badge and nothing in Chats', async () => {
  const w = boot(), B = w.WosBell, N = w.WizCore.workspaceNav;
  B.watch(() => {}); await B.refresh(true); await settle();
  assert.equal(B.setRoute('notifications', 'off'), true); await settle();
  assert.equal(B.route('notifications'), 'off');
  assert.deepEqual(ids(B), [], 'gone from Chats');
  assert.equal(N.counts.notifications || 0, 0, 'no badge');
  assert.match(B.html(), /data-chbell hidden/, 'no bell');
  assert.equal(B.isOff('notifications'), true);
});

test('System row on Badge counts on the Settings cog; seeing it in Settings marks it read', async () => {
  const w = boot(), B = w.WosBell;
  await B.refresh(true); await settle();
  B.setRoute('system:app-updates', 'badge'); B.setRoute('system:connections', 'badge'); await settle();
  assert.deepEqual({ ...B.attention() }, { n: 2, label: 'new from Wizard', short: 'new' });
  assert.ok(w.events.includes('wizard:notify-attention'));
  const g = B.groups()[0];
  assert.equal(g.title, 'System');
  assert.deepEqual([...g.rows.map(r => r.id)], ['system:app-updates', 'system:connections', 'system:wizard-updates']);
  assert.deepEqual([...g.list.items.map(i => i.title)], ['1 app updated', 'App updates need a look', 'App connection added'], 'Settings lists recent ones, the problem included');
  B.entered(); await settle();
  const post = w.calls.find(([m, u]) => m === 'POST' && u === '/notifications/api/mark');
  assert.deepEqual(JSON.parse(post[2]).ids.sort(), ['c1', 'u1']);
  assert.equal(B.attention(), null);
  assert.equal(B.groups()[0].list.items[0].fresh, true, 'the list keeps its dots while the page is open');
  B.left();
});

test('System row on Chats lists those notices in Chats', async () => {
  const w = boot(), B = w.WosBell;
  B.watch(() => {}); await B.refresh(true); await settle();
  B.setRoute('system:app-updates', 'chats'); await settle();
  assert.deepEqual(ids(B), ['u1', 'u2', 'n1']);
  assert.equal(B.nameOf('system:app-updates'), 'App updates');
});

test('a notification asks "<row> go to", never "Notifications notifications go to"', () => {
  const B = boot().WosBell;
  assert.equal(B.ask('notifications', 'Notifications'), 'Notifications go to');
  assert.equal(B.ask('system:app-updates', 'App updates'), 'App updates go to');
  assert.equal(B.ask('messenger', 'Messenger'), 'Messenger notifications go to');
  assert.match(read('web/core/chats.js'), /ask = B\.ask\?\.\(id, name\) \|\| `\$\{name\} notifications go to`/);
});

test('unknown routes and ids are refused', () => {
  const B = boot().WosBell;
  assert.equal(B.setRoute('system:nope', 'off'), false);
  assert.equal(B.setRoute('messenger', 'mute'), false);
  assert.equal(B.setRoute('messenger', 'off'), true);
  assert.equal(B.route('messenger'), 'off');
});

/* ---- Built in: no tweak, no Badge | Chats-only core left ---- */
test('core is the levels: four choices with no tweak worn, stored Morning report / Off values hold as saved', async () => {
  const storage = new Map([['wos.notify.route.v1', JSON.stringify({ notifications: 'daily', messenger: 'off' })]]);
  const w = boot({ storage }), B = w.WosBell;
  assert.equal(B.routing.owner, null, 'the stock part, nobody replaced it');
  assert.deepEqual(choices(B.picker('messenger')), ['chats', 'badge', 'daily', 'off']);
  assert.equal(B.route('notifications'), 'daily'); assert.equal(B.isOff('notifications'), true);
  assert.equal(B.route('messenger'), 'off'); assert.equal(B.isOff('messenger'), true);
  assert.equal(B.routeLabel('notifications'), 'Morning report');
  assert.equal(B.routeLabel('mail'), 'Chats', 'an app with no saved choice starts in Chats (#895)');
});

test('the retired tweak is gone: no package, not in the catalog or Miguel\'s profile', () => {
  const cat = JSON.parse(read('web/tweaks/catalog.json')), prof = JSON.parse(read('web/tweaks/miguel/profile.json'));
  assert.ok(!cat.tweaks.includes('miguel/notification-levels')); assert.ok(!prof.tweaks.includes('miguel/notification-levels'));
  assert.throws(() => read('web/tweaks/miguel/notification-levels/manifest.json'));
  // Its styles live in core now.
  assert.match(read('web/core/settings.css'), /\.st-sys-list li\.new b::before/);
  assert.match(read('web/core/settings.css'), /\.st-seg\.st-nr-seg\.wos-route \{ width: auto; max-width: none; grid-auto-columns: auto; \}/);
  assert.match(read('web/desktop/desktop.css'), /#settingsBtn \.cog-n \{/);
});

test('cog and attention hooks: the phone gear, the desktop cog and the Settings row read WosBell.attention', () => {
  const app = read('web/app.js'), desk = read('web/desktop/desktop.js'), st = read('web/core/settings.js');
  assert.match(app, /at = window\.WosBell\?\.attention\?\.\(\)/);
  assert.match(desk, /function paintCog\(\)[^]*window\.WosBell\?\.attention\?\.\(\)/);
  assert.match(st, /if \(at\?\.n\) items\.push\(\{ title: `\$\{at\.n\} \$\{at\.label\}`, feature: 'notification-routing' \}\)/);
  for (const f of ['web/app.js', 'web/desktop/desktop.js', 'web/core/settings.js', 'web/core/notif-bell.js', 'web/core/chats.js', 'web/core/skin-host.js'])
    assert.doesNotMatch(read(f), /notification-levels/, `${f} never names the tweak`);
});
