import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { existsSync } from 'node:fs';
import { coreFeatures, coreIds, builtinDefaults } from './fixtures/core-features.mjs';
import { fixture, contract, read } from './fixtures/tweaks.mjs';
import { withSkinHostParts } from './fixtures/skin-host-parts.mjs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withDesktopParts } from './fixtures/desktop-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { block, between, runRecording } from './fixtures/source-slice.mjs';
import { runPart, loadFile, scoped, read as readRaw } from './fixtures/r5B-parts.mjs';
import { modelContext } from './fixtures/chats-list-model.mjs';
import { desktopKeys } from './fixtures/desktop-keys-harness.mjs';
import { listFixture } from './fixtures/chats-list-render.mjs';
const catalog = JSON.parse(read('web/tweaks/catalog.json'));
// Capability-gate fixtures: a package id that asks for exactly these capabilities (no shipped package needed).
const asking = (id, capabilities) => ({ id, name: id, version: '1.0.0', author: id.split('/')[0], apiVersion: 1, capabilities, description: 'test fixture' });
for (const id of catalog.tweaks) {
  const check = (await import(new URL(`../web/tweaks/${id}/contract.mjs`, import.meta.url))).default;
  test(`${id}: shipped contract mounts / tears down against the shell fixture`, () => contract(id, check, ['miguel/send-and-go', 'miguel/now-playing'].includes(id) ? 'desktop' : 'phone'));
}
// Notifications in Chats is built into the shell (core/unified-inbox.js, wizard-ux issue 1352), same contract as the package had.
const inboxCheck = (await import(new URL('./fixtures/unified-inbox-contract.mjs', import.meta.url))).default;
test('wizard/unified-inbox (core): contract mounts / tears down against the shell fixture', () => contract('wizard/unified-inbox', inboxCheck, 'phone'));
// static-rule: API inventory: the v1 slot contract (slots.json) and the core markup of four files must agree
test('the six v1 slot names remain in core markup; removing / renaming requires an API bump', () => {
  const baseline = ['thread-switch-row-end','thread-header-actions','list-top','composer-end','home-top','dock-end'];
  const contract = JSON.parse(read('web/core/slots.json'));
  const markup = ['web/core/chats.js','web/core/resources.js','web/index.html','web/desktop.html'].map(read).join('\n');
  for (const name of baseline) {
    if (!contract.slots[name]) assert.ok(contract.apiVersion > 1, `removing ${name} requires API bump`);
    else assert.ok(markup.includes(`data-slot="${name}"`), `${name} missing from core markup`);
  }
});
test('incompatible API disables only that tweak, toasts, and finishes loading the rest', async () => {
  const id = 'miguel/snooze-someday'; const bad = { ...JSON.parse(read(`web/tweaks/${id}/manifest.json`)), apiVersion: 999 };
  const f = fixture({ manifests: { [id]: bad } });
  await f.host.loadTweaks([id, 'miguel/send-and-go'], f.slots, { teamAuthors: ['miguel'] });
  assert.deepEqual(Array.from(f.host.tweakState), ['miguel/send-and-go']); assert.match(f.toasts[0], /turned off.*Incompatible API/); await f.clear();
});
test('capabilities are namespace gated; author metadata alone cannot grant model/data access', async () => {
  // An untrusted package that asks for data.read (as the retired home-bars did) still gets no data.
  const f = fixture({ manifests: { 'miguel/asks-data': asking('miguel/asks-data', ['layout', 'data.read']), 'miguel/asks-models': asking('miguel/asks-models', ['layout', 'models']) } }); let api;
  f.host._test.setImporter(async () => ({ default: value => { api = value; return () => {}; } }));
  await f.host.loadTweaks(['miguel/asks-data'], f.slots);
  assert.ok(api.slot); assert.equal(api.data, undefined); assert.equal(api.nav, undefined); assert.equal(api.thread, undefined);
  await f.host.loadTweaks(['miguel/asks-models'], f.slots, { trustedAuthors: ['miguel'] });
  assert.ok(api.models); assert.ok(api.thread); assert.equal(api.data, undefined); assert.equal(api.nav, undefined); await f.clear();
});
test('multiple ordered packages clean listeners, CSS, mounts and action interception on replacement', async () => {
  const f = fixture(); await f.host.loadTweaks(catalog.tweaks, f.slots, { teamAuthors: ['miguel', 'wizard'] });
  assert.equal(f.host.tweakState.length, catalog.tweaks.length); assert.equal(f.host.action('snooze', {sessionId:'s1'}), true);
  await f.clear(); assert.equal(f.doc.head.children.length, 0); for (const el of [f.thread, f.list]) for (const [type, set] of el.handlers) assert.equal(set.size, 0, `${type} listener left behind`); assert.equal(f.host.action('snooze', {sessionId:'s1'}), false);
});
test('colors and tweaks are separate: a color pick never changes tweaks; a preset starts over; any tweak can be tried', async () => {
  const storage = new Map([['wos.skin', 'obsidian']]); let skin = 'obsidian', active = [];
  const profiles = { miguel: { id: 'miguel', name: 'Miguel', version: 1, tweaks: ['miguel/send-and-go'] }, wizard: JSON.parse(read('web/tweaks/wizard/profile.json')) };
  const fams = [{ id: 'wizard', tweaks: 'wizard', palettes: ['grove'] }, { id: 'mizel', tweaks: 'miguel', palettes: ['obsidian', 'landscapes'] }];
  const window = { WosSkin: { get current() { return skin; }, families: fams, familyOf: id => fams.find(f => f.palettes.includes(id)).id }, WosSkinHost: { personalState: { ready: false }, get tweakState() { return active; }, loadTweaks: async ids => { active = ids.filter(id => !builtinDefaults(JSON.parse(read('web/tweaks/catalog.json'))).includes(id)); } }, addEventListener() {}, dispatchEvent() {} };
  const ctx = { window, setTimeout, document: { baseURI:'https://wizard.test/wizard-os-home/', addEventListener() {} }, Event, URL, AbortSignal, localStorage: { getItem:k=>storage.get(k), setItem:(k,v)=>storage.set(k,v) }, fetch: async url => ({ ok:true, json: async () => { const who = url.pathname.match(/tweaks\/([^/]+)\/profile\.json$/)?.[1]; return who ? profiles[who] : JSON.parse(read('web/'+url.pathname.split('/wizard-os-home/')[1])); } }) };
  vm.runInNewContext(read('web/core/experience.js'), ctx); const E = window.WosExperience;
  await E.refresh(); assert.deepEqual(Array.from(active), ['miguel/send-and-go'], 'a device from before keeps what its color brought');
  assert.deepEqual(JSON.parse(storage.get('wos.skin-tweaks.v1')).mix, { 'miguel/send-and-go': true }, 'written into its own switches once');
  skin = 'grove'; await E.chooseSkin(); assert.deepEqual(Array.from(active), ['miguel/send-and-go'], 'a color pick keeps the tweaks');
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.equal(E.state.tweaks.length, new Set([...cat.tweaks, ...cat.defaults, ...coreIds]).size, 'every installed tweak is offered, whoever wrote it (and the core features)');
  await E.toggle('wizard/phone-recovery-mode'); assert.deepEqual(Array.from(active).sort(), ['miguel/send-and-go', 'wizard/phone-recovery-mode'], 'another author\'s tweak can be tried');
  await E.toggle('miguel/send-and-go'); assert.deepEqual(Array.from(active), ['wizard/phone-recovery-mode']);
  profiles.miguel = { ...profiles.miguel, version: 2, tweaks: ['miguel/snooze-someday', 'miguel/send-and-go'] }; await E.refresh();
  assert.deepEqual(Array.from(active), ['wizard/phone-recovery-mode'], 'new features start off for everyone');
  const mig = cat.tweaks.filter(id => id.startsWith('miguel/'));
  assert.equal(E.chooseAuthor, undefined, 'no per-author quick button: one switch per tweak (Miguel, 1 Nov 2026)');
  await E.toggle('miguel/send-and-go'); await E.toggle('wizard/failure-reason');
  assert.deepEqual(Array.from(active).sort(), ['miguel/send-and-go', 'wizard/failure-reason', 'wizard/phone-recovery-mode'], 'each switch adds just itself, any author');
  await E.toggle('miguel/send-and-go'); assert.deepEqual(Array.from(active).sort(), ['wizard/failure-reason', 'wizard/phone-recovery-mode'], 'and takes just itself off');
  assert.ok(mig.length > 1, 'Miguel has several tweaks, none switched on by another');
  const authors = await E.authors(); assert.deepEqual(Array.from(authors, a => a.name), ['Miguel', 'James']);
  assert.ok(!authors.some(a => a.ids.some(id => cat.defaults.includes(id))), 'built-in features have no quick button');
  assert.equal(E.state.tweaks.find(t => t.id === 'wizard/unified-inbox').builtin, true);
});

