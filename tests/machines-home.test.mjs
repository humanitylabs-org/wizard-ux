import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fixture, read } from './fixtures/tweaks.mjs';

// Machines on Home (wizard/machines-home): the Wizard skin's Home map. Runs the real package in the shell fixture on
// a devices feed and a Backup app answer, and checks what Home draws for one machine and for a small network.
const MH = 'wizard/machines-home';
const tick = () => new Promise(r => setTimeout(r, 15));
const walk = el => [el, ...(el.children || []).flatMap(walk)];
const cls = (el, c) => String(el.className || '').split(/\s+/).includes(c);
const text = el => walk(el).map(n => n.textContent || '').join(' ');
const mainOnly = { devices: { devices: [{ id: 'this', name: 'home-box', status: 'online', platform: 'linux', cpus: 4, memoryTotalGB: 8, disks: [{ sizeGB: 250, freeGB: 120, pct: 52 }] }] } };
const network = { devices: {
  devices: [mainOnly.devices.devices[0], { id: 'spare', name: 'spare-box', status: 'online', use: 'standby', cpus: 8, memoryTotalGB: 16 }, { id: 'gpu', name: 'gpu-box', status: 'online', use: 'helper', cpus: 16, memoryTotalGB: 64 }, { id: 'other', name: 'not-a-role' }],
  managed: [{ id: 'family', name: 'Family' }],
  network: { available: true, peers: [{ name: 'phone', os: 'iOS', group: 'human', online: true }, { name: 'build', os: 'linux', group: 'agent', online: true }] } } };
const backupOk = { backup: { configured: true, enabled: true, every: 'daily', state: 'ok', target: { kind: 'r2' }, last: { ok: true, finished_at: Date.now() / 1000 - 3600 } } };

// apps: the box's app list (ids) as the shell knows it; null = never read on this device.
async function home(id, state, backup, { also = [], apps = [] } = {}) {
  const f = fixture();
  f.ctx.window.WosResources.state = state;
  f.ctx.window.WizCore = { appsLoaded: async () => {}, appsKnown: () => apps !== null, appMetadata: x => (apps || []).includes(x) ? { id: x } : undefined };
  const fetchTweak = f.ctx.fetch, asked = [];
  f.ctx.fetch = async (url, opts) => {
    if (String(url).includes('/tweaks/')) return fetchTweak(String(url), opts);
    asked.push([String(url), opts?.method]);
    if (backup === undefined) return { ok: false, status: 404, headers: { get: () => 'text/html' }, json: async () => ({}) };
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => backup };
  };
  await f.host.loadTweaks([id, ...also], f.slots, { teamAuthors: JSON.parse(read('web/tweaks/catalog.json')).teamAuthors });
  await tick();
  const slot = f.doc.querySelector('[data-slot="home-main"]');
  const roots = slot.children.filter(n => n.dataset.mhRoot != null), root = roots[0];
  const nodes = root ? walk(root).filter(n => cls(n, 'mh-node')) : [];
  const lane = c => walk(root).find(n => cls(n, 'mh-lane') && cls(n, c));
  return { f, slot, roots, root, nodes, lane, asked, roles: nodes.map(n => n.dataset.act ? n.dataset.act + ':' + n.dataset.role : n.dataset.role) };
}

test('one machine, no Backup app: Main plus an empty Storage slot, nothing else to explain', async () => {
  const h = await home(MH, mainOnly, undefined);
  assert.equal(h.roots.length, 1, 'one map mounted at Home');
  assert.deepEqual(h.roles, ['add:storage', 'main']);
  assert.equal(h.lane('is-helpers').hidden, true, 'no empty Helpers row for a single machine');
  assert.equal(walk(h.root).find(n => cls(n, 'mh-ws')).hidden, true, 'no network switcher without managed Wizards');
  assert.equal(walk(h.root).find(n => cls(n, 'mh-humans')).hidden, true);
  assert.deepEqual(h.asked, [['https://wizard.test/backup/api/overview', 'GET']], 'one read-only Backup app read');
  h.nodes[0].tagName = 'BUTTON';  // the fixture keeps tag names as written
  h.root.handlers.get('click').forEach(fn => fn({ target: h.nodes[0] }));
  assert.match(h.f.toasts.at(-1), /Adding storage: coming soon/);
  await h.f.clear(); assert.equal(h.slot.children.length, 0, 'teardown leaves Home as it was');
});

