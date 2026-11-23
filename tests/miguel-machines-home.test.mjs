import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, read } from './fixtures/tweaks.mjs';
import { withAppParts } from './fixtures/app-parts.mjs';
import { withSkinHostParts } from './fixtures/skin-host-parts.mjs';
import { withSettingsParts } from './fixtures/settings-parts.mjs'; // settings.js parts moved out verbatim (issue 1665)
import { withDesktopParts } from './fixtures/desktop-parts.mjs';

import { machinesHome, dev, nowIso, CSS } from './fixtures/machines-home-harness.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { styleOf } from './fixtures/mini-css.mjs';
import { phoneHome } from './fixtures/w5-phone-home.mjs';
import { runRecording, block, between } from './fixtures/source-slice.mjs';
import { nginxShell } from './fixtures/w1-nginx.mjs';
import vm from 'node:vm';

const TWEAK = 'web/tweaks/miguel/machines-home/tweak.js';
let deskCache, appCache;
const deskSrc = () => (deskCache ??= withDesktopParts(read('web/desktop/desktop.js')));
const appSrc = () => (appCache ??= withAppParts(read('web/app.js')));
// One AI account as the shell's usage feed hands it to packages (core/usage.js normalize()).
const acct = (id, pct, more = {}) => ({ id, provider: id.split(':')[0], providerName: { claude: 'Claude', chatgpt: 'ChatGPT', tinfoil: 'Tinfoil' }[id.split(':')[0]] || id.split(':')[0],
  name: (id.split(':')[1] || 'me') + '@mail.test', status: 'ok', limits: pct == null ? [] : [{ label: 'Weekly', remainingPercent: pct }], fetchedAt: nowIso(), ...more });
const credit = (id, balance, more = {}) => acct(id, null, { paid: { type: 'credits', limitMinor: 1000, balanceMinor: balance, currency: 'USD' }, ...more });
// A fresh Devices feed reading for Wiz (owned by Ann): Main plus two Wizard helpers and Ann's phone.
const world = (more = {}, devs) => ({ devices: { this: { wizard: 'Wiz', owner: 'Ann', name: 'MainBox' },
  devices: devs || [dev('this', { name: 'MainBox' }), dev('h1', { cpus: 4 }), dev('h2', { cpus: 16 }), dev('h3', { cpus: 2, memoryTotalGB: 8 }), dev('ph', { group: 'human', name: 'Phone' })], ...(more.reg || {}) },
  devicesAt: Date.now(), ai: { providers: more.providers || [acct('claude:mig', 70)], fetchedAt: nowIso() }, ...(more.state || {}) });
const backupOk = (more = {}) => ({ backup: { configured: true, target: { kind: 'r2', bucket: 'vault' }, every: 'daily', last: { ok: true, finished_at: Date.now() / 1000 - 7200, repository_bytes: 5e9, snapshots: 9 }, retention: { daily: 7, weekly: 4, monthly: 6 } }, ...more });
const managedItems = [{ id: 'g1', kind: 'managed', name: 'Carlos', people: ['Bea'], peopleCount: 3, url: '' }];
const plain = x => JSON.parse(JSON.stringify(x));
const words = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const nodes = m => m.page('overview').querySelectorAll('.mh-row.is-machines > .mh-node').map(n => [n.dataset.id, n.dataset.role, words(n.querySelector('.mh-role'))]);
// A slice of a shell adapter entry (`name: (args) => body`) as a callable, with the given scope; free names are recorders.
const entry = (src, marker, scope, end) => runRecording('this.f = ' + (end ? between(src, marker, end) : block(src, marker)).slice(marker.indexOf(':') + 1).trim() + ';', scope);