test('event access is capability-gated, render payloads have no DOM, stale model and nav APIs are inert', async () => {
  const f=fixture({manifests:{'miguel/asks-models':asking('miguel/asks-models',['layout','models'])}}); let api, payload;
  f.host._test.setImporter(async()=>({default:a=>{api=a;return()=>{};}}));
  await f.host.loadTweaks(['miguel/send-and-go'],f.slots);
  assert.throws(()=>api.on('render',()=>{}),/requires layout/); assert.throws(()=>api.on('sent',()=>{}),/trusted navigation/);
  assert.throws(()=>api.nav.snoozeSomeday('s1'),/Trusted navigation/);
  assert.equal(api.nav.back(),true); assert.equal(f.route().view,'list'); assert.equal(api.nav.back(),false); assert.equal(f.route().view,'list');
  await f.host.loadTweaks(['miguel/asks-models'],f.slots,{teamAuthors:['miguel']});
  api.on('render',value=>{payload=value;}); f.host.rendered('list',f.doc.body); assert.equal(payload.part,'list'); assert.equal(payload.el,undefined);
  await f.clear(); assert.equal(await api.thread.model({id:'test-model',provider:'test'}),null); assert.deepEqual(Array.from(await api.models.list()),[]);
});
test('a core repaint removes the origin marker: teardown never resurrects stale duplicate actions', async () => {
  // A package borrows the core thread-actions row into a slot (as the retired model switch did).
  const f=fixture({manifests:{'miguel/borrows':asking('miguel/borrows',['layout'])}});
  f.host._test.setImporter(async()=>({default:api=>{api.slot.mount('thread-switch-row-end',api.part('thread-actions'));return()=>{};}}));
  await f.mount('miguel/borrows');
  const marker=f.thread.children.find(n=>n.tagName==='comment'); assert.ok(marker); marker.remove();
  const replacement=f.doc.createElement('div'); replacement.setAttribute('data-part','thread-actions'); f.thread.append(replacement);
  await f.clear(); assert.equal(f.thread.querySelector('[data-part="thread-actions"]'),replacement); assert.equal(f.thread.children.filter(n=>n.dataset.part==='thread-actions').length,1);
});

function wizardExperience(storage = new Map()) {
  const requests = [];
  let skin = 'nebula', active = [], layout = storage.get('wos.layout') || 'classic';
  const window = { WosSkin: { get current() { return skin; }, familyOf: id => id === 'nebula' ? 'wizard' : 'novairecito', families: [{id:'wizard',tweaks:'wizard'}, {id:'novairecito'}] },
    WosSkinHost: { personalState:{ready:false}, get tweakState() { return active; }, get layout() { return layout; }, setLayout: id => { layout = id; }, loadTweaks: async ids => { active = ids; } }, addEventListener() {}, dispatchEvent() {} };
  vm.runInNewContext(read('web/core/experience.js'), {window, document:{baseURI:'https://wizard.test/wizard-os-home/',addEventListener(){}}, Event, URL, AbortSignal,
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}, fetch:async url=>{ requests.push(url.pathname); return {ok:true,json:async()=>JSON.parse(read('web/'+url.pathname.split('/wizard-os-home/')[1]))}; }});
  // Notifications in Chats is on by default for the Wizard family; these older checks are about the other tweaks.
  return { window, E:window.WosExperience, storage, requests, skin:id=>{skin=id;}, active:()=>Array.from(active).filter(id => !builtinDefaults(JSON.parse(read('web/tweaks/catalog.json'))).includes(id)), all:()=>Array.from(active) };
}
test('profile default-off applies until the owner stores a deliberate choice, including an empty off list', async () => {
  let f = wizardExperience(); await f.E.refresh(); assert.ok(!f.all().some(id => id.endsWith('/machines-home')), 'James, 31 Oct 2026: the Wizard skins keep the classic Home (no network map by default)'); assert.deepEqual(f.active(), []); assert.equal(f.E.state.tweaks.find(t => t.id === 'wizard/phone-recovery-mode').on, false);
  await f.E.toggle('wizard/phone-recovery-mode'); assert.deepEqual(f.active(), ['wizard/phone-recovery-mode']);
  assert.deepEqual(JSON.parse(f.storage.get('wos.skin-tweaks.v1')).mix, { 'wizard/phone-recovery-mode': true });
  f = wizardExperience(f.storage); await f.E.refresh(); assert.deepEqual(f.active(), ['wizard/phone-recovery-mode']);
  f.skin('novairecito'); await f.E.chooseSkin(); assert.deepEqual(f.active(), ['wizard/phone-recovery-mode'], 'another color keeps tweaks');
  await f.E.toggle('wizard/phone-recovery-mode'); await f.E.refresh(); assert.deepEqual(f.active(), []);
});
// The two-orb and App borders migrations went with their switches (wizard-ux issue 1239): a device that still has the
// old two-orb layout or a framed composition saved opts into nothing and falls back to the classic layout.
test('a saved legacy two-orb layout or framed composition turns nothing on now its switches are removed', async () => {
  for (const storage of [new Map([['wos.layout','two-orb']]), new Map([['wos.skin.composition.v1', JSON.stringify({version:1,extends:'nebula',frame:{foundation:'framed'}})]])]) {
    const f = wizardExperience(storage); await f.E.refresh();
    assert.deepEqual(f.active(), []); assert.equal(f.E.state.error, '');
    // The layout itself is gone (wizard-ux issue 1338): skin-host's boot treats a stored 'two-orb' as unknown (tests/stale-layout-boot).
    assert.ok(!/id: 'two-orb'/.test(withSkinHostParts(read('web/core/skin-host.js'))));
    assert.equal(storage.has('wos.two-orbs.migrated.v1') || storage.has('wos.app-borders.migrated.v1'), false, 'no migration ran');
  }
});
test('overview mode is capability gated, revoked on teardown, and stale handles cannot reactivate it', async () => {
  const f=fixture({manifests:{'miguel/asks-nav':asking('miguel/asks-nav',['layout','nav'])}}); let api;
  f.host._test.setImporter(async()=>({default:a=>{api=a;return()=>{};}}));
  await f.mount('wizard/phone-recovery-mode'); assert.equal(api.overview,undefined);
  await f.mount('miguel/asks-nav');
  assert.throws(()=>api.overview.use({hold:'exit',appHold:false}),/Invalid overview mode/);
  const release=api.overview.use({hold:'arrange',appAction:'home-screen',appHold:false});
  assert.equal(f.overview.hold,'arrange'); await f.clear(); assert.equal(f.overview,null);
  release(); release(); api.overview.use({hold:'arrange',appAction:'home-screen',appHold:false}); assert.equal(f.overview,null);
});
test('window refresh is layout+nav gated, revoked on teardown, and stale handles cannot reactivate it', async () => {
  const f=fixture({manifests:{'miguel/asks-nav':asking('miguel/asks-nav',['layout','nav'])}}); let api;
  f.host._test.setImporter(async()=>({default:a=>{api=a;return()=>{};}}));
  await f.mount('wizard/phone-recovery-mode'); assert.equal(api.windowRefresh,undefined);
  await f.mount('miguel/asks-nav'); assert.equal(f.windowRefresh,null);
  assert.throws(()=>api.windowRefresh.use({}),/Invalid window refresh mode/);
  const release=api.windowRefresh.use({pull:false,extra:1}); assert.deepEqual({...f.windowRefresh},{pull:false});
  release(); release(); assert.equal(f.windowRefresh,null);
  api.windowRefresh.use({pull:true}); assert.equal(f.windowRefresh.pull,true);
  await f.clear(); assert.equal(f.windowRefresh,null);
  api.windowRefresh.use({pull:false}); assert.equal(f.windowRefresh,null);
});

