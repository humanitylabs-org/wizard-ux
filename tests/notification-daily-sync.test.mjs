// Morning report and the box-wide save (Miguel, 2 Nov 2026), built into core since 4 Nov 2026 (was the opt-in
// miguel/notification-levels tweak, #855): Chats · Badge · Morning report · Off, one place per source; Morning report (stored `daily`) only for Notifications and System (greyed
// out for an app like Mail); every device shows the same choice (Notifications /api/routes), this device's copy
// covering a cold start, and a box with nothing saved takes this device's choices once.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { core, settle, read } from './fixtures/notification-levels.mjs';
import { fixture } from './fixtures/tweaks.mjs';

function boot({ storage = new Map(), server = { routes: {}, saved: false }, up = true, feeds = {}, notes = [] } = {}) {
  const calls = [], listeners = {};
  const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body });
  const ctx = {
    WosSkinHost: { inboxList: true }, CSS: { escape: s => s },
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)) },
    WizCanOpen: id => id === 'notifications' || id === 'mail' || id in feeds,
    WizCore: { apps: () => ({ APPS: [{ id: 'mail', kind: 'wizard', source: 'apps.json', url: '/mail/', name: 'Mail' }, ...Object.keys(feeds).map(id => ({ id, kind: 'wizard', source: 'apps.json', url: `/${id}/`, name: id }))] }), backendApps: () => [{ id: 'notifications', url: '/notifications/' }], appMetadata: id => ({ mail: { name: 'Mail' }, notifications: { name: 'Notifications' } })[id] || { name: id } },
    document: { querySelectorAll: () => [], addEventListener() {}, hidden: false },
    location: { origin: 'https://wizard.test' },
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    dispatchEvent: e => { for (const fn of listeners[e.type] || []) fn(e); return true; },
    CustomEvent: class { constructor(type, o = {}) { this.type = type; this.detail = o.detail; } },
    setTimeout: () => 0, setInterval: () => 0, calls, storage, server,
    up: () => up, setUp: v => { up = v; },
  };
  ctx.fetch = async (url, opts = {}) => {
    calls.push([opts.method || 'GET', url, opts.body]);
    if (url === '/notifications/api/routes') {
      if (!up) return json({ error: 'down' }, 502);
      if (opts.method === 'POST') { Object.assign(server.routes, JSON.parse(opts.body).routes); server.saved = true; return json({ ok: true, ...server }); }
      return json({ routes: { ...server.routes }, saved: server.saved, defaults: {} });
    }
    if (url.startsWith('/notifications/api/count')) return json({ unread: 0, needs: 0 });
    if (url.startsWith('/notifications/api/items')) return json({ items: notes });
    if (url.startsWith('/notifications/api/marks')) return json({ marks: {} });
    if (url === '/mail/api/inbox') return json({ inbox: 1, items: [] });
    const m = /^\/([a-z0-9-]+)\/api\/inbox$/.exec(url); if (m && feeds[m[1]]) return json({ inbox: 1, items: feeds[m[1]] });
    return json({ error: 'not found' }, 404);
  };
  core(ctx);
  return ctx;
}

test('Morning report is greyed out for an app like Mail and refused if asked; Notifications and System can take it', () => {
  const B = boot().WosBell;
  assert.match(B.picker('mail'), /data-notify-to="daily" aria-checked="false" disabled title="Mail would lose its point waiting for the Morning Report"/);
  assert.doesNotMatch(B.picker('notifications'), /data-notify-to="daily"[^>]*disabled/);
  assert.equal(B.setRoute('mail', 'daily'), false);
  assert.equal(B.setRoute('notifications', 'daily'), true);
  assert.equal(B.route('notifications'), 'daily');
  assert.equal(B.isOff('notifications'), true, 'Morning report shows no badge and nothing in Chats');
});

test('a choice is saved on the box, so another device gets it', async () => {
  const server = { routes: {}, saved: true };
  const a = boot({ server }); await settle();
  a.WosBell.setRoute('mail', 'badge'); await settle();
  assert.deepEqual(server.routes, { mail: 'badge' });
  const b = boot({ server }); await settle();
  assert.equal(b.WosBell.route('mail'), 'badge', 'a second device shows the same choice');
});