// The real Settings › Look list (core/experience.js) with a catalog that has one replacement group (two Home maps).
async function groupedDevice(offs = {}) {
  const storage = new Map([['wos.skin', 'obsidian'], ['wos.channel.v1', 'latest'], ['wos.skin-tweaks.v1', JSON.stringify({ version: 1, off: {}, preset: 'none', mix: offs, machinesHomeMoved: true, miguelLayoutMoved: true })]]);
  let active = [];
  const window = { WosSkin: { current: 'obsidian', families: [], familyOf: () => 'mizel' },
    WosSkinHost: { personalState: { ready: false }, get tweakState() { return active; }, loadTweaks: async ids => { active = [...ids]; }, setStandardLayout() {}, layouts: [] }, addEventListener() {}, dispatchEvent() {} };
  const cat = JSON.parse(read('web/tweaks/catalog.json')); cat.tweaks.push('wizard/machines-home'); cat.oneOf = [['miguel/machines-home', 'wizard/machines-home']];
  const file = p => p === 'tweaks/catalog.json' ? cat : p === 'tweaks/wizard/machines-home/manifest.json' ? { ...JSON.parse(read('web/tweaks/miguel/machines-home/manifest.json')), id: 'wizard/machines-home', author: 'wizard' } : JSON.parse(read('web/' + p));
  vm.runInNewContext(read('web/core/experience.js'), { window, setTimeout, clearTimeout, Event, CustomEvent: class extends Event { constructor(t, o) { super(t); this.detail = o?.detail; } }, URL, AbortSignal,
    document: { baseURI: 'https://wizard.test/wizard-os-home/', addEventListener() {}, documentElement: { dataset: { shell: 'phone' } } },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    fetch: async url => ({ ok: true, json: async () => file(new URL(url).pathname.split('/wizard-os-home/')[1]) }) });
  const E = window.WosExperience; await E.refresh();
  return { E, active: () => [...active], rows: () => plain(E.state.tweaks.filter(t => t.id.endsWith('/machines-home')).map(t => [t.id, t.on])) };
}
// Settings (core/settings.js) in a vm with a page root, a fake clock for the deferred System link.
function settingsWorld() {
  const timers = new Map(); let n = 0; const stops = [];
  const s = { console, Map, Set, Date, String, URL, CSS: { escape: String }, setTimeout, document: { activeElement: null }, navigator: { userAgent: 'Desktop' },
    location: { host: 'box.test', href: 'https://box.test/wizard-os-home/index.html', origin: 'https://box.test' }, localStorage: { getItem: () => null, setItem() {} },
    setInterval: fn => { timers.set(++n, fn); return n; }, clearInterval: id => timers.delete(id), fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }) };
  s.window = s; s.addEventListener = (t, f, c) => stops.push(['add', t, c]); s.removeEventListener = (t, f, c) => stops.push(['remove', t, c]);
  s.WizCore = { refreshApps: async () => {} }; s.WizChatsHost = { defaultId: () => 'wizard-chats', installed: () => [] };
  vm.runInNewContext(withSettingsParts(read('web/core/settings.js')), s);
  const root = { innerHTML: '', scrollTop: 0, dataset: {}, classList: { add() {} }, contains: () => false, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  const view = s.WosSettings.mount(root, { shell: 'phone', live: { ok: true, onChange: () => () => {} }, helpSub: 'Help' });
  return { s, W: s.WosSettings, root, view, timers, stops, tick: () => { for (const f of [...timers.values()]) f(); }, fill: page => s.WosSettings.register({ id: 'pkg-' + page, page, html: () => '<div></div>' }) };
}
// core/usage.js normalize() in a vm, as the shell runs it on the Agent Service usage feed.
function usage() { const ctx = { document: { documentElement: { dataset: {} }, addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, console, Set, Map, fetch: () => new Promise(() => {}), dispatchEvent: () => true, addEventListener() {} };
  ctx.window = ctx; ctx.WosChat = { esc: String }; vm.runInNewContext(read('web/core/usage.js'), ctx); return p => plain(ctx.WosUsage.normalize({ providers: p }).providers); }
// Miguel's Machines-on-Home tweak and the two narrow host hooks it needs (home-main mount + api.on('home'),
// data.read.app). Stock Home stays plain markup: the slot is empty and takes no space without a package.
test('Home repaints keep a home-main mount in place and tell only home listeners', async () => {
  const f = fixture(); let api, homes = 0, renders = 0;
  f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  await f.host.loadTweaks(['miguel/machines-home'], f.slots, { teamAuthors: ['miguel'] });
  const node = f.doc.createElement('section');
  assert.equal(api.slot.mount('home-main', node), true);
  api.on('home', () => homes++); api.on('render', () => renders++);
  // A repaint: the host keeps the mounted node and moves it into the new slot.
  const el = f.doc.createElement('div'), slot = node.parentNode; el.append(slot);
  Object.defineProperty(slot, 'childNodes', { get() { return this.children; } });
  let fresh;
  el.querySelector = q => (q === '[data-slot="home-main"]' ? (fresh || slot) : null);
  Object.defineProperty(el, 'innerHTML', { set() { fresh = f.doc.createElement('div'); fresh.setAttribute('data-slot', 'home-main'); el.replaceChildren(fresh); } });
  f.host.paintHome(el, '<div data-slot="home-main"></div>');
  assert.equal(node.parentNode, fresh); assert.equal(homes, 1); assert.equal(renders, 0, 'chats render listeners are not woken by Home');
  await f.clear(); f.host.paintHome(el, '<div data-slot="home-main"></div>'); assert.equal(homes, 1, 'no home events after teardown');
});
test("api.on('home') needs layout; data.read.app is trusted-only, GET-only and path-bounded", async () => {
  const f = fixture(); let api; const asked = [];
  f.ctx.fetch = async (url, opts) => { if (String(url).includes('/tweaks/')) return { ok: true, json: async () => JSON.parse(read('web/tweaks/' + String(url).split('/tweaks/')[1].split('?')[0])) }; asked.push([String(url), opts.method, opts.credentials]); return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ backup: { state: 'ok' } }) }; };
  f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  await f.host.loadTweaks(['miguel/machines-home'], f.slots);
  assert.equal(api.data, undefined, 'untrusted authors get no data reads at all');
  await f.host.loadTweaks(['miguel/machines-home'], f.slots, { teamAuthors: ['miguel'] });
  assert.deepEqual(await api.data.read.app('backup', 'overview'), { backup: { state: 'ok' } });
  assert.deepEqual(asked, [['https://wizard.test/backup/api/overview', 'GET', 'same-origin']]);
  for (const [id, path] of [['../x', 'overview'], ['backup', '../../wizard/v1/my-skin'], ['backup', 'a?b=1'], ['Backup', 'overview'], ['backup', '//evil.test/x']]) assert.equal(await api.data.read.app(id, path), null);
  assert.equal(asked.length, 1);
  await f.clear(); assert.equal(await api.data.read.app('backup', 'overview'), null, 'inert after teardown');
  const g = fixture(); let nav;
  g.host._test.setImporter(async () => ({ default: a => { nav = a; return () => {}; } }));
  await g.host.loadTweaks(['miguel/send-and-go'], g.slots);
  assert.throws(() => nav.on('home', () => {}), /home requires layout/);
  await g.clear();
});
test('stock Home markup carries an empty home-main slot that takes no space; core never names the package', () => {
  const app = appSrc(), desk = deskSrc(), host = withSkinHostParts(read('web/core/skin-host.js'));
  // Phone: the real renderHome; desktop: the real homeHtml. The slot is the first thing in Home, empty and hidden.
  const phone = phoneHome(), slot = phone.querySelector('.home > [data-slot="home-main"]');
  assert.ok(slot && slot.hidden && !slot.childNodes.length, 'phone: an empty hidden slot');
  assert.equal(slot, phone.querySelector('.home').firstElementChild); assert.ok(slot.nextElementSibling.matches('nav.home-tools'));
  const d = runRecording(block(desk, '  function homeHtml(i) {') + '\nglobalThis.home = homeHtml;',
    { LIVE: null, OUTBOX: null, APPS: [], APP: {}, C: { workspaceNav: { slot: () => 1 } }, window: { WizConfig: { hm: () => '9:41', dateLabel: () => 'Monday' } }, esc: String });
  const dd = createDocument(); dd.body.innerHTML = d.home(0);
  const ds = dd.querySelector('.home-in > [data-slot="home-main"]');
  assert.ok(ds && ds.hidden && !ds.childNodes.length && ds === dd.querySelector('.home-in').firstElementChild, 'desktop: the same empty hidden slot first');
  assert.doesNotMatch(app + desk, /\.innerHTML = (renderHome|homeHtml)\(/, 'every Home paint goes through paintHome');
  // The package itself shows the hidden slot once its view is inside (the real tweak, the real stylesheet).
  const m = machinesHome(), s = m.slots['home-main'];
  assert.ok(s.querySelector(':scope > .mh-root') || s.firstElementChild.matches('.mh-root'));
  assert.equal(styleOf(s, CSS, 'display'), 'flex'); assert.equal(styleOf(s, CSS, 'flex'), '1 1 auto'); assert.equal(styleOf(s, CSS, 'min-height'), '0');
  s.replaceChildren(); assert.equal(styleOf(s, CSS, 'min-height'), '360px', 'listed but not mounted yet: the loading placeholder holds the place');
  m.doc.documentElement.setAttribute('data-tweaks', ''); assert.equal(styleOf(s, CSS, 'display'), '', 'without the package the slot gets no display, so hidden keeps it out');
  assert.doesNotMatch(app + desk + host + read('web/core/resources.js'), /machines-home/);
  const profile = JSON.parse(read('web/tweaks/miguel/profile.json'));
  assert.ok(profile.tweaks.includes('miguel/machines-home'));
});
test('machines-home: read-only, no owner data in the bundle', async () => {
  const src = read(TWEAK);
  assert.doesNotMatch(src, /method:\s*'(POST|PUT|PATCH|DELETE)'/);
  assert.doesNotMatch(src, /['"`][a-z0-9.-]+\.(com|net|org|io|solutions|ts\.net)\b/i, 'no hostnames');
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), /Miguel|Oscar|HomeServer/, 'no owner names');
  const m = machinesHome({ snapshot: world(), backup: backupOk() }); await m.flush();
  assert.deepEqual(m.calls.reads, [['backup', 'overview']], 'its one read is the Backup app\'s overview');
  // Names come from the owner's registry through the Devices feed.
  const ov = m.page('overview');
  assert.equal(words(ov.querySelector('[data-ws="mine"]')), 'Wiz'); assert.equal(words(ov.querySelector('.mh-person .mh-name')), 'Ann');
  const bare = machinesHome({ snapshot: { devices: { devices: [] }, devicesAt: Date.now() } });
  assert.equal(words(bare.page('overview').querySelector('[data-ws="mine"]')), 'This Wizard'); assert.equal(words(bare.page('overview').querySelector('.mh-person .mh-name')), 'You');
  // Every tap only asks: adding a managed Wizard goes to the shared workspace module, nothing is written here.
  m.tap(ov.querySelector('[data-act="add-managed"]')); assert.equal(m.calls.adds, 1);
  m.tap(ov.querySelector('[data-act="add-device"]'));
  assert.deepEqual(m.calls.asks.map(a => a[0]), ['add-device'], 'adding a device drafts a request to the agent');
  assert.equal(m.calls.reads.length, 1, 'still nothing but the one read');
});
test('api.back.push: newest package overlay closes first on shell Back; released and teardown entries are gone', async () => {
  const f = fixture(); let api; const closed = [];
  f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  await f.host.loadTweaks(['miguel/machines-home'], f.slots, { teamAuthors: ['miguel'] });
  assert.equal(f.host.back(), false, 'nothing open: Back goes on to the shell');
  const r1 = api.back.push(() => closed.push(1)); api.back.push(() => closed.push(2));
  assert.equal(f.host.back(), true); assert.deepEqual(closed, [2]);
  r1(); assert.equal(f.host.back(), false); r1();
  api.back.push(() => closed.push(3)); await f.clear();
  assert.equal(f.host.back(), false, 'teardown removes open entries'); assert.deepEqual(closed, [2]);
  // The open overlay also joins the shell's own Back / Esc stack (the shell adapter's escapeOverlay), and leaves it.
  const g = fixture(), esc = [], left = []; let gapi;
  g.host._test.setImporter(async () => ({ default: a => { gapi = a; return () => {}; } }));
  g.adapter.escapeOverlay = close => { esc.push(close); return () => left.push(close); };
  await g.host.loadTweaks(['miguel/machines-home'], g.slots, { teamAuthors: ['miguel'] });
  const shut = []; const off = gapi.back.push(() => shut.push('x'));
  assert.equal(esc.length, 1, 'the shell holds it'); esc[0](); assert.deepEqual(shut, ['x'], 'the shell\'s Back closes it');
  assert.deepEqual(left, [esc[0]], 'and it leaves the shell stack'); off(); await g.clear();
  // The real adapters: the phone's phoneBack and the desktop's escapeBack take it.
  for (const [where, src, stack] of [['phone', appSrc(), 'phoneBack'], ['desktop', deskSrc(), 'escapeBack']]) {
    const got = [], a = entry(src, 'escapeOverlay:', { [stack]: { push: c => { got.push(c); return 'release'; } } }, ','), close = () => {};
    assert.equal(a.f(close), 'release', where); assert.deepEqual(got, [close], where);
  }
});

test('machines-home: one inline map, the same on every workspace', async () => {
  const src = read(TWEAK);
  assert.doesNotMatch(src, /showModal|'dialog'|mh-panel|mh-sheet|managedCard/, 'no cards, sheets or side panels');
  assert.doesNotMatch(src, /ICONS|ico\(/, 'no icons on the map');
  assert.doesNotMatch(CSS, /mh-orbit|mh-spin|rotate\(360/, 'nothing spins');
  for (const b of ['setTimeout', 'setInterval', 'requestAnimationFrame', 'innerHTML', 'localStorage', 'querySelector']) assert.ok(!src.includes(b), b);
  const m = machinesHome({ snapshot: world(), backup: backupOk({ standby: { machines: [{ id: 'h2', verdict: 'ok' }] } }), sessions: { working: 1, ready: 2 } }); await m.flush();
  const ov = m.page('overview');
  // Main in the middle; by power (h2 16 cores, h1 4, h3 2) the helpers alternate right, left, right; Ann's phone is no helper.
  assert.deepEqual(nodes(m).map(n => n.slice(0, 2)), [['h1', 'helper'], ['this', 'main'], ['h2', 'standby'], ['h3', 'helper']]);
  assert.equal(ov.querySelectorAll('dialog').length, 0);
  // A Wizard you manage: same map, its people expand in place.
  m.setItems(managedItems); m.tap(ov.querySelector('[data-ws="g1"]'));
  assert.deepEqual(ov.querySelectorAll('.mh-person .mh-name').map(words), ['Bea', '2 more']);
  m.tap(ov.querySelector('[data-person="p0"]'));
  assert.equal(words(ov.querySelector('.mh-row.is-devices')), 'Bea’s devices aren’t visible yet');
  m.tap(ov.querySelector('[data-ws="mine"]'));
  // Every account has its nickname field, filled with the current name (not a faint placeholder).
  const nick = m.page('ai').querySelector('input.mh-nick');
  assert.equal(nick.value, 'mig'); assert.equal(nick.dataset.nick, 'claude:mig'); assert.equal(nick.dataset.auto, 'mig');
  assert.doesNotMatch(words(m.root()), /%/, 'no percentage at rest');
  m.tap(ov.querySelector('[data-open="ready"]')); assert.deepEqual(m.calls.opens, ['ready'], 'Main opens your chats');
  assert.match(words(ov.querySelector('.mh-node.is-storage .mh-role')), /^5 GB stored · 2h ago$/);
  assert.equal(styleOf(m.home.querySelector('.constellation'), CSS, 'display'), 'none', 'the stock constellation steps aside');
  // Sessions are a trusted-only part of the package api, and both shells answer it from their live lists.
  const f = fixture(); let api; f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  f.adapter.sessions = () => ({ working: 2, ready: 3 }); const opened = []; f.adapter.openSessions = k => opened.push(k);
  await f.host.loadTweaks(['miguel/machines-home'], f.slots, { teamAuthors: ['miguel'] });
  assert.deepEqual({ ...api.data.read.sessions.counts() }, { working: 2, ready: 3 }); api.data.read.sessions.open('ready'); api.data.read.sessions.open('x'); assert.deepEqual(opened, ['ready']);
  await f.host.loadTweaks(['miguel/machines-home'], f.slots, { manifests: {} }); assert.equal(api.data?.read?.sessions, undefined, 'untrusted: no sessions');
  await f.clear();
  const LIVE = { ok: true, workGroups: () => ({ working: [1, 2] }) };
  for (const [src, scope] of [[appSrc(), { LIVE, window: { WizCore: { workspaceNav: { chatsCount: () => 5 } } } }], [deskSrc(), { LIVE, C: { workspaceNav: { chatsCount: () => 5 } } }]]) {
    const s = entry(src, 'sessions: () => {', scope);
    assert.deepEqual({ ...s.f() }, { working: 2, ready: 5 }); scope.LIVE = { ok: false }; assert.equal(s.f(), null);
  }
});
test('machines-home: simple at rest, more on tap (one AI gauge, storage size, one details toggle)', async () => {
  const src = read(TWEAK);
  assert.doesNotMatch(src, /mh-batt/, 'batteries are gone'); assert.doesNotMatch(src, /Sign in or out/);
  assert.doesNotMatch(src, /'Hide details'|'Show details'/, 'chevron only, no words'); assert.doesNotMatch(src, /Cloudflare app connected/);
  assert.doesNotMatch(CSS, /mh-breathe/, 'Main stays still so the working dots read'); assert.doesNotMatch(CSS, /violet|#7A5CFF/i, 'no violet nodes');
  const providers = [acct('claude:mig', 60), acct('claude:osc', 80), acct('chatgpt:me', 20), credit('tinfoil:t', 400)];
  const m = machinesHome({ snapshot: world({ providers }), provider: 'claude', backup: backupOk(), sessions: { working: 2, ready: 1 } }); await m.flush();
  // One fuel tag for the default model's service: E, ten cells, F; no label, the two Claude accounts combined.
  const gauges = m.root().querySelectorAll('.mh-gauge'); assert.equal(gauges.length, 1);
  assert.deepEqual(gauges[0].children.map(c => c.className), ['mh-g-ef', 'mh-g-cells', 'mh-g-ef']);
  assert.deepEqual([words(gauges[0].children[0]), words(gauges[0].children[2])], ['E', 'F']);
  assert.equal(gauges[0].querySelectorAll('.mh-g-cells > i.on').length, 7, '(60 + 80) / 2 = 70% left: seven of ten cells');
  assert.match(gauges[0].getAttribute('aria-label'), /^AI fuel: 70% left, Claude mig and Claude osc\. Open AI in Settings$/);
  const other = machinesHome({ snapshot: world({ providers }), provider: 'openai' });
  assert.match(other.root().querySelector('.mh-gauge').getAttribute('aria-label'), /20% left, ChatGPT me/, 'the gauge follows the default model');
  // The AI page: Sign out per account opens that app; prepaid services link to add credit; one Sign in, then pick.
  const ai = m.page('ai');
  assert.deepEqual(ai.querySelectorAll('.mh-ai-btn.is-out').map(b => b.dataset.resSignin), ['wizard-claude', 'wizard-claude', 'wizard-chatgpt', 'wizard-tinfoil']);
  assert.deepEqual(ai.querySelectorAll('a.mh-ai-btn.is-link').map(a => [a.getAttribute('href'), words(a)]), [['https://dash.tinfoil.sh/?tab=billing', 'Add credit ↗']]);
  const add = ai.querySelector('[data-toggle="signin"]'); assert.equal(words(add), '+ Sign in to another account');
  add.focus(); m.tap(add);
  assert.deepEqual(ai.querySelectorAll('.mh-ai-pick .mh-ai-btn').map(b => [words(b), b.dataset.resSignin]), [['Claude', 'wizard-claude'], ['ChatGPT', 'wizard-chatgpt'], ['Tinfoil', 'wizard-tinfoil']], 'the picker opens even while the button has focus');
  // The meter picker never mixes kinds: ticking the prepaid account drops the plan accounts.
  m.change(ai.querySelector('[data-meter-id="tinfoil:t"]'), true);
  assert.deepEqual(plain(m.store.get('meter')), ['tinfoil:t'], 'never mix kinds');
  m.change(ai.querySelector('[data-meter-id="chatgpt:me"]'), true); assert.deepEqual(plain(m.store.get('meter')), ['chatgpt:me']);
  // Storage shows how much is stored; the map has one details toggle, shown by default, folding with a class only.
  const ov = m.page('overview'), map = ov.querySelector('.mh-map');
  assert.match(words(ov.querySelector('.mh-node.is-storage')), /5 GB stored/);
  assert.ok(map.classList.contains('is-details'), 'details shown by default');
  const toggles = ov.querySelectorAll('[data-toggle="bars"]'); assert.equal(toggles.length, 1); assert.equal(toggles[0].className, 'mh-details');
  const before = ov.querySelector('.mh-node.is-main'); m.tap(toggles[0]);
  assert.ok(!map.classList.contains('is-details')); assert.equal(m.store.get('details'), 'off'); assert.equal(ov.querySelector('.mh-node.is-main'), before, 'nothing rebuilt');
  const bars = ov.querySelector('.mh-bars');
  assert.equal(styleOf(bars, CSS, 'grid-template-rows'), '0fr'); assert.match(styleOf(bars, CSS, 'transition'), /^grid-template-rows 480ms/, 'details ease open');
  m.tap(toggles[0]); assert.equal(styleOf(bars, CSS, 'grid-template-rows'), '1fr');
  assert.equal(machinesHome({ saved: { details: 'off' } }).page('overview').querySelector('.mh-map').classList.contains('is-details'), false);
  // Main: a dot per chat, no numbers; a bell with the unread count.
  const main = ov.querySelector('.mh-node.is-main');
  assert.deepEqual([main.querySelectorAll('.mh-dots i.work').length, main.querySelectorAll('.mh-dots i.ready').length], [2, 1]);
  assert.doesNotMatch(words(main.querySelector('.mh-sess')), /\d/);
  m.calls.inbox([{ id: 'a' }, { id: 'b', read: true }, { id: 'c' }]); assert.equal(words(ov.querySelector('.mh-node.is-main .mh-bell')), '2');
  // Tapping a helper opens what it can become; a blocked action says why; an allowed one asks the agent.
  const tapH1 = ov.querySelector('[data-machine="h1"]'); m.tap(tapH1);
  const panel = ov.querySelector('.mh-act'); assert.equal(panel.dataset.of, 'h1');
  assert.deepEqual(panel.querySelectorAll('.mh-act-btn').map(b => [words(b.querySelector('b')), b.disabled]), [['Use for storage', false], ['Make standby', true]]);
  assert.match(words(panel.querySelector('.mh-act-why')), /^Can’t be a standby:\s*Wizard is still checking it$/);
  m.tap(panel.querySelector('[data-ask="h1:storage"]'));
  assert.deepEqual(m.calls.asks.at(-1).slice(0, 1).concat(m.calls.asks.at(-1)[2]), ['h1-storage', 'Make h1 a storage device for my backups.']);
  const off = machinesHome({ snapshot: world({}, [dev('this'), dev('h9', { status: 'unreachable', error: 'auth failed' })]) });
  assert.deepEqual(nodes(off).find(n => n[0] === 'h9'), ['h9', 'helper', 'Disconnected']);
});
test('machines-home: calm repaints (last readings first, motion once, parts redraw only when they change)', async () => {
  const m = machinesHome({ snapshot: world(), backup: backupOk({ active: [{ id: 'run' }] }) }); await m.flush();
  assert.equal(m.store.get('backup').active, null, 'last good backup kept without its live running state');
  assert.equal(m.store.get('res'), undefined, 'nothing to keep before a reading arrives');
  m.feed(world());
  assert.deepEqual(m.store.get('res').devices.devices.map(d => d.id), ['this', 'h1', 'h2', 'h3', 'ph'], 'the last good reading is kept');
  // The next visit paints that reading at once, before the feed answers.
  const next = machinesHome({ saved: { res: m.store.get('res'), backup: m.store.get('backup') } });
  assert.deepEqual(nodes(next).map(n => n[0]), ['h1', 'this', 'h2', 'h3']);
  assert.match(words(next.page('overview').querySelector('.mh-node.is-storage')), /5 GB stored/);
  // Entry motion: only the first paint carries mh-new, and only mh-new animates.
  const first = next.page('overview').querySelector('.mh-node.is-main');
  assert.ok(first.classList.contains('mh-new')); assert.match(styleOf(first, CSS, 'animation'), /^mh-in 380ms/);
  next.feed({ ...world(), devices: { ...world().devices, devices: [dev('this'), dev('h1', { cpus: 4, memory: 90 })] } });
  const again = next.page('overview').querySelector('.mh-node.is-main');
  assert.notEqual(again, first, 'a changed reading redraws the map'); assert.ok(!again.classList.contains('mh-new')); assert.equal(styleOf(again, CSS, 'animation'), '');
  // Wires stay put while nothing moved; a moved box redraws them.
  next.draw(); const lines = next.page('overview').querySelector('svg.mh-lines'), wire = lines.firstChild; assert.ok(wire);
  next.api.frame(() => {}); next.frames.length = 0; next.fire('home'); next.draw(); assert.equal(lines.firstChild, wire, 'same layout: wires untouched');
  next.fire('home'); next.draw(() => ({ left: 0, top: 0, right: 120, bottom: 20, width: 120, height: 20 })); assert.notEqual(lines.firstChild, wire, 'moved: redrawn');
  // A nickname being typed is never rebuilt under the finger.
  const nick = next.page('ai').querySelector('input.mh-nick') || (next.feed(world()), next.page('ai').querySelector('input.mh-nick'));
  nick.focus(); next.feed(world({ providers: [acct('claude:mig', 40)] }));
  assert.equal(next.page('ai').querySelector('input.mh-nick'), nick);
  next.doc.activeElement = next.doc.body; next.feed(world({ providers: [acct('claude:mig', 30)] }));
  assert.notEqual(next.page('ai').querySelector('input.mh-nick'), nick, 'rebuilt once the field is left');
  // Stock Home is hidden as soon as the package is listed (before it mounts).
  for (const sel of ['.home-top']) assert.equal(styleOf(m.home.querySelector(sel), CSS, 'display'), 'none', sel);
  m.doc.documentElement.setAttribute('data-tweaks', ''); assert.equal(styleOf(m.home.querySelector('.home-top'), CSS, 'display'), '');
});
test('tweak stylesheets are listed and loaded from the first frame; reapplying keeps them; a failed package drops out', async () => {
  // New links before old ones go: a package being replaced tears down with the next one's stylesheet already listed.
  const r = fixture(), seenAtTeardown = [];
  r.host._test.setImporter(async () => ({ default: () => () => seenAtTeardown.push(r.doc.head.children.map(l => String(l.href).split('/tweaks/')[1])) }));
  await r.host.loadTweaks(['miguel/machines-home'], r.slots, { teamAuthors: ['miguel'] });
  await r.host.loadTweaks(['miguel/archive-top'], r.slots, { teamAuthors: ['miguel'] });
  assert.equal(seenAtTeardown.length, 1); assert.ok(seenAtTeardown[0].includes('miguel/archive-top/tweak.css'), 'new links before old ones go');
  await r.clear();
  const f = fixture();
  await f.host.loadTweaks(['miguel/machines-home'], f.slots, { teamAuthors: ['miguel'] });
  assert.ok(f.doc.documentElement.dataset.tweaks.includes('miguel/machines-home'));
  const links = f.doc.head.children.filter(l => String(l.href).includes('machines-home/tweak.css'));
  assert.equal(links.length, 1, 'one stylesheet'); assert.equal(links[0].attrs.blocking, 'render', 'listed render-blocking, from the first frame');
  assert.deepEqual(JSON.parse(f.ctx.localStorage.getItem('wos.tweaks.expect')), ['miguel/machines-home']);
  await f.host.loadTweaks(['miguel/machines-home'], f.slots, { teamAuthors: ['miguel'] });
  assert.equal(f.doc.head.children.filter(l => String(l.href).includes('machines-home/tweak.css')).length, 1, 'reapplying swaps, never doubles');
  await f.clear();
  assert.equal(f.doc.documentElement.dataset.tweaks, ''); assert.equal(f.doc.head.children.length, 0);
  assert.deepEqual(JSON.parse(f.ctx.localStorage.getItem('wos.tweaks.expect')), []);
});
test('paintHome with unchanged markup leaves a mounted view in place (no detach, no restarted motion)', async () => {
  const f = fixture(); let api, homes = 0, writes = 0;
  f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  await f.host.loadTweaks(['miguel/machines-home'], f.slots, { teamAuthors: ['miguel'] });
  api.on('home', () => homes++);
  const el = f.doc.createElement('div'); let slot = f.doc.createElement('div'); slot.setAttribute('data-slot', 'home-main');
  Object.defineProperty(slot, 'childNodes', { get() { return this.children; } });
  el.querySelector = q => (q === '[data-slot="home-main"]' ? slot : null);
  Object.defineProperty(el, 'innerHTML', { set() { writes++; slot = f.doc.createElement('div'); slot.setAttribute('data-slot', 'home-main'); Object.defineProperty(slot, 'childNodes', { get() { return this.children; } }); el.replaceChildren(slot); } });
  f.host.paintHome(el, '<div data-slot="home-main"></div>');
  const node = f.doc.createElement('section'); slot.append(node);
  f.host.paintHome(el, '<div data-slot="home-main"></div>');
  assert.equal(writes, 1, 'same markup with a mounted view: no rewrite'); assert.equal(node.parentNode, slot); assert.equal(homes, 2);
  f.host.paintHome(el, '<div data-slot="home-main"></div><p></p>');
  assert.equal(writes, 2, 'new markup is written'); assert.equal(node.parentNode, slot, 'and the view moves along');
  await f.clear();
});

test('api.nav.ask: trusted only, namespaced home: key, sends through the shell contextDraft', async () => {
  const f = fixture(); let api;
  f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  await f.host.loadTweaks(['miguel/machines-home'], f.slots, { teamAuthors: ['miguel'] });
  assert.equal(api.nav.ask('helper-standby', { title: 'Cloud server · Make standby', message: 'checks' }, 'Make Cloud server my standby device.'), true);
  assert.deepEqual(f.inbox.replies.at(-1), ['home:helper-standby', '', 'Make Cloud server my standby device.'], 'lands as an unsent draft');
  api.nav.ask('now', {}, 'Back up now.', { send: true }); assert.deepEqual(f.inbox.replies.at(-1), ['home:now', 'Back up now.'], 'send: true sends');
  assert.equal(api.nav.ask('../x', {}, ''), true); assert.equal(f.inbox.replies.at(-1)[0], 'home:x', 'unsafe characters are dropped');
  await f.loadTweaks?.(); await f.host.loadTweaks(['miguel/machines-home'], f.slots);
  assert.throws(() => api.nav.ask('a', {}, ''), /Trusted navigation required|Cannot read/);
  await f.clear();
});

test('Home buttons that ask the agent open Chats with the draft even when no Chats window is on this desk', () => {
  const cases = [['phone', appSrc(), {}], ['desktop', deskSrc(), { homeOpen: false }], ['desktop over Home', deskSrc(), { homeOpen: true }]];
  for (const [name, src, extra] of cases) {
    let wins = name === 'desktop' ? [{ id: 'old' }] : [];
    const s = entry(src, 'contextDraft: (key, item, words, draft) => {', { ...extra, skinChatsWin: () => wins[0] || null, openChatsList: () => { wins = [{ id: 'c1' }]; } });
    if (name === 'desktop over Home') wins = [{ id: 'behind' }];
    assert.equal(s.f('home:now', { title: 'Back up' }, '', 'Back up now.'), true, name);
    const draft = s.calls.find(c => c[0] === 'CHATS.openContextDraft');
    assert.ok(draft, name + ': the draft lands in Chats');
    assert.equal(draft[1], name === 'desktop' ? 'old' : 'c1', name + (name === 'phone' ? ': Home opens Chats first' : name === 'desktop' ? ': an open Chats window is used' : ': Home and the Settings panel open Chats first'));
    assert.deepEqual(draft.slice(2), ['home:now', { title: 'Back up' }, 'Back up now.']);
  }
});
test('Settings › Network & security fills even before Home has been shown', async () => {
  // Before any reading: a loading mark, never a blank page; a failed read says so.
  const m = machinesHome();
  const wait = m.page('network').querySelector('.mh-wait'); assert.ok(wait); assert.equal(wait.getAttribute('role'), 'status');
  m.feed({ devicesError: 'timeout' });
  assert.equal(words(m.page('network')), 'Couldn’t read your network just now. It will try again.');
  // The host puts the page's node into Settings and keeps its readings fresh while it is shown.
  const f = fixture(); let api; f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  const reg = [], watched = []; f.ctx.window.WosSettings = { register: spec => { reg.push(spec); return () => {}; } }; f.ctx.window.WosResources.watch = el => watched.push(el);
  await f.host.loadTweaks(['miguel/machines-home'], f.slots, { teamAuthors: ['miguel'] });
  const node = f.doc.createElement('div'); api.settings.section('net', 'network', node);
  const slot = f.doc.createElement('div'), el = f.doc.createElement('div'); el.append(slot); el.firstElementChild = slot;
  reg[0].painted({}, el); assert.equal(node.parentNode, slot); assert.deepEqual(watched, [node], 'a shown System page keeps readings fresh');
  await f.clear();
  // resources.js counts a watched page as viewing only while it is on screen.
  const ctx = { document: { documentElement: { dataset: { tweaks: '' } }, hidden: false, addEventListener() {}, querySelectorAll: () => [] }, localStorage: { getItem: () => null, setItem() {} },
    queueMicrotask() {}, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, AbortController, console, Set, Map, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } }, fetch: () => new Promise(() => {}) };
  ctx.window = ctx; ctx.addEventListener = () => {}; ctx.dispatchEvent = () => true; ctx.WosChat = { esc: s => String(s ?? '') };
  const visible = { v: 'visible' }; ctx.getComputedStyle = () => ({ visibility: visible.v });
  vm.runInNewContext(read('web/core/usage.js'), ctx);
  const res = read('web/core/resources.js');
  vm.runInNewContext(res.replace('window.WosResources={', 'globalThis.__viewing=viewing;window.WosResources={'), ctx);
  const page = { isConnected: true, rects: [1], getClientRects() { return this.rects; } };
  ctx.WosResources.watch(page);
  const viewing = ctx.__viewing;
  assert.equal(!!viewing(), true, 'shown: viewing');
  page.rects = []; assert.equal(!!viewing(), false, 'display:none (no boxes): not viewing');
  page.rects = [1]; visible.v = 'hidden'; assert.equal(!!viewing(), false, 'visibility hidden: not viewing');
});
test('review fixes: one Home map at a time, boot guess expires, unreadable usage is not "signed out"', async () => {
  const exp = read('web/core/experience.js'), host = withSkinHostParts(read('web/core/skin-host.js'));
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  // James, 31 Oct 2026: the network Home is Miguel's alone; no stock copy, nothing on by default for every skin.
  assert.equal(cat.oneOf, undefined, 'no stock Home map to choose between');
  assert.ok(!cat.defaults.some(id => id.endsWith('/machines-home')), 'the network Home is never a release-wide default');
  assert.ok(!cat.tweaks.includes('wizard/machines-home') && cat.tweaks.includes('miguel/machines-home'));
  // The oneOf mechanism stays for any later pair of packages that fill the same place.
  const group = { oneOf: [['miguel/machines-home', 'wizard/machines-home']] };
  // Phone: unchanged rule. Desktop: a standard layout view is worn by the shell itself, never loaded as a tweak.
  // The real experience.js loads one member of the group even when both are on.
  const both = await groupedDevice({ 'wizard/machines-home': true, 'miguel/machines-home': true });
  assert.deepEqual(both.active().filter(id => id.endsWith('/machines-home')), ['miguel/machines-home'], 'one Home map loads');
  const src1 = 'return ' + exp.match(/const oneOf = (\(ids, own = recipe\(\)\) => .*);\n/)[1];
  const make = (offs = [], recipeOff = []) => new Function('catalog', 'recipe', 'recipeChoice', 'offFor', 'owner', 'globalOff', src1)(group, () => null, (own, id) => recipeOff.includes(id) ? false : undefined, () => offs, 'miguel', () => false);
  const pick = make();  // the shipped function
  assert.deepEqual(make([], ['miguel/machines-home'])(['wizard/machines-home', 'x/y']), ['x/y'], 'a My skin off for the owner package keeps the stock one off too');
  assert.deepEqual(make(['miguel/machines-home'])(['wizard/machines-home']), [], 'a saved off does too');
  assert.deepEqual(pick(['wizard/machines-home', 'miguel/machines-home', 'x/y']), ['miguel/machines-home', 'x/y']);
  assert.deepEqual(pick(['wizard/machines-home']), ['wizard/machines-home']);
  // The boot guess (last time's packages, styled from the first frame) expires after 20 s unless the real list came.
  const guessed = { 'wos.tweaks.expect': JSON.stringify(['miguel/machines-home']) }, css = g => g.doc.head.children.map(l => String(l.href)).filter(h => h.includes('machines-home/tweak.css')).length;
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const never = fixture({ initialStorage: guessed });
    assert.equal(css(never), 1, 'guessed: styled from the first frame'); assert.match(never.doc.documentElement.dataset.tweaks, /miguel\/machines-home/);
    mock.timers.tick(20000);
    assert.equal(css(never), 0, 'a boot that never loads drops the guessed styles'); assert.doesNotMatch(never.doc.documentElement.dataset.tweaks || '', /machines-home/);
    const asked = fixture({ initialStorage: guessed });
    asked.host._test.setImporter(async () => ({ default: () => () => {} }));
    const loading = asked.host.loadTweaks(['miguel/machines-home'], asked.slots, { teamAuthors: ['miguel'] });
    mock.timers.tick(20000); await loading;
    assert.equal(css(asked), 1, 'the real list marks the boot guess settled');
  } finally { mock.timers.reset(); }
  /*PB-BLOCK1*/
});

test('second review: no unverified all-clear, stock loading state, Settings dialog keeps focus, Back closes the mic menu', async () => {
  const clear = (more = {}) => world({}, [dev('this', { access: { exposure: 'tailscale', checked: '2026-10-01' } }), dev('h1', { access: { exposure: 'tailscale', checked: '2026-10-02' } }), ...(more.devs || [])]);
  const ok = machinesHome({ snapshot: clear() });
  assert.match(words(ok.page('network')), /Nothing answers from the internet\. Tailscale is the only way in\./, 'all-clear when every machine was checked');
  const part = machinesHome({ snapshot: clear({ devs: [dev('h2')] }) });
  assert.match(words(part.page('network')), /Not every machine has been checked from the internet yet/);
  const old = machinesHome({ snapshot: { ...clear(), devicesAt: Date.now() - 10 * 60e3 } });
  assert.doesNotMatch(words(old.page('network')), /Nothing answers/, 'only from a fresh reading');
  assert.match(words(old.page('network')), /This is the last reading/);
  old.feed({ ...clear(), devicesAt: Date.now() }); assert.match(words(old.page('network')), /Nothing answers/);
  old.feed({ devicesError: 'timeout' }); assert.doesNotMatch(words(old.page('network')), /Nothing answers/, 'a failed read takes the all-clear back');
  // Backing up now only from a reading this visit; the saved copy never carries the running state.
  const saved = machinesHome({ snapshot: world(), saved: { backup: { ...backupOk(), active: [{ id: 'r' }] } }, backup: null }); await saved.flush();
  assert.doesNotMatch(words(saved.page('storage')), /Backing up now/);
  const live = machinesHome({ snapshot: world(), backup: backupOk({ active: [{ id: 'r' }] }) }); await live.flush();
  assert.match(words(live.page('storage')), /Backing up now/); assert.equal(live.store.get('backup').active, null);
  // Loading mark on the Security page.
  assert.ok(machinesHome().page('network').querySelector('.mh-wait[role="status"]'));
  // Desktop: Tab stays inside the Home Settings dialog.
  const desk = deskSrc(); let onKey;
  const setEl = createDocument(); setEl.body.innerHTML = '<button id="a"></button><button id="b"></button>';
  const [a, b] = setEl.body.querySelectorAll('button'); for (const x of [a, b]) x.getClientRects = () => [1];
  const scope = { settingsModal: true, setEl: setEl.body, document: { addEventListener: (t, f) => { if (t === 'keydown') onKey = f; }, get activeElement() { return setEl.activeElement; } } };
  runRecording(between(desk, "  document.addEventListener('keydown', e => {\n    if (!settingsModal", '  function closeSettings()'), scope);
  let prevented = 0; const key = (k, shiftKey = false) => onKey({ key: k, shiftKey, preventDefault: () => prevented++ });
  b.focus(); key('Tab'); assert.equal(setEl.activeElement, a, 'Tab from the last control wraps to the first');
  key('Tab', true); assert.equal(setEl.activeElement, b, 'Shift+Tab from the first wraps to the last');
  scope.settingsModal = false; a.focus(); key('Tab', true); assert.equal(setEl.activeElement, a, 'no dialog: Tab is the browser\'s'); assert.equal(prevented, 2);
  // Esc / Back: the voice menu and the palette take part in the shared recency stack.
  const watched = {}; let closed = 0;
  runRecording(between(desk, "  watchEscape('palette'", "  watchEscape('usage'"), { watchEscape: (id, open, close) => { watched[id] = { open, close }; }, voiceMenu: { hidden: false }, pal: { hidden: true }, closeVoiceMenu: () => closed++ });
  assert.deepEqual(Object.keys(watched), ['palette', 'voice-menu']);
  assert.equal(watched['voice-menu'].open(), true); assert.equal(watched.palette.open(), false); watched['voice-menu'].close(); assert.equal(closed, 1);
});
test('third review: AI page offers sign-in with no accounts, backup read failure is not "no backup", tab label never claims an unchecked all-clear', async () => {
  const none = machinesHome({ snapshot: world({ providers: [] }) });
  assert.equal(words(none.page('ai').querySelector('.mh-ai-foot .mh-more-info')), 'No AI account signed in yet.');
  assert.deepEqual(none.page('ai').querySelectorAll('.mh-ai-pick .mh-ai-btn').map(b => b.dataset.resSignin), ['wizard-claude', 'wizard-chatgpt', 'wizard-tinfoil']);
  // Backup: a real empty answer clears the old copy; a failed read keeps it and says so; retention comes from Backup.
  const empty = machinesHome({ snapshot: world(), saved: { backup: backupOk() }, backup: {} }); await empty.flush();
  assert.equal(words(empty.page('storage')), 'No backup set up yet.'); assert.equal(empty.store.get('backup'), null);
  const failed = machinesHome({ snapshot: world(), backup: null }); await failed.flush();
  assert.equal(words(failed.page('storage')), 'Couldn’t reach Backup right now. It will try again.', 'a failed read is not "no backup"');
  const ok = machinesHome({ snapshot: world(), backup: backupOk() }); await ok.flush();
  assert.match(words(ok.page('storage')), /Older backups thin out: daily for 7 days, weekly for 4 weeks and monthly for 6 months/);
  const one = machinesHome({ snapshot: world(), backup: backupOk({ backup: { ...backupOk().backup, retention: { daily: 1 } } }) }); await one.flush();
  assert.match(words(one.page('storage')), /Older backups thin out: daily for 1 day(?! and)/);
  // The Tailscale tab: "the only way in" only after every machine was checked.
  const tab = m => { m.draw(); return m.page('overview').querySelector('.mh-ts-tab').getAttribute('aria-label'); };
  assert.equal(tab(machinesHome({ snapshot: world({}, [dev('this'), dev('h1', { access: { exposure: 'tailscale', checked: '2026-10-02' } })]) })), 'Tailscale, not every machine checked yet. Show details');
  assert.equal(tab(machinesHome({ snapshot: world({}, [dev('this', { access: { exposure: 'tailscale', checked: '2026-10-01' } })]) })), 'Tailscale, the only way in. Show details');
  // The tab's words: no count (and never the word "null") when nothing is open, the count when something is (#1722).
  const tabText = m => { m.draw(); return words(m.page('overview').querySelector('.mh-ts-tab')); };
  assert.equal(tabText(machinesHome({ snapshot: world({}, [dev('this', { access: { exposure: 'tailscale', checked: '2026-10-01' } }), dev('h1', { access: { exposure: 'tailscale', checked: '2026-10-01' } })]) })), 'Tailscale');
  assert.equal(tabText(machinesHome({ snapshot: world({}, [dev('this'), dev('h1')]) })), 'Tailscale');
  assert.equal(tabText(machinesHome({ snapshot: world({}, [dev('this'), dev('h1', { access: { exposure: 'internet', details: ['ssh open'] } })]) })), 'Tailscale1 open');
});
test('fourth review: sign-in state survives normalisation, managed workspaces get honest System pages, Dictate keeps its field through the mic menu', () => {
  const norm = usage();
  const [grp] = norm([{ id: 'claude', name: 'Claude', status: 'ok', accounts: [{ id: 'claude:a', status: 'signed_out', limits: [{ label: 'Weekly', remainingPercent: 50 }] }] }]);
  assert.equal(grp.signedOut, true, 'a child sign-out survives normalisation'); assert.equal(grp.status, 'unavailable');
  const kids = norm([{ id: 'claude', name: 'Claude', status: 'ok', signedOut: true, accounts: [{ id: 'claude:a', status: 'ok' }, { id: 'claude:b', status: 'ok' }] }]);
  assert.deepEqual(kids.map(p => p.signedOut), [true, true], 'a group sign-out reaches its accounts');
  assert.equal(norm([{ id: 'x', status: 'reauth', limits: [] }])[0].signedOut, true);
  // The package shows the signed-out account as Signed out with a Sign in, never a reading.
  const m = machinesHome({ snapshot: world({ providers: [acct('claude:mig', 60, { signedOut: true, status: 'unavailable' })] }) });
  const row = m.page('ai').querySelector('.mh-ai-row');
  assert.equal(words(row.querySelector('.mh-ai-txt')), 'Signed out'); assert.equal(words(row.querySelector('.mh-ai-btn.is-in')), 'Sign in');
  // A managed workspace: honest System pages.
  const g = machinesHome({ snapshot: world(), managed: managedItems, saved: { ws: 'g1' } });
  assert.equal(words(g.page('network')), 'Security for Carlos’s Wizard shows on that Wizard. Switch back to yours to see your own.');
  assert.equal(words(g.page('storage')), 'Backups for Carlos’s Wizard show on that Wizard. Switch back to yours to see your own.');
  // Desktop: the one-mic menu counts as the dictation controls, so Dictate keeps its field.
  const s = entry(deskSrc(), 'controls: el =>', {}, '  // the one-mic menu');
  const d = createDocument(); d.body.innerHTML = '<div class="voice-menu"><button id="x"></button></div><button id="micBtn"></button><input id="field">';
  assert.equal(s.f(d.querySelector('#x')), true); assert.equal(s.f(d.querySelector('#micBtn')), true); assert.equal(s.f(d.querySelector('#field')), false); assert.equal(s.f(null), false);
});
test('fifth review: System pages open by deep link; phone Ready opens the unfiltered list', () => {
  const w = settingsWorld(), opened = [];
  assert.deepEqual([...w.W.systemPages], ['overview', 'ai', 'network', 'storage'], '?view=network is a page the shell accepts');
  assert.equal(w.W.route('nonsense-page', v => opened.push(v)), false);
  w.fill('network'); assert.equal(w.W.route('network', v => opened.push(v)), true); assert.deepEqual(opened, ['network'], 'a filled page opens at once');
  assert.equal(w.W.route('storage', v => opened.push(v)), true); assert.deepEqual(opened, ['network'], 'a link that arrives before the package waits');
  w.fill('storage'); w.tick(); assert.deepEqual(opened, ['network', 'storage']);
  const calls = [];
  const f = runRecording('this.f = ' + between(appSrc(), 'openSessions: kind =>', ',  // Ready').slice('openSessions:'.length) + ';', { openChatsFiltered: (...a) => calls.push(['filtered', ...plain(a)]), openChatsList: () => calls.push(['list']) });
  f.f('ready'); f.f('working'); assert.deepEqual(calls, [['list'], ['filtered', 'working', { card: true }]], 'Ready opens the whole list, Working its filter');
});
test('sixth review: stale AI and backup readings say so; the AI page is scoped on managed workspaces', async () => {
  const stale = machinesHome({ snapshot: world({ providers: [acct('claude:mig', 60, { status: 'stale' })] }), provider: 'claude' });
  assert.match(words(stale.page('ai').querySelector('.mh-ai-txt')), /^60% left · last reading$/);
  const g = stale.root().querySelector('.mh-gauge');
  assert.match(g.getAttribute('aria-label'), /60% left \(last reading; couldn’t refresh\)/, 'the gauge says it is a last reading');
  assert.ok(g.classList.contains('is-stale')); assert.equal(styleOf(g.querySelector('.mh-g-cells'), CSS, 'opacity'), '.55');
  assert.equal(styleOf(machinesHome({ snapshot: world() }).root().querySelector('.mh-g-cells'), CSS, 'opacity'), '', 'a live gauge is not faded');
  assert.equal(words(stale.page('ai').querySelector(':scope > .mh-more-info') || stale.page('ai').querySelector('.mh-more-info')), 'Couldn’t refresh AI usage just now. These are the last readings.');
  const savedOnly = machinesHome({ saved: { res: world() } });
  assert.match(savedOnly.root().querySelector('.mh-gauge').getAttribute('aria-label'), /\(last reading; refreshing\)/, 'a saved reading is refreshing');
  // Unavailable rows stay out of the meter.
  const mix = machinesHome({ snapshot: world({ providers: [acct('claude:a', 90), acct('claude:b', 10, { status: 'unavailable' })] }), provider: 'claude' });
  assert.match(mix.root().querySelector('.mh-gauge').getAttribute('aria-label'), /90% left, Claude a\./);
  // Managed workspace: the AI page is scoped; subtitles quiet on all four System pages.
  const mg = machinesHome({ snapshot: world({ state: { devices: { ...world().devices, devices: [dev('this', { access: { exposure: 'internet' } })] } } }), managed: managedItems, saved: { ws: 'g1' } });
  assert.equal(words(mg.page('ai')), 'AI accounts for Carlos’s Wizard show on that Wizard. Switch back to yours to see your own.');
  assert.deepEqual(['overview', 'ai', 'network', 'storage'].map(mg.sub), ['', '', '', '']);
  const mine = machinesHome({ snapshot: world({ state: { devices: { ...world().devices, devices: [dev('this', { access: { exposure: 'internet' } })] } } }), managed: managedItems, backup: backupOk() }); await mine.flush();
  assert.deepEqual(['overview', 'ai', 'network', 'storage'].map(mine.sub), ['1 open', '70% left', '1 open to internet', '2h ago']);
  // Backup: a failed read after a saved copy shows that copy and says so.
  const b = machinesHome({ snapshot: world(), saved: { backup: backupOk() }, backup: null }); await b.flush();
  assert.match(words(b.page('storage')), /5 GB stored.*Couldn’t reach Backup just now\. This is the last reading\.$/);
});
test('seventh review: one switch per Home map group; desktop Ready leaves the open thread', async () => {
  const d = await groupedDevice();
  assert.deepEqual(d.rows(), [['miguel/machines-home', false]], 'Settings lists one switch per group (never a release default)');
  await d.E.toggle('miguel/machines-home'); await d.E.refresh();
  assert.deepEqual(d.rows(), [['miguel/machines-home', true]], 'and it shows what actually loads'); assert.deepEqual(d.active().filter(id => id.endsWith('/machines-home')), ['miguel/machines-home']);
  await d.E.toggle('miguel/machines-home'); await d.E.refresh();
  assert.deepEqual(d.rows(), [['miguel/machines-home', false]]); assert.ok(!d.active().some(id => id.endsWith('/machines-home')));
  await d.E.toggle('miguel/machines-home'); await d.E.refresh();
  assert.deepEqual(d.rows(), [['miguel/machines-home', true]], 'one tap back on'); assert.ok(d.active().includes('miguel/machines-home'));
  assert.deepEqual(plain(d.E.groups()), [['miguel/machines-home', 'wizard/machines-home']]);
  // Desktop Ready: out of an open thread, filter cleared; Working: the Working filter.
  for (const [kind, thread, want] of [['ready', 's1', [['CHATS.chatsBack'], ['syncChatsPane', 'c1'], ['CHATS.setFilter', '']]], ['ready', null, [['CHATS.setFilter', '']]], ['working', 's1', [['CHATS.setFilter', 'working']]]]) {
    const w = { id: 'c1', app: 'chats', thread };
    const s = entry(deskSrc(), 'openSessions: kind => {', { ws: [{ wins: ['c1'] }], cur: 0, W: { c1: w }, openApp() {}, APP: {} });
    s.calls.length = 0; s.f(kind);
    assert.deepEqual(s.calls.filter(c => c[0] !== 'openApp').map(c => [c[0], ...c.slice(1).filter(x => x !== w)]), want, kind + ' ' + thread);
  }
});
test('eighth review: only stamped assets are immutable; a child sign-out survives a stale group', () => {
  const ng = nginxShell();
  try {
    const cc = (uri, args = '') => ng.request({ uri, args }).header('Cache-Control').join();
    assert.equal(cc('/wizard-os-home/app.js', 'v=abcdef123456'), 'public, max-age=31536000, immutable', 'a stamped asset is kept');
    assert.equal(cc('/wizard-os-home/sw.js', 'v=abcdef123456'), 'no-cache', 'sw.js stays no-cache even with ?v=');
    assert.equal(cc('/wizard-os-home/index.html', 'v=abcdef123456'), 'no-cache', 'pages too');
    assert.equal(cc('/wizard-os-home/app.js', 'v=x'), 'no-cache', 'no blanket ?v= rule'); assert.equal(cc('/wizard-os-home/app.js'), 'no-cache');
    assert.equal(cc('/wizard-os-home/nope.js', 'v=abcdef123456'), 'no-store', 'errors are never kept');
  } finally { ng.done(); }
  // The shell page's no-store with a boundary token is covered by tests/shell-token.test.mjs 'nginx: off renders no token and no sub_filter; on fills it for a top-level page load only, never stored'.
  const [kid, sib] = usage()([{ id: 'claude', name: 'Claude', status: 'stale', accounts: [{ id: 'claude:a', status: 'signed_out' }, { id: 'claude:b', status: 'ok', limits: [{ label: 'Weekly', remainingPercent: 40 }] }] }]);
  assert.equal(kid.signedOut, true, 'a child sign-out survives a stale group'); assert.equal(sib.status, 'stale', 'its sibling takes the group\'s stale');
});
test('ninth review: failed first reads say so (AI accounts, network); availability changes repaint', () => {
  const m = machinesHome({ snapshot: { aiError: 'timeout', devicesError: 'timeout' } });
  assert.equal(words(m.page('ai')), 'Couldn’t read your AI accounts just now. It will try again.');
  assert.equal(words(m.page('network')), 'Couldn’t read your network just now. It will try again.');
  assert.equal(words(m.page('overview').querySelector('.mh-row.is-machines')), 'Couldn’t read your network just now. It will try again.');
  // Availability alone changes what shows: the same numbers, now unavailable, repaint the row and the gauge.
  const a = machinesHome({ snapshot: world({ providers: [acct('claude:mig', 60), acct('claude:osc', 40)] }), provider: 'claude' });
  a.feed(world({ providers: [acct('claude:mig', 60), acct('claude:osc', 40, { status: 'unavailable' })] }));
  assert.deepEqual(a.page('ai').querySelectorAll('.mh-ai-txt').map(words), ['60% left', 'Usage unavailable']);
  assert.match(a.root().querySelector('.mh-gauge').getAttribute('aria-label'), /60% left, Claude mig\./);
  // A machine whose error changes repaints its label too.
  const d = machinesHome({ snapshot: world({}, [dev('this'), dev('h9', { status: 'offline' })]) });
  d.feed(world({}, [dev('this'), dev('h9', { status: 'offline', error: 'permission denied' })]));
  assert.equal(nodes(d).find(n => n[0] === 'h9')[2], 'Disconnected');
});
test('tenth review: Miguel\'s Home opens Settings as the panel; the glance counts only this Wizard\'s people', () => {
  // The desktop side (from Home it is always the centred panel; the desk window gets its panel back) is covered by
  // tests/settings-host-width.test.mjs 'a Home modal is not demoted when the modal-only view leaves' and 'leaving AI apps restores a promoted desk window without hiding/remounting Look'.
  const m = machinesHome({ snapshot: world(), managed: managedItems, saved: { ws: 'g1' } });
  assert.equal(words(m.page('overview').querySelector('[aria-selected="true"]')), 'Carlos', 'Your network shows Carlos\'s Wizard');
  assert.match(m.glance().querySelector('[data-go="overview"]').getAttribute('title'), /^4 machines · 1 person$/, 'the glance counts only this Wizard\'s people');
});
test('eleventh review: the Home map keeps one shared store; a cancelled hold never swallows the next mic click', async () => {
  const f = fixture(); const apis = {};
  f.host._test.setImporter(async url => ({ default: a => { apis.m = a; return () => {}; } }));
  await f.host.loadTweaks(['miguel/machines-home'], f.slots, { teamAuthors: ['miguel', 'wizard'] });
  apis.m.storage.set('ws', 'mine-x');
  await f.host.loadTweaks(['miguel/machines-home'], f.slots, { teamAuthors: ['miguel', 'wizard'] });
  assert.equal(apis.m.storage.get('ws'), 'mine-x', 'reloading keeps the choice');
  assert.equal(JSON.parse(f.lsMap.get('wos.skin.shared:machines-home.ws')), 'mine-x', 'kept in the one shared machines-home store (its manifest storage)');
  // A device that wore the retired stock copy (wizard/machines-home) keeps those choices in Miguel's package.
  f.lsMap.set('wos.skin.wizard/machines-home.nick', JSON.stringify({ a: 'old' }));
  assert.equal(JSON.stringify(apis.m.storage.get('nick')), '{"a":"old"}', 'a copy kept by the retired stock package is found');
  await f.clear?.();
  // The desktop mic's hold (real desktop-voicemenu.js): a hold that opened the menu swallows its own click, but a
  // hold cancelled (pointer left / cancelled) never swallows the next click.
  const press = () => {
    const on = {}, timers = [], menu = { hidden: true, style: {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
    const mic = { addEventListener: (t, fn) => { (on[t] ||= []).push(fn); }, setAttribute() {}, getBoundingClientRect: () => ({ bottom: 0, right: 0 }) };
    const w = { WizCore: {} };
    vm.runInNewContext(read('web/desktop/desktop-voicemenu.js'), { window: w, setTimeout: fn => (timers.push(fn), timers.length), clearTimeout: id => { timers[id - 1] = null; }, innerWidth: 1200, document: { addEventListener() {}, removeEventListener() {}, getElementById: () => null } });
    w.WizCore.desktopParts.voicemenu({ mic, voiceMenu: menu, closeVoiceMenu() {}, fields: () => ({}), toast() {} });
    const fire = (t, extra = {}) => { const e = { button: 0, preventDefault() { e.prevented = true; }, stopImmediatePropagation() { e.stopped = true; }, ...extra }; (on[t] || []).forEach(fn => fn(e)); return e; };
    return { timers, menu, fire };
  };
  for (const [end, swallowed] of [[null, true], ['pointerleave', false], ['pointercancel', false]]) {
    const m = press(); m.fire('pointerdown'); m.timers.forEach(fn => fn?.());
    assert.equal(m.menu.hidden, false, 'the hold opened the menu');
    if (end) m.fire(end);
    assert.equal(!!m.fire('click').stopped, swallowed, end ? `${end}: the next mic click goes through` : 'the hold\'s own click is swallowed');
  }
  const quick = press(); quick.fire('pointerdown'); quick.fire('pointerup'); quick.timers.forEach(fn => fn?.());
  assert.equal(quick.menu.hidden, true, 'a short press opens no menu'); assert.equal(!!quick.fire('click').stopped, false);
});

test('twelfth review: unread chat counts are unknown, not zero', () => {
  const m = machinesHome({ snapshot: world(), sessions: null });
  assert.match(m.page('overview').querySelector('[data-open="ready"]').getAttribute('aria-label'), /^Main Box: chats not loaded yet\. Open your chats$/);
  assert.equal(m.glance().querySelector('[data-go="chats"]').getAttribute('title'), 'chats not loaded yet');
  m.setSessions({ working: 0, ready: 0 }); m.fire('home');
  assert.equal(m.glance().querySelector('[data-go="chats"]').getAttribute('title'), '0 working, 0 ready');
});
test('thirteenth review: Resources stays in Settings; the owner\'s meter pick holds through an outage; reachability is not claimed', () => {
  const w = settingsWorld();
  const usagePage = () => w.root.innerHTML.match(/data-st-page="usage"[^>]*>(?:[\s\S]*?)<b>([^<]*)<\/b>/)?.[1];
  w.view.render?.(); const before = usagePage();
  w.s.WosResources = { bars: () => '' }; w.W.refresh(); assert.equal(usagePage(), 'Resources'); assert.equal(before, 'AI usage');
  // The owner picked the ChatGPT account; while it cannot be read the meter waits, it never shows another account.
  const m = machinesHome({ snapshot: world({ providers: [acct('claude:mig', 70), acct('chatgpt:me', 30, { status: 'unavailable' })] }), provider: 'claude', saved: { meter: ['chatgpt:me'] } });
  assert.equal(m.root().querySelector('.mh-gauge'), null); assert.equal(m.page('ai').querySelector('.mh-ai').hidden, true);
  m.feed(world({ providers: [acct('claude:mig', 70), acct('chatgpt:me', 30)] }));
  assert.match(m.root().querySelector('.mh-gauge').getAttribute('aria-label'), /30% left, ChatGPT me\./, 'the pick holds once it reads again');
  assert.match(words(m.page('network')), /Who can reach whom isn’t checked here\./);
  assert.doesNotMatch(read(TWEAK), /right now any device on your Tailscale can reach any other/);
});
test('fourteenth review: only Wizard machines are helpers; a stale probe is a last reading, not offline', () => {
  const m = machinesHome({ snapshot: world({}, [dev('this'), dev('h1'), dev('lap', { group: 'human', name: 'Laptop' }), dev('st', { status: 'stale', readAt: nowIso(-3 * 3600e3) }), dev('off', { status: 'offline' }), dev('chk', { status: 'connecting' })]) });
  const row = nodes(m);
  assert.deepEqual(row.map(n => n[0]).sort(), ['chk', 'h1', 'off', 'st', 'this'], 'a registered laptop belongs with its person');
  assert.equal(row.find(n => n[0] === 'st')[2], 'Helper · last reading', 'a stale probe is a helper with its last numbers, never offline');
  const ov = m.page('overview'), node = id => ov.querySelector(`.mh-node[data-id="${id}"]`);
  assert.ok(node('st').querySelector('.mh-bars') && !node('st').querySelector('.mh-disc.is-off'), 'stale: bars, not off');
  assert.ok(!node('off').querySelector('.mh-bars') && node('off').querySelector('.mh-disc.is-off'), 'offline: no bars, greyed');
  assert.deepEqual(words(ov.querySelector('.mh-row.is-devices')), 'Laptop');
  m.tap(ov.querySelector('[data-machine="chk"]'));
  assert.deepEqual(ov.querySelectorAll('.mh-act .mh-act-btn small').map(words), ['Checking', 'Checking'], 'still checking: nothing offered from old numbers');
  m.tap(ov.querySelector('[data-machine="st"]'));
  assert.deepEqual(ov.querySelectorAll('.mh-act .mh-act-btn small').map(words), ['Last reading', 'Last reading']);
  assert.equal(m.glance().querySelector('[data-go="overview"]').getAttribute('title'), '5 machines · 1 person', 'only Wizard machines count');
});
test('fifteenth review: the desktop bar keeps its readings live over open windows', async () => {
  const m = machinesHome({ desk: true, snapshot: world() });
  const bar = m.slots['dock-end'].querySelector('.mh-root.is-topbar'); assert.ok(bar, 'desktop: the glance sits in the top bar');
  assert.deepEqual(m.calls.live, [bar], 'registered as a live viewer when it is put up');
  m.fire('home'); m.fire('route'); assert.equal(m.calls.live.length, 1, 'not again while it stays');
  bar.remove(); m.fire('route'); assert.deepEqual(m.calls.live, [bar, bar], 'again when it is put back');
  // The host side: live() hands the element to the Resources feed until teardown.
  const f = fixture(); let api; f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  const watched = []; f.ctx.window.WosResources.watch = el => watched.push(el);
  await f.host.loadTweaks(['miguel/machines-home'], f.slots, { teamAuthors: ['miguel'] });
  const el = f.doc.createElement('div'); api.data.read.resources.live(el); api.data.read.resources.live({}); assert.deepEqual(watched, [el]);
  await f.clear(); api.data.read.resources.live(el); assert.equal(watched.length, 1, 'inert after teardown');
});
test('sixteenth review: an unavailable group reaches its accounts; a saved or aged AI reading is a last reading', () => {
  const [a] = usage()([{ id: 'claude', name: 'Claude', status: 'unavailable', accounts: [{ id: 'claude:a', status: 'ok', limits: [{ label: 'Weekly', remainingPercent: 50 }] }] }]);
  assert.equal(a.status, 'unavailable');
  const aged = machinesHome({ snapshot: world({ providers: [acct('claude:mig', 60, { fetchedAt: nowIso(-10 * 60e3) })] }) });
  assert.equal(words(aged.page('ai').querySelector('.mh-ai-txt')), '60% left · last reading', 'over five minutes old');
  const fresh = machinesHome({ snapshot: world({ providers: [acct('claude:mig', 60, { fetchedAt: nowIso(-60e3) })] }) });
  assert.equal(words(fresh.page('ai').querySelector('.mh-ai-txt')), '60% left');
  const saved = machinesHome({ saved: { res: world() } });
  assert.equal(words(saved.page('ai').querySelector('.mh-ai-txt')), '70% left · last reading', 'a copy saved on this device');
  saved.feed(world()); assert.equal(words(saved.page('ai').querySelector('.mh-ai-txt')), '70% left', 'a live reading clears it');
  const err = machinesHome({ snapshot: { ...world(), aiError: 'timeout' } });
  assert.equal(words(err.page('ai').querySelector('.mh-ai-txt')), '70% left · last reading', 'a reading with an error is not live');
});
test('seventeenth review: a new My skin shows one switch per replacement group and never saves the hidden member off', async () => {
  const d = await groupedDevice();
  assert.deepEqual(plain(d.E.groups()), [['miguel/machines-home', 'wizard/machines-home']]);
  const g = d.E.groups(); g[0].push('x'); assert.equal(d.E.groups()[0].length, 2, 'a copy each time');
  // The New skin draft (core/settings.js) keeps only the member that would load.
  const src = withSettingsParts(read('web/core/settings.js'));
  const loop = between(src, '      for (const g of window.WosExperience.groups?.() || []) {', '      // Feature switches');
  for (const [map, want] of [[{ 'wizard/machines-home': true, 'miguel/machines-home': false, 'a/b': true }, 'wizard/machines-home'], [{ 'a/b': true }, 'miguel/machines-home']]) {
    const ctx = { window: { WosExperience: { groups: () => [['miguel/machines-home', 'wizard/machines-home']] } },
      items: [{ id: 'miguel/machines-home' }, { id: 'wizard/machines-home' }, { id: 'a/b' }], map };
    vm.runInNewContext('var items = this.items, map = this.map;\n' + loop + '\nthis.out = { items: items.map(t => t.id), map };', ctx);
    assert.deepEqual(plain(ctx.out.items), [want, 'a/b'], 'one switch per group');
    assert.deepEqual(Object.keys(ctx.out.map).filter(k => k.endsWith('machines-home')), want in map ? [want] : [], 'the hidden member is never saved off');
  }
});
test('eighteenth review: machines from a saved or failed-read snapshot are last readings, not online', () => {
  const saved = machinesHome({ saved: { res: world() } });
  assert.deepEqual(nodes(saved).map(n => n[2]), ['Helper · last reading', 'Main · last reading', 'Helper · last reading', 'Helper · last reading']);
  const failed = machinesHome({ snapshot: world() }); failed.feed({ devicesError: 'timeout' });
  assert.ok(nodes(failed).every(n => /last reading$/.test(n[2])), 'a failed read keeps the map as a last reading');
  failed.tap(failed.page('overview').querySelector('[data-machine="h1"]'));
  assert.match(words(failed.page('overview').querySelector('.mh-act')), /Wizard couldn’t read h1 just now; this is its last reading/);
  const fresh = machinesHome({ snapshot: world() });
  assert.deepEqual(nodes(fresh).map(n => n[2]), ['Helper', 'Main', 'Helper', 'Helper']);
});
test('nineteenth review: a signed-out account is never a live usage reading; a vanished managed Wizard falls back before painting', () => {
  const [p] = usage()([{ id: 'claude:a', provider: 'claude', status: 'ok', signedOut: true, limits: [{ label: 'Weekly', remainingPercent: 80 }] }]);
  assert.equal(p.status, 'unavailable', 'signed out: never ok');
  // (usage.js notes and resources.js "Signed out" wording for the same reading are covered by tests/signed-out-reconnect.test.mjs.)
  const m = machinesHome({ snapshot: world(), managed: [], saved: { ws: 'g9' } });
  assert.equal(m.store.get('ws'), 'mine', 'a vanished managed Wizard falls back, remembered');
  assert.equal(words(m.page('overview').querySelector('[aria-selected="true"]')), 'Wiz');
  assert.equal(m.page('overview').querySelector('.mh-root.is-managed'), null);
});
test('twentieth review: a deferred System link is cancelled by a newer link, Back or the user moving on', () => {
  const w = settingsWorld(), opened = [];
  w.W.route('storage', v => opened.push(v));
  assert.equal(w.timers.size, 1);
  const STOP = ['popstate', 'hashchange', 'pointerdown', 'keydown'], waits = k => w.stops.filter(s => s[0] === k && STOP.includes(s[1]) && s[2] === true).map(s => s[1]);
  assert.deepEqual(waits('add'), STOP, 'the user moving on stops the wait (capture phase)');
  w.W.route('network', v => opened.push(v)); assert.equal(w.timers.size, 1, 'a newer link replaces the older wait');
  w.fill('storage'); w.tick(); assert.deepEqual(opened, [], 'the cancelled link never opens');
  w.W.cancelWait(); assert.equal(w.timers.size, 0, 'Back cancels it');
  assert.deepEqual(waits('remove'), [...STOP, ...STOP]);
  w.W.route('overview', v => opened.push(v)); for (let i = 0; i < 40; i++) w.tick(); assert.equal(w.timers.size, 0, 'gives up after 10 s');
});
test('twenty-first review: the default model\'s credit accounts lead the meter; an aged in-memory device reading is not fresh', () => {
  const m = machinesHome({ snapshot: world({ providers: [credit('tinfoil:a', 500), credit('tinfoil:b', 300), acct('claude:mig', 90)] }), provider: 'tinfoil' });
  const g = m.root().querySelector('.mh-gauge');
  assert.match(g.getAttribute('aria-label'), /^AI fuel: 40% left, Tinfoil a and Tinfoil b\./, 'the default model\'s credit accounts lead');
  assert.match(words(m.page('ai').querySelector('.mh-meter-what b')), /^\$8\.00 left$/, 'credit in one currency adds up');
  const plans = machinesHome({ snapshot: world({ providers: [credit('tinfoil:a', 500), acct('claude:mig', 90)] }), provider: 'nobody' });
  assert.match(plans.root().querySelector('.mh-gauge').getAttribute('aria-label'), /90% left, Claude mig\./, 'no default: plans');
  // An in-memory copy over two minutes old is not fresh.
  const aged = machinesHome({ snapshot: { ...world(), devicesAt: Date.now() - 3 * 60e3 } });
  assert.match(nodes(aged)[1][2], /last reading$/);
  aged.feed({ ...world(), devicesAt: Date.now() - 3 * 60e3 }); assert.match(nodes(aged)[1][2], /last reading$/);
  aged.feed({ ...world(), devicesAt: Date.now() }); assert.equal(nodes(aged)[1][2], 'Main');
  // resources.js hands packages the time of its devices reading.
  const ctx = { document: { documentElement: { dataset: { tweaks: '' } }, hidden: false, addEventListener() {}, querySelectorAll: () => [] }, localStorage: { getItem: () => null, setItem() {} },
    queueMicrotask() {}, setTimeout: () => 0, clearTimeout() {}, AbortController, console, Set, Map, CustomEvent: class {}, fetch: () => new Promise(() => {}) };
  ctx.window = ctx; ctx.addEventListener = () => {}; ctx.dispatchEvent = () => true; ctx.WosChat = { esc: String };
  vm.runInNewContext(read('web/core/usage.js'), ctx);
  vm.runInNewContext(read('web/core/resources.js').replace('window.WosResources={', 'globalThis.__S=S;window.WosResources={'), ctx);
  ctx.__S.devices = { devices: [] }; ctx.__S.devicesAt = 1234; ctx.__S.devicesError = '';
  const st = ctx.WosResources.state; assert.equal(st.devicesAt, 1234); assert.deepEqual(plain(st.devices), { devices: [] });
});
test('twenty-second review: the all-clear needs a dated check; any cached machine state is a last reading', () => {
  const undated = machinesHome({ snapshot: world({}, [dev('this', { access: { exposure: 'tailscale' } }), dev('h1', { access: { exposure: 'tailscale', checked: 'soon' } })]) });
  assert.deepEqual(undated.page('network').querySelectorAll('.mh-ts-row').map(r => [words(r.querySelector('span')), r.getAttribute('data-x')]), [['Not checked yet', 'none'], ['Not checked yet', 'none']]);
  assert.doesNotMatch(words(undated.page('network')), /Nothing answers/);
  const dated = machinesHome({ snapshot: world({}, [dev('this', { access: { exposure: 'tailscale', checked: '2026-10-01' } })]) });
  assert.equal(dated.page('network').querySelector('.mh-ts-row').getAttribute('data-x'), 'ok');
  // A last reading keeps what it last showed: Offline stays Offline, marked as a last reading (label and panel).
  const m = machinesHome({ saved: { res: world({}, [dev('this'), dev('h9', { status: 'offline' })]) } });
  assert.equal(nodes(m).find(n => n[0] === 'h9')[2], 'Offline · last reading');
  m.tap(m.page('overview').querySelector('[data-machine="h9"]'));
  assert.equal(words(m.page('overview').querySelector('.mh-act .mh-act-head span')), 'Offline · last reading');
});
test('final review: personal-device presence needs a fresh reading; meter edits keep unreadable picks; any provider can be the default', () => {
  const devs = [dev('this'), dev('ph', { group: 'human', name: 'Phone', status: 'online' }), dev('pc', { group: 'human', name: 'Desk', status: 'offline' })];
  const peers = { network: { available: true, peers: [{ name: 'localhost', os: 'iOS', online: true, group: 'human' }] } };
  const dots = m => m.page('overview').querySelectorAll('.mh-row.is-devices .mh-dot').map(d => d.className);
  assert.deepEqual(dots(machinesHome({ snapshot: world({ reg: peers }, devs) })), ['mh-dot', 'mh-dot off', 'mh-dot']);
  assert.deepEqual(words(machinesHome({ snapshot: world({ reg: peers }, devs) }).page('overview').querySelector('.mh-row.is-devices')), 'PhoneDeskiPhone');
  assert.deepEqual(dots(machinesHome({ saved: { res: world({ reg: peers }, devs) } })), ['mh-dot unk', 'mh-dot unk', 'mh-dot unk'], 'unknown without a fresh reading');
  // Meter edits start from the saved pick, so an account unreadable right now stays picked; kinds never mix.
  const providers = [acct('claude:a', 50, { status: 'unavailable' }), acct('claude:b', 60), acct('chatgpt:c', 70), credit('tinfoil:t', 300)];
  const m = machinesHome({ snapshot: world({ providers }), provider: 'claude', saved: { meter: ['claude:a', 'claude:b'] } });
  m.change(m.page('ai').querySelector('[data-meter-id="chatgpt:c"]'), true);
  assert.deepEqual(plain(m.store.get('meter')), ['claude:a', 'claude:b', 'chatgpt:c']);
  m.change(m.page('ai').querySelector('[data-meter-id="tinfoil:t"]'), true);
  assert.deepEqual(plain(m.store.get('meter')), ['claude:a', 'tinfoil:t'], 'a credit pick drops the plans, keeps the unreadable one');
  // Any provider can be the default; exact identity before the whole-name aliases.
  const def = (provider, list) => { const x = machinesHome({ snapshot: world({ providers: list }), provider }); return [x.page('ai').querySelector('.mh-ai-def')?.parentNode.querySelector('b').textContent || '', x.store.get('def') ?? '']; };
  assert.deepEqual(def('openrouter', [acct('claude:a', 50), acct('openrouter:x', 40, { providerName: 'OpenRouter' })]), ['OpenRouter', 'openrouter']);
  assert.deepEqual(def('claude-code', [acct('chatgpt:c', 50), acct('claude:a', 40)]), ['Claude', 'claude'], 'whole-name alias');
  assert.deepEqual(def('codex', [acct('claude:a', 50), acct('chatgpt:c', 40)]), ['ChatGPT', 'chatgpt']);
  assert.deepEqual(def('claudette', [acct('claude:a', 50)]), ['', ''], 'no partial-name match');
  assert.deepEqual(def('Anthropic', [acct('claude:a', 50, { providerName: 'Anthropic' })]), ['Anthropic', 'claude'], 'exact service name first');
});
test('final review 2: exposure dates must be real; an open warning from a last reading says so and offers no fix', async () => {
  const { cleanAccess } = await import('../tools/system-devices.mjs');
  assert.equal(cleanAccess({ exposure: 'tailscale', checked: '2026-13-40' }).checked, undefined);
  assert.equal(cleanAccess({ exposure: 'tailscale', checked: '2999-01-01' }).checked, undefined);
  const tomorrow = new Date(Date.now() + 36 * 3600e3).toISOString().slice(0, 10);
  assert.equal(cleanAccess({ exposure: 'tailscale', checked: tomorrow }).checked, undefined, 'tomorrow is not a completed check');
  assert.equal(cleanAccess({ exposure: 'tailscale', checked: '2026-10-28' }).checked, '2026-10-28');
  /*PB-BLOCK2*/
});

test('every Back path cancels a waiting System link', () => {
  for (const [src, marker] of [[appSrc(), '  function backStep('], [deskSrc(), '  function desktopBack(event) {']]) {
    const calls = [];
    const ctx = runRecording(block(src, marker) + '\nthis.go = ' + marker.trim().split(/[ (]/)[1] + ';', { window: { WosSettings: { cancelWait: () => calls.push('cancel') } } });
    try { ctx.go({}); } catch (_) { /* the rest of Back needs the shell */ }
    assert.equal(calls[0], 'cancel', marker);
  }
  const w = settingsWorld(); w.W.route('storage', () => {}); assert.equal(w.timers.size, 1); w.W.cancelWait(); assert.equal(w.timers.size, 0, 'WosSettings exports the cancel');
});
test('machines-home: Home is one glance; the full views live in Settings › System', async () => {
  const man = JSON.parse(read('web/tweaks/miguel/machines-home/manifest.json'));
  assert.ok(man.capabilities.includes('settings'));
  const m = machinesHome({ snapshot: world(), backup: backupOk(), managed: managedItems }); await m.flush();
  assert.deepEqual(Object.keys(m.sections), ['overview', 'ai', 'network', 'storage'], 'four System pages');
  assert.deepEqual(m.root().querySelectorAll('.mh-glance > *').map(t => t.getAttribute('data-go') || t.className), ['mh-tile is-ai', 'chats', 'storage', 'network', 'overview'], 'Home: one slim strip');
  assert.equal(m.root().querySelector('.mh-map'), null, 'the map lives in Settings');
  assert.deepEqual(m.page('overview').querySelectorAll('.mh-ws [role="tab"]').map(words), ['Wiz', 'Carlos'], 'the Settings network tabs remain, from the shared registry');
  m.tap(m.root().querySelector('[data-go="network"]')); m.tap(m.root().querySelector('.mh-gauge'));
  assert.deepEqual(m.calls.settingsOpen, ['network', 'ai'], 'strip parts open their Settings page');
  m.tap(m.root().querySelector('[data-go="chats"]')); assert.deepEqual(m.calls.opens, ['ready']);
  assert.equal(m.root().querySelector('header.mh-top'), null, 'no separate switcher above the strip');
  const desk = machinesHome({ desk: true, snapshot: world() });
  assert.ok(desk.slots['dock-end'].querySelector('.mh-glance.is-bar'), 'desktop: the glance sits in the top bar'); assert.equal(desk.root().querySelector('.mh-glance'), null);
  // The host: settings only with the capability, only trusted.
  const f = fixture(); let api; f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  const reg = []; f.ctx.window.WosSettings = { register: spec => { reg.push(spec); return () => {}; } };
  await f.host.loadTweaks(['miguel/machines-home'], f.slots);
  assert.ok(!api.settings?.section, 'untrusted: no System pages');
  await f.host.loadTweaks(['miguel/machines-home'], f.slots, { teamAuthors: ['miguel'] });
  api.settings.section('a', 'network', f.doc.createElement('div')); assert.deepEqual(reg.map(r => r.page), ['network']);
  await f.clear();
  // Settings: System pages hide until a package fills them, under their own group heading.
  const w = settingsWorld(); w.view.render?.();
  assert.doesNotMatch(w.root.innerHTML, /data-st-page="overview"/);
  w.fill('overview'); assert.match(w.root.innerHTML, /<h4 class="st-navgroup">System<\/h4>/); assert.match(w.root.innerHTML, /data-st-page="overview"[\s\S]*?<b>Your network<\/b>/);
});