// The phone shell's real model and windows parts (web/app-model.js, web/app-windows.js) on a mini-dom track: the
// window-refresh adapter, the Chats host's pullRefresh and the window bar markup are the shipped code.
function phoneWindows() {
  const doc = scoped(createDocument()), track = doc.createElement('div'); doc.body.appendChild(track); let host;
  const model = runPart('web/app-model.js', 'appParts', 'model', { $: () => track, appVars: { idx: 0, desks: [{}], W: {} } },
    { document: doc, window: { WizChatsHost: { create: o => { host = o; return {}; } } } }).out;
  const wins = runPart('web/app-windows.js', 'appParts', 'windows', { refreshModes: model.refreshModes, RELOAD_BTN: model.RELOAD_BTN, esc: String, winApp: () => ({}), APP: {}, agentWin: () => false, ico: () => '', track, appVars: { desks: [], W: {} } },
    { document: doc, window: { WosAgents: { titlebar: () => '' }, WosBoundView: { badge: () => '' } } }).out;
  wins.bindLate({ renderApp: () => '<p class="app-body">app</p>', watchFrames: () => {} });
  return { doc, track, model, wins, host, bar: el => [...el.querySelector('.wbar').children].map(c => c.dataset.wact).filter(Boolean) };
}
// The real Chats pull-to-refresh (web/core/chats-pull.js): a downward drag from the top of the list, let go.
function pullOnce(allowed) {
  const doc = scoped(createDocument()), root = doc.createElement('div'); doc.body.appendChild(root);
  root.innerHTML = '<div class="ch-list"><div class="ch-ptr"><span></span></div><div class="ch-scroll"><p class="row">r</p></div></div>';
  const refreshed = [], st = {};
  const { out } = runPart('web/core/chats-pull.js', 'chatsParts', 'pull', { H: { pullRefresh: () => allowed, win: () => null }, ch: () => st, LIVE: { refresh: () => refreshed.push(1) }, vib: () => {}, winAgent: () => '', chatVars: {} }, { document: doc, setTimeout, clearTimeout });
  out.bindLate({ idOf: () => 'w1', elOf: () => null, holdList: () => false }); out.bindPull(root);
  const target = root.querySelector('.row'); root.querySelector('.ch-scroll').scrollTop = 0;
  const at = y => ({ touches: [{ clientX: 10, clientY: y }] });
  for (const [type, e] of [['touchstart', at(0)], ['touchmove', at(30)], ['touchmove', at(200)], ['touchend', { touches: [] }]]) target.dispatchEvent({ type, bubbles: true, target, ...e });
  return refreshed.length;
}
test('stock shell: no ↻ in window bars and pull-to-refresh stays unless a package holds window refresh', () => {
  const p = phoneWindows(); const el = p.wins.makeWin({ id: 'w1', app: 'settings' }); p.track.appendChild(el);
  assert.deepEqual(p.bar(el), ['full', 'close'], 'stock: no ↻');
  assert.equal(p.host.pullRefresh(), true, 'stock: Chats keeps pull-to-refresh');
  assert.equal(pullOnce(p.host.pullRefresh()), 1, 'a pull refreshes the list');
  const release = p.model.windowRefreshAdapter.use({ pull: false });
  assert.deepEqual(p.bar(el), ['reload', 'full', 'close'], 'an open window gets ↻ beside full screen');
  assert.deepEqual(p.bar(p.wins.makeWin({ id: 'w2', app: 'settings' })), ['reload', 'full', 'close'], 'and so does a new one');
  assert.equal(p.host.pullRefresh(), false); assert.equal(pullOnce(p.host.pullRefresh()), 0, 'Chats opts out of the pull');
  release();
  assert.deepEqual(p.bar(el), ['full', 'close'], 'released: ↻ goes'); assert.equal(p.host.pullRefresh(), true);
  const keep = p.model.windowRefreshAdapter.use({ pull: true }); assert.deepEqual(p.bar(el), ['reload', 'full', 'close']); assert.equal(p.host.pullRefresh(), true, 'pull: true keeps the pull'); keep();
  // ↻ on a built-in view remounts it where it was (web/app-deskbar.js reloadWin): its tile placement stays.
  el.style.cssText = 'grid-area: 1 / 2'; el.className = 'win app-settings tile-b'; const laid = [];
  const dk = runRecording(`${block(readRaw('web/app-deskbar.js'), 'function reloadWin(id) {')}\nthis.reloadWin = reloadWin;`, { appVars: { W: { w1: { id: 'w1', app: 'settings' } } }, winEl: () => el, CHATS: { isHosted: () => false }, makeWin: p.wins.makeWin, mountWin: () => {}, applyLayout: i => laid.push(i), deskOf: () => 3, window: { WizCore: {} } });
  dk.reloadWin('w1'); const now = p.track.querySelector('.win');
  assert.notEqual(now, el, 'a fresh window'); assert.equal(now.className, 'win app-settings tile-b'); assert.equal(now.style.cssText, 'grid-area: 1 / 2', 'a remounted window keeps its tile placement'); assert.deepEqual(laid, [3]);
});
test('layout handles become inert on disposal and their cleanup is idempotent', async () => {
  const f = fixture(); let api;
  f.host._test.setImporter(async () => ({default:a=>{api=a;return()=>{};}}));
  await f.mount('wizard/phone-recovery-mode'); await f.clear();
  api.layout.use('two-orb')(); assert.equal(f.host.layout,'classic');
});


