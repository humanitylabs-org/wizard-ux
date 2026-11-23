// Off and System (Miguel, 2 Nov 2026), built into core since 4 Nov 2026 (was the opt-in miguel/notification-levels
// tweak, #855): a quiet choice, Off (no badge, nothing in Chats, kept in Notifications' own history), and System rows
// for notices about Wizard itself (app updates, app connections, Wizard updates), default Morning report, that count
// on the Settings cog when set to Badge. A System notice that needs the owner is never silenced.
import test from 'node:test';
import assert from 'node:assert/strict';
import { core, settle, read } from './fixtures/notification-levels.mjs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import vm from 'node:vm';
import { createDocument } from './fixtures/mini-dom.mjs';
import { styles } from './fixtures/w5-css.mjs';
import { settingsWorld } from './fixtures/r5A-settings.mjs';

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
  // the thread's real "where these go" line (core/chats-drafts.js noteRouteHtml) asks the bell for its words
  const drafts = read('web/core/chats-drafts.js');
  const from = drafts.indexOf('  const APP_NOTE ='), code = drafts.slice(from, drafts.indexOf('  // "More from Money', from));
  const words = (B2, NV) => { const c = { window: { WosBell: B2 }, esc: String, noteQuiet: () => false }; vm.createContext(c); vm.runInContext(code + '\nthis.f = noteRouteHtml;', c); return /<span>([^<]*)<\/span>/.exec(c.f(NV))?.[1]; };
  const bell = { ...B, picker: () => '<picker>', chatsAvailable: true, nameOf: id => ({ notifications: 'Notifications', messenger: 'Messenger' })[id] };
  assert.equal(words(bell, { id: 'x', item: { app: 'messenger' } }), 'Messenger notifications go to');
  assert.equal(words(bell, { id: 'y', item: null }), 'Notifications go to');
  assert.equal(words({ ...bell, ask: undefined }, { id: 'y', item: null }), 'Notifications notifications go to', 'an older bell without ask() keeps the old words');
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

test('the retired tweak is gone: no package, not in the catalog or Miguel\'s profile', async () => {
  const cat = JSON.parse(read('web/tweaks/catalog.json')), prof = JSON.parse(read('web/tweaks/miguel/profile.json'));
  assert.ok(!cat.tweaks.includes('miguel/notification-levels')); assert.ok(!prof.tweaks.includes('miguel/notification-levels'));
  assert.throws(() => read('web/tweaks/miguel/notification-levels/manifest.json'));
  // Its styles live in core now: on what the real Settings page and desktop cog draw.
  const settingsCss = read('web/core/settings.css'), deskCss = read('web/desktop/desktop.css');
  const w = boot(), B = w.WosBell;
  await B.refresh(true); await settle();
  B.setRoute('system:app-updates', 'badge'); await settle();
  const st = settingsWorld({ shell: 'desktop', scope: { WosBell: B } }); // desktop: where segmented controls are capped
  const page = st.open('notifications');
  const fresh = page.querySelector('.st-sys-list li.new b');
  assert.ok(fresh, 'Settings › Notifications lists the unseen System notice');
  const dot = styles(fresh, [settingsCss], { pseudo: '::before' });
  assert.equal(dot.content, "''"); assert.equal(dot.width, '8px'); assert.equal(dot['border-radius'], '50%');
  assert.equal(dot.background, 'var(--wz-accent)', 'an unseen notice carries the accent dot');
  const seg = page.querySelector('.st-seg.st-nr-seg.wos-route');
  assert.ok(seg, 'the four-choice picker on the page');
  const segCss = styles(seg, [settingsCss]);
  assert.equal(segCss.width, 'auto'); assert.equal(segCss['max-width'], 'none'); assert.equal(segCss['grid-auto-columns'], 'auto');
  const cog = deskCog({ n: 3, label: 'new from Wizard' });
  const count = cog.btn.querySelector('b.cog-n');
  const cogCss = styles(count, [deskCss]);
  assert.equal(cogCss.position, 'absolute', 'the count sits on the cog');
  assert.equal(cogCss.background, 'var(--wz-accent)');
});

// The real phone gear (web/app-unsent.js), desktop cog (web/desktop/desktop-cog.js) and Settings attention list
// (web/core/settings.js), each with a WosBell whose attention is `at`.
function phoneGear(at, unsent = []) {
  const s = { WosBell: { attention: () => at }, WosSettings: { unsentAll: () => unsent }, addEventListener() {} };
  s.window = s; vm.runInNewContext(read('web/app-unsent.js'), s);
  const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return s.WizCore.appParts.unsent({ clip: x => x, esc, NATIVE: () => false, refreshHome() {}, settingsContext: () => ({}) }).gearBtn();
}
function deskCog(at) {
  const doc = createDocument(), listeners = {};
  doc.body.innerHTML = '<div id="bar"><button id="settingsBtn" aria-label="Settings"></button></div><div id="keys"></div><div id="settings"></div>';
  const bell = { at };
  const s = { document: doc, WosBell: { attention: () => bell.at }, addEventListener: (t, f) => (listeners[t] ||= []).push(f) };
  s.window = s; vm.runInNewContext(read('web/desktop/desktop-cog.js'), s);
  s.WizCore.desktopParts.cog({ $: q => doc.querySelector(q), C: {}, closeSettings() {}, openSettings() {}, OUTBOX: null, renderSettings() {}, setEl: doc.getElementById('settings') });
  const btn = doc.getElementById('settingsBtn');
  return { btn, set: v => { bell.at = v; for (const f of listeners['wizard:notify-attention'] || []) f(); } };
}

test('cog and attention hooks: the phone gear, the desktop cog and the Settings row read WosBell.attention', () => {
  const at = { n: 2, label: 'new from Wizard', short: 'new' };
  // Phone gear.
  const gear = phoneGear(at);
  assert.match(gear, /aria-label="Settings, 2 new from Wizard"/);
  assert.match(gear, /<span class="gear-n">2<\/span>/);
  assert.doesNotMatch(phoneGear(null), /gear-n|, \d/, 'nothing to say: a plain gear');
  // Desktop cog, repainted when the bell says attention changed.
  const cog = deskCog(at);
  assert.equal(cog.btn.querySelector('.cog-n')?.textContent, '2');
  assert.equal(cog.btn.getAttribute('aria-label'), 'Settings, 2 new from Wizard');
  cog.set({ n: 120, label: 'new from Wizard' });
  assert.equal(cog.btn.querySelector('.cog-n').textContent, '99+');
  cog.set(null);
  assert.equal(cog.btn.querySelector('.cog-n'), null); assert.equal(cog.btn.getAttribute('aria-label'), 'Settings');
  // Settings' attention list (what the Settings row shows).
  const st = settingsWorld({ scope: { WosBell: { attention: () => at, routes: () => [] } } });
  assert.deepEqual(JSON.parse(JSON.stringify(st.W.attention({}))), [{ title: '2 new from Wizard', feature: 'notification-routing' }]);
  const quiet = settingsWorld({ scope: { WosBell: { attention: () => null, routes: () => [] } } });
  assert.deepEqual(JSON.parse(JSON.stringify(quiet.W.attention({}))), []);
  for (const f of ['web/app.js', 'web/desktop/desktop.js', 'web/core/settings.js', 'web/core/notif-bell.js', 'web/core/chats.js', 'web/core/skin-host.js'])
    assert.doesNotMatch(read(f), /notification-levels/, `${f} never names the tweak`);
});