test('a small network: Storage from the Backup app, Main + Standby, a Helper, managed Wizards and human devices', async () => {
  const h = await home(MH, network, backupOk);
  assert.deepEqual(h.roles, ['storage', 'main', 'standby', 'helper'], 'roles come only from the registry `use`; a plain device gets none');
  assert.match(text(h.root), /Cloudflare R2/);
  const tabs = walk(h.root).find(n => cls(n, 'mh-ws'));
  assert.equal(tabs.hidden, false); assert.deepEqual(tabs.children.map(b => b.dataset.ws || b.dataset.act), ['mine', 'family', 'add-managed']);
  const humans = walk(h.root).find(n => cls(n, 'mh-humans'));
  assert.equal(humans.hidden, false); assert.match(text(humans), /\b1\b/, 'only the human-group device counts');
  await h.f.clear();
});

test('a standby but no helper offers the next slot; a Backup app that is not set up offers Storage', async () => {
  const state = structuredClone(network); state.devices.devices = state.devices.devices.filter(d => d.id !== 'gpu');
  const h = await home(MH, state, { backup: { configured: false } });
  assert.deepEqual(h.roles, ['add:storage', 'main', 'standby', 'add:helper']);
  await h.f.clear();
});

test('a failed read with the Backup app installed (or an unknown app list) says unavailable, never "Add storage"', async () => {
  for (const apps of [['backup'], null]) {
    const h = await home(MH, mainOnly, undefined, { apps });
    assert.deepEqual(h.roles, ['main'], `apps ${JSON.stringify(apps)}`);
    assert.match(text(h.lane('is-storage')), /Backup status unavailable right now/);
    await h.f.clear();
  }
});

test("Miguel's package runs the same map (his look stays in his own tweak.css)", async () => {
  const h = await home('miguel/machines-home', network, backupOk, { apps: ['backup'] });
  assert.equal(h.roots.length, 1);
  assert.deepEqual(h.roles, ['storage', 'main', 'standby', 'helper']);
  await h.f.clear();
  const src = read('web/tweaks/miguel/machines-home/tweak.js');
  assert.match(src, /import \{ machinesHome \} from '\.\.\/\.\.\/wizard\/machines-home\/tweak\.js';/);
  assert.match(src, /export default function setup\(api\) \{ return machinesHome\(api\); \}/);
});

test('a role, name or managed-list change alone redraws the map', async () => {
  const state = structuredClone(mainOnly);
  const h = await home(MH, state, undefined);
  assert.deepEqual(h.roles, ['add:storage', 'main']);
  state.devices.devices.push({ id: 'spare', name: 'spare-box', status: 'online' });
  const again = () => walk(h.root).filter(n => cls(n, 'mh-node')).map(n => n.dataset.act ? n.dataset.act + ':' + n.dataset.role : n.dataset.role);
  const fire = async patch => { patch(state); h.f.ctx.window.WosResources.state = structuredClone(state); h.f.emit('wos:resources'); await tick(); };  // what resources.js does after each poll
  await fire(() => {});
  assert.deepEqual(again(), ['add:storage', 'main'], 'a device with no role is not on the map');
  await fire(st => { st.devices.devices[1].use = 'standby'; });
  assert.deepEqual(again(), ['add:storage', 'main', 'standby', 'add:helper'], 'a new `use` shows up without any other change');
  const ws = () => walk(h.root).find(n => cls(n, 'mh-ws'));
  assert.equal(ws().hidden, true);
  await fire(st => { st.devices.managed = [{ id: 'family', name: 'Family' }]; });
  assert.equal(ws().hidden, false, 'a new managed Main shows the switcher');
  await fire(st => { st.devices.devices[1].name = 'renamed-box'; });
  assert.match(text(h.lane('is-mainrow')), /renamed-box/, 'a rename shows up');
  await h.f.clear();
});