test('own recipes expose all installed tweaks, use published defaults and isolate builtin choices', async () => {
  const f = wizardExperience();
  f.window.WosSkin.familyOf = id => id === 'obsidian-light' ? 'mizel' : 'wizard';
  f.window.WosSkin.families.push({id:'mizel',name:'Mizel',tweaks:'miguel'});
  await f.E.refresh(); const defaults = await f.E.defaults();
  assert.equal(defaults['wizard/failure-reason'], false); assert.equal(defaults['wizard/phone-recovery-mode'], false);
  assert.equal(defaults['miguel/snooze-someday'], false, 'a new skin starts from what runs now');
  await f.E.toggle('miguel/snooze-someday'); assert.equal((await f.E.defaults())['miguel/snooze-someday'], true);
  await f.E.toggle('miguel/snooze-someday');
  const skin = {id:'quiet',tweaks:{...defaults,'miguel/snooze-someday':true}};
  f.window.WosMySkin = {active:skin,update(v){ Object.assign(skin.tweaks,v.tweaks); }};
  await f.E.refresh(); const cat = JSON.parse(read('web/tweaks/catalog.json')); assert.equal(f.E.state.tweaks.length, cat.tweaks.length + coreIds.length - (cat.oneOf || []).reduce((n, g) => n + g.length - 1, 0), 'one switch per oneOf group');
  assert.deepEqual(f.active(),['miguel/snooze-someday']);
  await f.E.toggle('wizard/failure-reason'); assert.ok(f.active().includes('wizard/failure-reason'));
  f.window.WosMySkin.active=null; await f.E.refresh(); assert.deepEqual(f.active(),[]);
});

test('installed list warms base profiles so picking Mizel does not wait for another network request', async () => {
  const f = wizardExperience(); f.window.WosSkin.families.push({ id: 'mizel', tweaks: 'miguel' });
  f.window.WosSkin.familyOf = id => id === 'obsidian-light' ? 'mizel' : 'wizard';
  await f.E.installed();
  const count = () => f.requests.filter(p => p.endsWith('/miguel/profile.json')).length;
  assert.equal(count(), 1);
  await f.E.refresh(); await f.E.toggle('miguel/snooze-someday'); assert.equal((await f.E.defaults())['miguel/snooze-someday'], true);
  await f.E.defaults(); assert.equal(count(), 1);
});

test('disposed foundation capability cannot change windows', async () => {
  const f = fixture(); let api;
  f.host._test.setImporter(async () => ({default:a=>{api=a;return()=>{};}}));
  await f.mount('wizard/phone-recovery-mode'); await f.clear(); api.layout.foundation('framed')();
  assert.equal(f.ctx.window.WosSkin.frame.foundation, 'borderless');
});

test('slot lookup prefers a visible instance over hidden Chats copies (desktop)', async () => {
  // The real slot lookup (skin-host-tweaks.js) on a desktop page with hidden Chats copies.
  const src = withSkinHostParts(read('web/core/skin-host.js'));
  const doc = createDocument();
  doc.body.innerHTML = '<div id="hidden"><div data-slot="list-top" id="a"></div></div><div id="shown"><div data-slot="list-top" id="b"></div></div><div id="front"><div data-slot="list-top" id="c"></div></div>';
  const show = (id, on) => { doc.getElementById(id).getClientRects = () => (on ? [{ width: 10, height: 10 }] : []); };
  const lookup = root => runRecording(between(src, '      const slot = name => {', '      const borrowed = new Map();') + '\nthis.slot = slot;',
    { document: doc, slotContract: { slots: { 'list-top': {} } }, shell: { root: () => doc.getElementById(root) } }).slot;
  show('a', false); show('b', true); show('c', true);
  assert.equal(lookup('front')('list-top').id, 'c', 'the focused Chats window first');
  assert.equal(lookup('hidden')('list-top').id, 'b', 'its copy hidden: the first visible instance');
  show('b', false); show('c', false);
  assert.equal(lookup('hidden')('list-top').id, 'a', 'none visible: the own one');
  assert.equal(lookup('front')('not-a-slot'), null, 'only contract slots');
});

test('beside hook: layout-gated event on change only, never a route event, and route().beside for late packages', async () => {
  const f = fixture(); let api; const seen = [], routes = [];
  f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  await f.host.loadTweaks(['miguel/snooze-someday'], f.slots, { teamAuthors: ['miguel'] });
  assert.throws(() => api.on('beside', () => {}), /requires layout/);
  await f.host.loadTweaks(['miguel/calm-offline'], f.slots, { teamAuthors: ['miguel'] });
  api.on('beside', b => seen.push(b.side)); api.on('route', r => routes.push(r));
  f.setRoute({ beside: 1 }); f.setRoute({ beside: 1 }); f.setRoute({ beside: -1 }); f.setRoute({ beside: 0 });
  assert.deepEqual(seen, [1, -1, 0]); assert.equal(routes.length, 0, 'route listeners see nothing new');
  f.setRoute({ beside: 7 }); assert.equal(api.route().beside, 1, 'normalised to -1 | 0 | 1');
  assert.equal(api.mount, undefined, 'device controls go through the declared device-edge slot, not a raw mount');
  await f.clear(); f.setRoute({ beside: -1 }); assert.deepEqual(seen, [1, -1, 0, 1], 'a torn-down package hears nothing');
});
test('app.js tells the host when the bound view beside a thread changes, and reports it in route()', () => {
  const doc = createDocument(); doc.body.innerHTML = readRaw('web/index.html').split(/<body[^>]*>/)[1].split('</body>')[0];
  const device = doc.querySelector('#device');
  assert.equal(device.dataset.slot, 'device-edge', 'the device is the device-edge slot'); assert.ok(JSON.parse(readRaw('web/core/slots.json')).slots['device-edge']);
  let told = 0, adapter;
  const W = { t: { id: 't', app: 'chats', thread: 's1' }, v: { id: 'v', app: 'frame', bound: 't', bsid: 's1' } };
  const appVars = { W, desks: [{ id: 'a', focus: 't', wins: ['t'] }, { id: 'b', focus: 'v', wins: ['v'] }], idx: 0 };
  const peek = runRecording(`${block(readRaw('web/app-bound.js'), 'function syncPeek() {')}\nthis.syncPeek = syncPeek;`, { appVars, device, track: doc.body, boundOf: () => ({ id: 'v', bsid: 's1' }), deskOf: id => (id === 'v' ? 1 : 0), secOf: () => null, $$: () => [], window: { WosSkinHost: { beside: () => told++ } } });
  runPart('web/app-agentorb.js', 'appParts', 'agentorb', { appVars, device, HOME: 0 }, { window: { WosSkinHost: { attach: o => { adapter = o; } }, WosAgents: {} } });
  peek.syncPeek(); assert.equal(told, 1, 'the host hears every peek change'); assert.ok(device.classList.contains('bound-peeking')); assert.equal(adapter.route().beside, 1, 'on the thread: the view leans in from the right');
  appVars.idx = 1; peek.syncPeek(); assert.equal(told, 2); assert.ok(device.classList.contains('bound-view-peeking')); assert.ok(!device.classList.contains('bound-peeking'));
  assert.equal(adapter.route().beside, -1, 'on the bound view: its thread leans in from the left');
  W.t.thread = 's2'; peek.syncPeek(); assert.equal(told, 3); assert.equal(adapter.route().beside, 0, 'nothing beside');
});