test('a box with nothing saved takes this device\'s choices once; then the box wins', async () => {
  const storage = new Map([['wos.notify.route.v1', JSON.stringify({ messenger: 'chats', notifications: 'badge' })]]);
  const server = { routes: {}, saved: false };
  const w = boot({ storage, server }); await settle();
  assert.deepEqual(server.routes, { messenger: 'chats', notifications: 'badge' });
  server.routes.messenger = 'off';
  await w.WosBell.refresh(true); await settle();
  assert.equal(w.WosBell.route('messenger'), 'off');
});

test('offline: the choice holds on this device and is sent once Notifications answers', async () => {
  const server = { routes: {}, saved: true };
  const w = boot({ server, up: false }); await settle();
  w.WosBell.setRoute('system:app-updates', 'off'); await settle();
  assert.equal(w.WosBell.route('system:app-updates'), 'off');
  assert.deepEqual(server.routes, {});
  w.setUp(true);
  await w.WosBell.refresh(true); await settle();
  assert.deepEqual(server.routes, { 'system:app-updates': 'off' });
});

test('the fourth choice is called Morning report and wears its coffee cup', () => {
  const h = boot().WosBell.picker('notifications');
  assert.match(h, /data-notify-to="daily"[^>]*><svg class="wos-route-ic wos-route-mr" viewBox="0 0 512 512" aria-hidden="true"><path d="M96 235H349[^]*?<span>Morning report<\/span>/);
});

test('the coffee cup is the Morning Report sigil from sigils.css', () => {
  const css = read('web/core/sigils.css'), js = read('web/core/notif-bell.js');
  const d = js.match(/const CUP = '([^']+)'/)[1];
  assert.ok(css.includes(d.slice(0, 60)), 'same path as .sg-coffee');
});

test('one-time move: only a box with nothing saved takes a device\'s choices; an empty device uploads nothing', async () => {
  const server = { routes: {}, saved: false };
  boot({ server }); await settle();
  assert.ok(!server.saved, 'nothing chosen on this device: nothing written, the box stays empty');
  const storage = new Map([['wos.notify.route.v1', JSON.stringify({ 'wizard-mail': 'badge', 'system:nope': 'off', mail: 'daily' })]]);
  boot({ storage, server }); await settle();
  assert.deepEqual(server.routes, { 'wizard-mail': 'badge' }, 'only valid choices move (no unknown System kind, no Morning report for an app)');
  const other = new Map([['wos.notify.route.v1', JSON.stringify({ 'wizard-mail': 'chats' })]]);
  const w = boot({ storage: other, server }); await settle();
  assert.deepEqual(server.routes, { 'wizard-mail': 'badge' }, 'a box with choices is never overwritten by another device');
  assert.equal(w.WosBell.route('wizard-mail'), 'badge', 'the device takes the box\'s choice');
  assert.deepEqual(JSON.parse(other.get('wos.notify.route.v1')), { 'wizard-mail': 'badge' }, 'and keeps it as its fallback copy');
});

test('Miguel\'s box: only sources set to Chats are rows; Badge apps keep their count on their own icon', async () => {
  const item = (key, t) => ({ key, title: key, text: key, time: t, priority: 3, open: '' });
  const feeds = { 'wizard-mail': [item('m1', 50), item('m2', 49)], messenger: [item('chat', 48)], money: [item('bill', 47)], 'card-benefits': [item('perk', 46)], sniper: [item('scan', 45)] };
  const notes = [{ id: 'n1', time: 60, title: 'Backup failed', message: 'x', priority: 3, tags: ['cron'] }, { id: 'u1', time: 59, title: '2 apps updated', message: 'x', priority: 3, tags: [] }];
  const server = { saved: true, routes: { 'wizard-mail': 'badge', messenger: 'badge', money: 'badge', 'card-benefits': 'badge', notifications: 'chats', sniper: 'chats', 'system:app-updates': 'daily', 'system:connections': 'daily', 'system:wizard-updates': 'daily' } };
  const w = boot({ server, feeds, notes }), B = w.WosBell;
  await settle(); await B.discover(); await settle();
  B.watch(() => {}); await B.refresh(true); await settle(20);
  const src = [...new Set([...B.items()].map(i => i.app || B.routeIdOf(i)))].sort();
  assert.deepEqual(src, ['notifications', 'sniper'], 'rows: Wizard\'s own alerts and Sniper, nothing from Badge apps, no System update');
  assert.deepEqual([...B.items()].map(i => i.id).filter(id => !id.startsWith('a-')), ['n1'], 'the app-updates notice waits for the Morning report');
  for (const id of ['wizard-mail', 'messenger', 'money', 'card-benefits']) { assert.equal(B.inChats(id), false, id); assert.equal(B.routeLabel(id), 'Badge', id); }
  assert.equal(B.readyCount(), 2, 'the Chats badge counts exactly its rows');
  assert.ok(!w.calls.some(([m, u]) => m === 'POST' && u === '/notifications/api/routes'), 'reading never writes the box');
});