test('data.read.installed: trusted only, id-bounded, null until the app list is known, inert after teardown', async () => {
  const f = fixture(); let api;
  f.ctx.window.WizCore = { appsLoaded: async () => {}, appsKnown: () => known, appMetadata: id => id === 'backup' ? { id } : undefined }; let known = true;
  f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  await f.host.loadTweaks([MH], f.slots);
  assert.equal(api.data, undefined, 'untrusted authors get no data reads');
  await f.host.loadTweaks([MH], f.slots, { teamAuthors: ['wizard'] });
  assert.equal(await api.data.read.installed('backup'), true); assert.equal(await api.data.read.installed('music'), false);
  for (const bad of ['../x', 'Backup', '', 'a/b']) assert.equal(await api.data.read.installed(bad), null);
  known = false; assert.equal(await api.data.read.installed('music'), null, 'never read: unknown, not "missing"');
  known = true; await f.clear(); assert.equal(await api.data.read.installed('backup'), null);
  const apps = read('web/core/apps.js');
  assert.match(apps, /let KNOWN = \(\(\) => \{ try \{ return localStorage\.getItem\(REMOTE_KEY\) != null;/);
  assert.match(apps, /REMOTE = list\.map\(a => toTile\(a, true\)\); KNOWN = true;/);
});

test('both packages on (an own recipe can do that): still one map on Home', async () => {
  const h = await home(MH, mainOnly, undefined, { also: ['miguel/machines-home'] });
  assert.equal(h.roots.length, 1);
  await h.f.clear(); assert.equal(h.slot.children.length, 0);
});

test('without trusted reads the package stays out instead of failing', async () => {
  const f = fixture(); f.ctx.window.WosResources.state = mainOnly;
  await f.host.loadTweaks([MH], f.slots);  // not a team author here: no data.read
  assert.deepEqual(Array.from(f.host.tweakState), [MH]); assert.equal(f.toasts.length, 0);
  assert.equal(f.doc.querySelector('[data-slot="home-main"]').children.length, 0);
  await f.clear();
});

test('the Wizard skin ships it on, for new and existing devices; the owner can switch it off in Settings › Look', async () => {
  const published = JSON.parse(read('web/tweaks/wizard/profile.json'));
  assert.ok(published.tweaks.includes(MH)); assert.ok(!published.off.includes(MH));
  const boot = storage => {
    const window = { WosSkin: { current: 'nebula', familyOf: () => 'wizard', families: [{ id: 'wizard', tweaks: 'wizard' }] }, addEventListener() {}, dispatchEvent() {},
      WosSkinHost: { personalState: { ready: false }, tweakState: [], loadTweaks: async ids => { window.WosSkinHost.tweakState = ids; } } };
    vm.runInNewContext(read('web/core/experience.js'), { window, document: { baseURI: 'https://wizard.test/wizard-os-home/', addEventListener() {} }, Event, URL, AbortSignal,
      localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) }, fetch: async url => ({ ok: true, json: async () => JSON.parse(read('web/' + url.pathname.split('/wizard-os-home/')[1])) }) });
    return { E: window.WosExperience, on: () => Array.from(window.WosSkinHost.tweakState).includes(MH) };
  };
  let d = boot(new Map()); await d.E.refresh(); assert.equal(d.on(), true, 'a new device');
  const existing = new Map([['wos.app-borders.migrated.v1', 'true'], ['wos.skin-tweaks.v1', JSON.stringify({ version: 1, off: { wizard: ['wizard/two-orbs', 'wizard/app-borders'] } })]]);
  d = boot(existing); await d.E.refresh(); assert.equal(d.on(), true, 'a device that already stored its Wizard choices');
  await d.E.toggle(MH); assert.equal(d.on(), false);
  d = boot(existing); await d.E.refresh(); assert.equal(d.on(), false, 'the owner’s off is remembered');
});

test('shared code stays generic: read-only, no owner data, every add says coming soon, Home stays stock without it', () => {
  const src = read('web/tweaks/wizard/machines-home/tweak.js');
  assert.doesNotMatch(src, /method:\s*'(POST|PUT|PATCH|DELETE)'/);
  assert.match(src, /api\.data\.read\.app\('backup', 'overview'\)/);
  assert.doesNotMatch(src, /['"`][a-z0-9.-]+\.(com|net|org|io|solutions|ts\.net)\b/i, 'no hostnames');
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /miguel|mizel|carlos|hostinger|oscar/i, 'no people or providers in the code');
  assert.match(src, /S\.res\.devices\?\.managed/); assert.match(src, /d\.use === use/);
  for (const act of ["'add-managed'", "act: 'add'", "'soon'"]) assert.ok(src.includes(act));
  assert.match(src, /api\.back\.push\(\(\) => closeSheet\(\)\)/, 'the sheet joins the shell Back order');
  const css = read('web/tweaks/wizard/machines-home/tweak.css');
  assert.doesNotMatch(css, /data-skin/, 'shell tokens only; no skin-specific rules');
  assert.match(css, /\[data-slot="home-main"\]:has\(> \.mh-root\) \{ flex: 1 1 auto; min-height: 0; display: flex;/, 'the package shows the hidden slot itself');
  const core = ['web/app.js', 'web/desktop/desktop.js', 'web/core/skin-host.js', 'web/core/resources.js', 'web/core/experience.js'].map(read).join('\n');
  assert.doesNotMatch(core, /machines-home/, 'core never names the package');
});