test('inbox capability is trusted-only, and its handles die with the package', async () => {
  const f = fixture(); let api;
  f.host._test.setImporter(async () => ({ default: value => { api = value; return () => {}; } }));
  await f.host.loadTweaks(['wizard/unified-inbox'], f.slots);
  assert.equal(api.inbox, undefined, 'an untrusted package gets no inbox');
  await f.host.loadTweaks(['wizard/unified-inbox'], f.slots, { teamAuthors: ['wizard'] });
  const seen = []; api.inbox.watch(items => seen.push(items.length));
  f.inbox.push([{ id: 'a', title: 't', message: 'm', time: 1 }]); assert.deepEqual(seen, [1]);
  assert.equal(api.inbox.reply('a', 'go'), true); assert.deepEqual(f.inbox.replies, [['a', 'go']]);
  assert.equal(api.inbox.reply('missing'), false, 'only a listed notification can be answered');
  await api.inbox.done('a'); assert.deepEqual(f.inbox.done, ['a']);
  const stale = api.inbox; await f.clear();
  assert.equal(f.inbox.watchers(), 0, 'teardown stops watching');
  assert.equal(stale.reply('a'), false); assert.equal(await stale.done('a'), false); f.inbox.push([]); assert.deepEqual(seen, [1], 'stale handles are inert');
});

test('notification threads: the flag lives only while a trusted package holds it, and acts route to it', async () => {
  const f = fixture(); let api;
  f.host._test.setImporter(async () => ({ default: value => { api = value; return () => {}; } }));
  await f.host.loadTweaks(['wizard/unified-inbox'], f.slots, { teamAuthors: ['wizard'] });
  assert.equal(f.host.inboxThreads, false); assert.equal(f.host.inboxAct('done', 'x'), false);
  const got = []; api.inbox.threads({ act: (a, id) => got.push(a + ':' + id) });
  assert.equal(f.host.inboxThreads, true); assert.equal(f.host.inboxAct('snooze', 'n1'), true); assert.deepEqual(got, ['snooze:n1']);
  assert.equal(await api.inbox.set('n1', { 'read': true, flag: true }), true); assert.equal(JSON.stringify(f.inbox.sets), JSON.stringify([['n1', { read: true }]]), 'only read / archived pass');
  await f.clear(); assert.equal(f.host.inboxThreads, false, 'released on teardown');
});

test('notification rows in the list: only a holder that asks for list mode turns it on', async () => {
  const f = fixture(); let api;
  f.host._test.setImporter(async () => ({ default: value => { api = value; return () => {}; } }));
  await f.host.loadTweaks(['wizard/unified-inbox'], f.slots, { teamAuthors: ['wizard'] });
  const off = api.inbox.threads({ act: () => {} });
  assert.equal(f.host.inboxThreads, true); assert.equal(f.host.inboxList, false, 'threads alone keep the list unchanged');
  off(); api.inbox.threads({ act: () => {}, list: 'yes' }); assert.equal(f.host.inboxList, false, 'only list: true');
  api.inbox.threads({ act: () => {}, list: true }); assert.equal(f.host.inboxList, true);
  await f.clear(); assert.equal(f.host.inboxList, false, 'released on teardown');
});