const ID = 'miguel/levels-probe';
/* ---- skin-host `notify` capability: trusted only, one URL, released on teardown ---- */
test('notify capability: only Notifications /api/routes, trusted authors only, revoked on teardown', async () => {
  const f = fixture({ manifests: { 'stranger/levels': { id: 'stranger/levels', name: 'x', version: '1.0.0', author: 'stranger', apiVersion: 1, capabilities: ['notify'], description: 'x' }, [ID]: { id: ID, name: 'x', version: '1.0.0', author: 'miguel', apiVersion: 1, capabilities: ['notify'], description: 'x' } } });
  const w = f.ctx.window, seen = [], requests = [];
  let released = 0;
  w.WosBell.routing = { version: 1, replace(impl, o) { seen.push([o.owner, o.version, typeof impl.route]); return () => { released++; }; } };
  f.ctx.fetch = (orig => async (url, opts = {}) => { if (String(url).includes('/tweaks/')) return orig(url, opts); requests.push([opts.method || 'GET', String(url), opts.body || null]); return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ routes: { mail: 'chats' }, saved: true }) }; })(f.ctx.fetch);
  // A package from an author that isn't a team author never gets the capability.
  const src = 'export default function setup(api) { globalThis.__got = !!api.notify; return () => {}; }';
  f.host._test.setImporter(async url => url.includes('stranger/') ? vm.runInNewContext(`(() => { ${src.replace('export default function setup', 'function setup')}; return { default: setup }; })()`, f.ctx) : { default: () => () => {} });
  await f.host.loadTweaks(['stranger/levels'], f.slots, { teamAuthors: ['miguel'] });
  assert.equal(f.ctx.__got, false, 'untrusted: no api.notify');
  // A trusted package (a team author) that replaces the part.
  const pkg = 'function setup(api) { api.notify.routing({ route: () => "badge", accepts: () => true, choices: () => [], quiet: () => false, carried: () => false, sourceOf: () => "notifications" }, { version: 1 }); return () => {}; }';
  let api = null;
  f.host._test.setImporter(async () => vm.runInNewContext(`(() => { ${pkg}; return { default: a => { globalThis.__api = a; return setup(a); } }; })()`, f.ctx));
  await f.host.loadTweaks([ID], f.slots, { teamAuthors: ['miguel'] });
  api = f.ctx.__api;
  assert.deepEqual(seen[0], [ID, 1, 'function']);
  assert.deepEqual(await api.notify.routes.get(), { routes: { mail: 'chats' }, saved: true });
  assert.equal(await api.notify.routes.save({ mail: 'off', 'bad key!': 'x', notifications: 'NOPE' }), true);
  assert.deepEqual(requests.map(([m, u, b]) => [m, u, b]), [['GET', 'https://wizard.test/notifications/api/routes', null], ['POST', 'https://wizard.test/notifications/api/routes', JSON.stringify({ routes: { mail: 'off' } })]], 'one URL, cleaned body');
  await f.clear();
  assert.equal(released, 1, 'the part goes back to stock on teardown');
  assert.equal(await api.notify.routes.get(), null, 'a dead package reads nothing');
  assert.equal(await api.notify.routes.save({ mail: 'chats' }), false, 'and writes nothing');
  assert.equal(api.notify.routing({ route() {} }, { version: 1 }), false);
});