// The real Ready list parts (web/core/chats-readylist.js with its events, notes, drafts and tracker parts) in node:vm.
function readyParts({ inboxList = true, inboxThreads = true, order = 'newest', draft = null, items = null, W = {} } = {}) {
  items ||= [{ id: 'n1', title: 'Backup done', message: 'ok', time: 1500, read: false }, { id: 'n2', title: 'Old', message: 'x', time: 100, read: true }];
  const ctx = { window: { WizCore: { chatsParts: {} }, WosSkinHost: { inboxList, inboxThreads, inboxAct: (...a) => ctx.acts.push(a) }, WosBell: { items: () => items, item: id => items.find(i => i.id === id) || null, watch: () => () => {} }, addEventListener() {} }, acts: [], setTimeout, clearTimeout, localStorage: { getItem: () => null } };
  modelContext(ctx); ctx.window.WizChatsListModel = ctx.WizChatsListModel;
  for (const p of ['events', 'notes', 'drafts', 'tracker']) loadFile(`web/core/chats-${p}.js`, ctx);
  const { out } = runPart('web/core/chats-readylist.js', 'chatsParts', 'readylist', { chatVars: { readyOrder: order }, esc: String, clip: s => s, ago: () => 'now', LIVE: { cardAt: s => s.at, isNew: () => false },
    READY_ORDERS: ['newest', 'priority', 'subject'], READY_ORDER_LABEL: { newest: 'Newest', priority: 'Priority', subject: 'By subject' }, deferredOf: () => false, attOf: () => null, CH: {}, W, owner: id => id, winAgent: () => '', vib: () => {},
    KIT: { drafts: { all: () => ({}), get: () => ({ reply: draft }) }, reply: {} } }, ctx);
  return { out, ctx };
}
const ROWS = [{ id: 's1', title: 'A', at: 2000 }, { id: 's2', title: 'B', at: 1000 }];
const shown = html => { const doc = createDocument(); doc.body.innerHTML = html; return doc.body.querySelectorAll('[data-chopen], [data-chnotif], .ch-rdy-bar, .ch-subj > span:first-child').map(e => e.dataset.chopen || e.dataset.chnotif || (e.className === 'ch-rdy-bar' ? 'bar' : e.textContent)); };
test('chats.js lists notifications among Ready chats only in list mode, in every Ready order', () => {
  const row = s => `<div data-chopen="${s.id}"></div>`;
  for (const [order, want] of [['newest', ['bar', 's1', 'n1', 's2', 'n2']], ['oldest', ['bar', 's2', 'n1', 's1', 'n2']], ['priority', ['bar', 'FYI', 'n1', 'No status', 's1', 's2', 'n2']], ['subject', ['bar', 'Notifications', 'n1']]]) {
    const { out } = readyParts({ order }), nt = out.notes();
    assert.deepEqual(shown(out.readyBody(ROWS, row, nt, 'ready')).slice(0, want.length), want, `${order}: notifications interleave with Ready`);
    assert.ok(shown(out.readyBody(ROWS, row, nt, 'ready')).includes('n1'));
    assert.ok(!shown(out.readyBody(ROWS, row, nt, 'yesterday')).includes('bar'), `${order}: only Ready owns the order controls`);
  }
  const off = readyParts({ inboxList: false }).out;
  assert.equal(off.notes(), null, 'gated on the host list flag'); assert.deepEqual(shown(off.readyBody(ROWS, row, off.notes(), 'ready')), ['bar', 's1', 's2']);
  // Only the Ready section is handed the notifications (web/core/chats-listpaint.js through the real list render).
  const f = listFixture(), got = []; const nt = { awake: [{ id: 'n1' }], later: [] };
  f.ctx.notes = () => nt; f.ctx.readyBody = (list, rowFn, n, sec) => { got.push([sec, n === nt]); return list.map(rowFn).join(''); }; f.render('');
  assert.ok(got.some(([sec, has]) => sec === 'ready' && has), 'Ready gets them'); assert.ok(got.every(([sec, has]) => sec === 'ready' || !has), 'no other section does');
  // A tap on a listed notification goes to the package (web/core/chats-bind.js click).
  const doc = createDocument(); doc.body.innerHTML = '<div class="ch-list"><div class="ch-notif-row" data-chnotif="n7"><b>t</b></div></div>'; const acts = [];
  const c = runRecording(`${block(readRaw('web/core/chats-bind.js'), 'function click(e, id) {')}\nthis.click = click;`, { window: { WosSkinHost: { inboxAct: (...a) => acts.push(a) } }, chatVars: {}, justPressed: () => false, topicOn: () => false, W: {}, H: { win: () => ({ id: 'w1' }) } });
  assert.equal(c.click({ target: doc.body.querySelector('b') }, 'w1'), true); assert.deepEqual(acts, [['open', 'n7']]);
});
test('chats.js shows a notification draft as its thread only while notification threads are on', () => {
  const draft = { key: 'notifications:n1', title: 'Backup done', message: 'ok' }, W = { w1: { id: 'w1', thread: '__new__' } };
  assert.equal(readyParts({ draft, W }).out.notifOf(W.w1).id, 'n1', 'a New chat carrying a notification is its thread');
  assert.equal(readyParts({ draft, W, inboxThreads: false }).out.notifOf(W.w1), null, 'only while notification threads are on');
  assert.equal(readyParts({ draft, W }).out.notifOf({ id: 'w1', thread: 's1' }), null, 'a real thread is never one');
  assert.equal(readyParts({ draft: { key: 'other:x' }, W }).out.notifOf(W.w1), null, 'a draft without a notification stays a New chat');
  // The thread paints it only while nothing is pending (web/core/chats-threadpaint.js).
  const nv = (isNew, pend) => runRecording(`${between(readRaw('web/core/chats-threadpaint.js'), 'const NV = isNew', '\n')}\nthis.NV = NV;`, { isNew, pend, notifOf: () => ({ id: 'n1' }) }).NV;
  assert.deepEqual(nv(true, []), { id: 'n1' }); assert.equal(nv(true, [{}]), null); assert.equal(nv(false, []), null);
  // Its row actions go to the notification, not a chat (web/core/chats-rowacts.js threadAct).
  const routed = []; const ra = runPart('web/core/chats-rowacts.js', 'chatsParts', 'rowacts', { owner: id => id, notifAct: (...a) => routed.push(a), rowOf: () => null, ACT: {} }).out;
  ra.threadAct('w1', '__new__', 'done'); assert.deepEqual(routed, [['w1', 'done']]);
  const { out, ctx } = readyParts({ draft, W }); out.draftsLate({ PHONE: () => false, renderChats: () => {} }); out.notifAct('w1', 'resolve');
  assert.deepEqual(ctx.acts[0], ['resolve', 'n1'], 'the package gets the act');
  // Desktop ⌥X Resolve: an empty New chat is refused, an open notification reaches the thread act.
  for (const open of [true, false]) {
    const acted = []; const k = desktopKeys({ focused: () => ({ id: 'f', app: 'chats', thread: '__new__' }), CHATS: { notifOpen: () => open, threadAct: (...a) => acted.push(a) }, winEl: () => ({ querySelector: () => ({}) }), homeOpen: false });
    k.key('KeyX');
    if (open) assert.deepEqual(acted, [['f', '__new__', 'resolve']]);
    else { assert.deepEqual(acted, []); assert.ok(k.calls.some(c => c[0] === 'toast' && /Open a chat first/.test(c[2])), 'an empty new chat is refused'); }
  }
});

// The real desktop Ready walk (web/desktop/desktop-divider.js readyRows) over a mini-dom page with on-screen rows.
function readyWalk(html) {
  const doc = createDocument(); doc.body.innerHTML = html;
  for (const el of doc.body.querySelectorAll('[data-top]')) { const top = +el.dataset.top; el.getClientRects = () => [{ top }]; el.getBoundingClientRect = () => ({ top }); }
  const { readyRows } = runPart('web/desktop/desktop-divider.js', 'desktopParts', 'divider', { $$: (sel, root) => [...root.querySelectorAll(sel)], winEl: () => doc.body.querySelector('.win'), store: { get: () => null } }, { document: doc }).out;
  return [...readyRows('w')].map(r => r.dataset.chopen || r.dataset.chnotif);
}
test('desktop keys: ⌥↓ walks notification rows with Ready, ⌥X resolves an open notification', async () => {
  const sec = rows => `<div class="pane-list" data-top="0"><section class="ch-sec" data-sec="ready">${rows}</section><section class="ch-sec" data-sec="working"><div class="ch-row" data-chopen="w1" data-top="1"></div></section></div>`;
  assert.deepEqual(readyWalk(`<div class="win">${sec('<div class="ch-row" data-chopen="s1" data-top="10"></div><div class="ch-row ch-notif-row" data-chnotif="n1" data-top="20"></div><div class="ch-row" data-chopen="s2" data-top="30"></div>')}</div>`), ['s1', 'n1', 's2'], 'list rows walk in on-screen order with Ready (Working skipped)');
  assert.deepEqual(readyWalk(`<div class="win">${sec('<div class="ch-row" data-chopen="s1" data-top="10"></div><div data-slot="ready-top"><button data-chnotif="t1" data-top="5"></button></div><div data-slot="ready-end"><button data-chnotif="t2" data-top="1"></button></div>')}</div>`), ['t1', 's1', 't2'], 'package rows: new ones first, snoozed (ready-end) last');
  // ⌥↓ is wired to that walk; ⌥X hands Resolve to the thread act (an open notification), see the test above.
  const k = desktopKeys({ focused: () => ({ id: 'f', app: 'chats' }) }); k.key('ArrowDown');
  assert.ok(k.calls.some(c => c[0] === 'chatsUpDown' && c[1] === 1), '⌥↓ walks down');
  // The package marks its own rows with [data-chnotif] (the real unified-inbox package in the shell fixture).
  const f = fixture(); await f.mount('wizard/unified-inbox');
  f.inbox.push([{ id: 'd1', title: 'Old', message: 'done', time: 0, read: true, archived: true }]);
  const all = (n, out = []) => { if (n.dataset?.uiId) out.push(n); (n.children || []).forEach(c => all(c, out)); return out; };
  const doneBtn = (function find(n) { return (n.className || '').split(' ').includes('ui-done-btn') ? n : (n.children || []).map(find).find(Boolean); })(f.doc.body);
  doneBtn.fire('click', {});
  assert.deepEqual(all(f.doc.body).map(r => r.dataset.chnotif), ['d1']); await f.clear();
});

test('core features: each id core/core-features.json describes loads from core/ or not at all, never from tweaks/ (issue 1352)', async () => {
  for (const id of coreIds) {
    const m = coreFeatures[id]; assert.equal(m.id, id); assert.equal(m.author, id.split('/')[0]); assert.equal(m.apiVersion, 1); assert.ok(Array.isArray(m.capabilities));
    const f = fixture({ shell: m.shells?.[0] || 'phone' }); await f.mount(id);
    assert.ok(!f.imports.some(u => u.includes('/tweaks/')) && !f.doc.head.children.some(l => /\/tweaks\//.test(l.href || '')), id + ': nothing from tweaks/');
    if (m.view) assert.deepEqual([...f.host.tweakState], [], id + ': a view the desktop wears itself, no code');
    else assert.ok(f.host.tweakState.includes(id) && f.imports.some(u => u.includes('/core/')), id + ': its code from core/');
    await f.clear();
  }
});
test('Notifications in Chats is on by default for everyone, whatever tweak set', async () => {
  const f = wizardExperience(); await f.E.refresh(); assert.ok(f.all().includes('wizard/unified-inbox'));
  assert.equal(f.E.state.tweaks.find(t => t.id === 'wizard/unified-inbox').on, true);
  // Built into the shell since issue 1352: no tweak package, no catalog entry, no profile entry; New skin never lists it.
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(!cat.tweaks.includes('wizard/unified-inbox') && !cat.defaults.includes('wizard/unified-inbox') && !Object.values(cat.aliases).includes('wizard/unified-inbox'));
  assert.ok(!JSON.parse(read('web/tweaks/wizard/profile.json')).tweaks.includes('wizard/unified-inbox'));
  assert.ok(!existsSync(new URL('../web/tweaks/wizard/unified-inbox', import.meta.url)), 'the tweak package is gone');
  assert.equal(coreFeatures['wizard/unified-inbox'].default, true);
  assert.equal((await f.E.defaults())['wizard/unified-inbox'], undefined, 'a Settings › Chats setting, not a New skin switch');
  // and it loads from core/, through the same loader (one API, one teardown)
  const h = fixture(); await h.mount('wizard/unified-inbox'); assert.ok(h.host.tweakState.includes('wizard/unified-inbox'));
  assert.ok(h.imports.some(u => /\/core\/unified-inbox\.js/.test(u)) && !h.imports.some(u => /tweaks\/wizard\/unified-inbox/.test(u)));
  assert.ok(h.doc.head.children.some(l => /\/core\/unified-inbox\.css/.test(l.href || '')), 'its stylesheet from core/');
  await h.clear();
  // (a release-wide default, so no set needs to list it: 'notifications preserve existing Miguel off choices and old
  // custom-skin ids after promotion' runs the real experience.js on the real catalog defaults)
});

test('Notifications sits with the agent apps while its inbox lives in Chats', () => {
  // Production registry splits URL-backed apps and backendApps into disjoint lists.
  const window = { WizCore: { backendApps: () => [] }, WosSkinHost: { inboxThreads: false } };
  vm.runInNewContext(read('web/core/app-kinds.js'), { window });
  const app = { id: 'notifications', name: 'Notifications', kind: 'wizard', url: '/notifications/' };
  const K = () => window.WosAppKinds.kinds([app], { notifications: app });
  assert.deepEqual([K().apps.length, K().wiz.length], [1, 0], 'stock: still an app');
  window.WosSkinHost.inboxThreads = true;
  // Normalize the VM-created array into this test's realm before comparing prototypes.
  assert.deepEqual([K().apps.length, Array.from(K().wiz, a => a.id)], [0, ['notifications']], 'inbox in Chats: an agent app');
  assert.equal(window.WosAppKinds.isSystem(app), true, 'and a system app');
});

test('James: notifications are on for every skin, with one persistent owner off-switch', async () => {
  let f = wizardExperience();
  for (const skin of ['nebula', 'novairecito']) {
    f.skin(skin); await f.E.chooseSkin();
    assert.ok(f.all().includes('wizard/unified-inbox'), skin);
    assert.equal(f.E.state.tweaks.find(t => t.id === 'wizard/unified-inbox').on, true);
  }
  await f.E.toggle('wizard/unified-inbox');
  assert.ok(!f.all().includes('wizard/unified-inbox'));
  f = wizardExperience(f.storage); await f.E.refresh();
  assert.ok(!f.all().includes('wizard/unified-inbox'), 'reload keeps owner off');
  f.skin('novairecito'); await f.E.chooseSkin();
  assert.ok(!f.all().includes('wizard/unified-inbox'), 'changing skin keeps owner off');
  await f.E.toggle('wizard/unified-inbox'); assert.ok(f.all().includes('wizard/unified-inbox'));
});
test('notifications preserve existing Miguel off choices and old custom-skin ids after promotion', async () => {
  const saved = new Map([['wos.skin-tweaks.v1', JSON.stringify({version:1, off:{miguel:['miguel/unified-inbox']}})]]);
  let f = wizardExperience(saved); await f.E.refresh();
  assert.ok(!f.all().includes('wizard/unified-inbox'), 'deliberate legacy off is not overwritten');
  f = wizardExperience();
  const skin = {tweaks:{'miguel/unified-inbox':false}};
  f.window.WosMySkin={active:skin, update(v){Object.assign(skin.tweaks,v.tweaks);}};
  await f.E.refresh(); assert.ok(!f.all().includes('wizard/unified-inbox'), 'old recipe off survives alias');
  await f.E.toggle('wizard/unified-inbox'); assert.ok(f.all().includes('wizard/unified-inbox'));
});


// The real Settings › Look tweak list (web/core/settings.js tweakRows with its tweakSwitches), For testers.
function lookTweaks(tweaks, own = null) {
  const s = readRaw('web/core/settings.js');
  const ctx = runRecording(`${between(s, '  const tweakSwitches =', '\n')}\n${block(s, '  function tweakRows(')}\nthis.tweakRows = tweakRows;`, { window: { WosExperience: { state: { tweaks, channel: 'latest', shell: 'phone' }, authors: async () => [] }, WosMySkin: { active: own } },
    esc: v => String(v), shellTweaks: l => l, tweakOpts: new Map(), mounts: [], authorList: [{ id: 'miguel', name: 'Miguel' }, { id: 'wizard', name: 'Wizard' }] });
  const doc = createDocument(); doc.body.innerHTML = ctx.tweakRows({}); return doc.body;
}
test('Settings › Look: one flat Tweaks list, a switch per tweak labelled by author, no "All of" buttons, in every skin (Miguel, 1 Nov 2026)', () => {
  const tweaks = [{ id: 'wizard/zeta', name: 'Zeta', author: 'wizard', on: true }, { id: 'miguel/alpha', name: 'Alpha', author: 'miguel', on: false }, { id: 'miguel/mid', name: 'Mid', author: 'miguel', on: true }];
  for (const own of [null, { id: 'quiet', tweaks: {} }]) {
    const root = lookTweaks(tweaks, own), lists = root.querySelectorAll('.tw-list');
    assert.equal(lists.length, 1, 'one flat list (own skins too)');
    const sw = lists[0].querySelectorAll('[data-tweak-toggle]');
    assert.deepEqual(sw.map(b => b.dataset.tweakToggle), ['miguel/alpha', 'miguel/mid', 'wizard/zeta'], 'A to Z by name, one switch each');
    assert.deepEqual(sw.map(b => b.getAttribute('role')), ['switch', 'switch', 'switch']);
    assert.deepEqual(sw.map(b => b.querySelector('.tw-by').textContent), ['by Miguel', 'by Miguel', 'by Wizard'], 'labelled by author');
    assert.deepEqual(sw.map(b => b.getAttribute('aria-checked')), ['false', 'true', 'true']);
    assert.equal(root.querySelectorAll('details, [data-tweakauthor], .tw-author').length, 0, 'no author sections, nothing behind a disclosure');
    assert.doesNotMatch(root.textContent, /All of/, 'no quick buttons');
  }
});

test('flat Tweaks list keeps a device mix exactly: whatever is on stays on, rendered as one switch each (Miguel, 1 Nov 2026)', async () => {
  const mix = { 'miguel/send-and-go': true, 'wizard/phone-recovery-mode': true, 'miguel/snooze-someday': false };
  const storage = new Map([['wos.skin', 'obsidian'], ['wos.skin-tweaks.v1', JSON.stringify({ version: 1, off: {}, preset: 'none', mix, machinesHomeMoved: true, miguelLayoutMoved: true })]]); let active = [];
  const window = { WosSkin: { current: 'obsidian', families: [], familyOf: () => 'mizel' }, WosSkinHost: { personalState: { ready: false }, get tweakState() { return active; }, loadTweaks: async ids => { active = ids; } }, addEventListener() {}, dispatchEvent() {} };
  vm.runInNewContext(read('web/core/experience.js'), { window, setTimeout, document: { baseURI: 'https://wizard.test/wizard-os-home/', addEventListener() {} }, Event, URL, AbortSignal, localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) }, fetch: async url => ({ ok: true, json: async () => JSON.parse(read('web/' + url.pathname.split('/wizard-os-home/')[1])) }) });
  const E = window.WosExperience; await E.refresh(); const defs = builtinDefaults(JSON.parse(read('web/tweaks/catalog.json')));
  assert.deepEqual(Array.from(active).filter(id => !defs.includes(id)).sort(), ['miguel/send-and-go', 'wizard/phone-recovery-mode'], 'the stored mix loads as it was');
  const saved = JSON.parse(storage.get('wos.skin-tweaks.v1')).mix;
  for (const [id, on] of Object.entries(mix)) assert.equal(saved[id], on, id + ' kept');
  const on = Array.from(E.state.tweaks.filter(t => t.on && !t.builtin), t => t.id).sort();
  assert.deepEqual(on, ['miguel/send-and-go', 'wizard/phone-recovery-mode'], 'the switches agree');
  assert.equal(E.chooseAuthor, undefined);
});

const REMOVED = ['wizard/share-people-box', 'wizard/channel-model-emoji', 'wizard/channel-auto-emoji', 'wizard/chats-switcher', 'wizard/agent-approvals', 'wizard/phone-tester-builds', 'wizard/sent-rows', 'wizard/orb-radial', 'wizard/new-send-list', 'wizard/wizardos-name', 'wizard/two-orbs', 'wizard/app-borders', 'wizard/pin-buttons', 'miguel/no-desk-close', 'miguel/group-by-day', 'miguel/switch-row-actions', 'miguel/orb-shell', 'miguel/apps-home', 'wizard/bar-scrub', 'wizard/chat-channels', 'wizard/thread-tracker', 'wizard/app-updates-list', 'wizard/pin-fast-open', 'wizard/draft-marks', 'wizard/pin-reach-answer', 'wizard/agent-inbox', 'wizard/chats-inbox', 'wizard/settings-search', 'wizard/standard-first-setup', 'wizard/background-continue', 'wizard/local-app-routes', 'wizard/app-wake', 'wizard/app-windows', 'wizard/assist-attach', 'wizard/install-in-sidebar', 'wizard/desktop-chats', 'wizard/capability-registry', 'wizard/capture-inbox', 'wizard/needs-you-reason', 'wizard/follow-main', 'wizard/app-tap-home', 'wizard/plain-chat-titles', 'wizard/download-swipe', 'wizard/interface-manual', 'wizard/write-guard', 'wizard/sidebar-chats-view', 'wizard/action-cards', 'wizard/phone-sections', 'wizard/inbox-rows', 'wizard/chat-tags', 'wizard/chats-title-bar', 'wizard/phone-nav', 'wizard/catch-me-up', 'wizard/inbox-until-archived', 'wizard/sent-threads', 'wizard/plain-alert-rows', 'wizard/private-mode'];
test('retired Orb radial and the switches removed in wizard-ux issue 1239: saved mixes and recipes never request a removed package', async () => {
  const mixes = [
    new Map(),
    new Map([['wos.skin-tweaks.v1', JSON.stringify({ version:1, off:{wizard:[]} })], ['wos.app-borders.migrated.v1','true']]),
    new Map([['wos.skin-tweaks.v1', JSON.stringify({ version:1, off:{}, preset:'none', mix:Object.fromEntries(REMOVED.map(id=>[id,true])) })]]),
  ];
  for (const storage of mixes) {
    let f=wizardExperience(storage); await f.E.refresh();
    for (const id of REMOVED) { assert.equal(f.E.state.tweaks.find(t=>t.id===id),undefined,id); assert.ok(!f.all().includes(id),id); assert.equal((await f.E.defaults('nebula'))[id],undefined,id); }
    const skin={tweaks:{}}; f.window.WosMySkin={active:skin, update(v){Object.assign(skin.tweaks,v.tweaks);}};
    await f.E.refresh(); assert.ok(!f.all().includes('wizard/orb-radial'),'missing old recipe key inherits OFF');
    for (const id of REMOVED) skin.tweaks[id]=true; await f.E.refresh();
    for (const id of REMOVED) assert.ok(!f.all().includes(id),'orphan recipe choice is ignored, other tweaks still load: '+id);
    f.window.WosMySkin.active=null; await f.E.refresh();
    for (const on of [true, false]) {
      storage.set('wos.skin-tweaks.v1', JSON.stringify({version:1, off:{}, preset:'none', mix:{...Object.fromEntries(REMOVED.map(id=>[id,on])),'wizard/phone-recovery-mode':true}}));
      f=wizardExperience(storage); await f.E.refresh();
      for (const id of REMOVED) assert.ok(!f.all().includes(id), id); assert.ok(f.all().includes('wizard/phone-recovery-mode'));
      assert.equal(f.E.state.error, '');
    }
  }
});
