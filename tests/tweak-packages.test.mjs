import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fixture, contract, read } from './fixtures/tweaks.mjs';
const catalog = JSON.parse(read('web/tweaks/catalog.json'));
for (const id of catalog.tweaks) {
  const check = (await import(new URL(`../web/tweaks/${id}/contract.mjs`, import.meta.url))).default;
  test(`${id}: shipped contract mounts / tears down against the shell fixture`, () => contract(id, check, id === 'miguel/send-and-go' ? 'desktop' : 'phone'));
}
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
  const id = 'miguel/hidden-pin'; const bad = { ...JSON.parse(read(`web/tweaks/${id}/manifest.json`)), apiVersion: 999 };
  const f = fixture({ manifests: { [id]: bad } });
  await f.host.loadTweaks([id, 'miguel/home-bars'], f.slots, { teamAuthors: ['miguel'] });
  assert.deepEqual(Array.from(f.host.tweakState), ['miguel/home-bars']); assert.match(f.toasts[0], /turned off.*Incompatible API/); await f.clear();
});
test('capabilities are namespace gated; author metadata alone cannot grant model/data access', async () => {
  const f = fixture(); let api;
  f.host._test.setImporter(async () => ({ default: value => { api = value; return () => {}; } }));
  await f.host.loadTweaks(['miguel/home-bars'], f.slots);
  assert.ok(api.slot); assert.equal(api.data, undefined); assert.equal(api.nav, undefined); assert.equal(api.thread, undefined);
  await f.host.loadTweaks(['miguel/model-pills'], f.slots, { trustedAuthors: ['miguel'] });
  assert.ok(api.models); assert.ok(api.thread); assert.equal(api.data, undefined); assert.equal(api.nav, undefined); await f.clear();
});
test('multiple ordered packages clean listeners, CSS, mounts and action interception on replacement', async () => {
  const f = fixture(); await f.host.loadTweaks(catalog.tweaks, f.slots, { teamAuthors: ['miguel'] });
  assert.equal(f.host.tweakState.length, catalog.tweaks.length); assert.equal(f.host.action('snooze', {sessionId:'s1'}), true);
  await f.clear(); assert.equal(f.doc.head.children.length, 0); assert.equal(f.thread.handlers.get('touchend').size, 0); assert.equal(f.host.action('snooze', {sessionId:'s1'}), false);
});
test('a skin brings its tweaks; offs are remembered per skin; another skin drops them; new published tweaks arrive', async () => {
  const storage = new Map(); let skin = 'grove', published = { id: 'miguel', version: 1, skin: 'obsidian', tweaks: ['miguel/hidden-pin'], flags: {} }, active;
  const fams = [{ id: 'wizard', palettes: ['grove'] }, { id: 'mizel', tweaks: 'miguel', palettes: ['obsidian', 'landscapes'] }];
  const window = { WosSkin: { get current() { return skin; }, families: fams, familyOf: id => fams.find(f => f.palettes.includes(id)).id }, WosSkinHost: { personalState: { ready: false }, get tweakState() { return active || []; }, loadTweaks: async ids => { active = ids; } }, addEventListener() {}, dispatchEvent() {} };
  const ctx = { window, document: { baseURI:'https://wizard.test/wizard-os-home/', addEventListener() {} }, Event, URL, AbortSignal, localStorage: { getItem:k=>storage.get(k), setItem:(k,v)=>storage.set(k,v) }, fetch: async url => ({ ok:true, json: async () => url.pathname.endsWith('profile.json') ? published : JSON.parse(read('web/'+url.pathname.split('/wizard-os-home/')[1])) }) };
  vm.runInNewContext(read('web/core/experience.js'), ctx); const E = window.WosExperience;
  await E.refresh(); assert.equal(E.state.owner, null); assert.equal(active.length, 0);
  skin = 'obsidian'; await E.chooseSkin(); assert.equal(E.state.owner, 'miguel'); assert.deepEqual(Array.from(active), ['miguel/hidden-pin']);
  await E.toggle('miguel/hidden-pin'); assert.equal(active.length, 0); assert.equal(E.state.tweaks[0].on, false);
  published = { ...published, version:2, tweaks: ['miguel/home-bars','miguel/hidden-pin'] }; await E.refresh();
  assert.deepEqual(Array.from(active), ['miguel/home-bars']);
  skin = 'grove'; await E.chooseSkin(); assert.equal(E.state.owner, null); assert.equal(active.length, 0); assert.equal(E.state.tweaks.length, 0);
  skin = 'landscapes'; await E.chooseSkin(); assert.deepEqual(Array.from(active), ['miguel/home-bars']);
});

test('event access is capability-gated, render payloads have no DOM, stale model and nav APIs are inert', async () => {
  const f=fixture(); let api, payload;
  f.host._test.setImporter(async()=>({default:a=>{api=a;return()=>{};}}));
  await f.host.loadTweaks(['miguel/send-and-go'],f.slots);
  assert.throws(()=>api.on('render',()=>{}),/requires layout/); assert.throws(()=>api.on('sent',()=>{}),/trusted navigation/);
  assert.throws(()=>api.nav.snoozeSomeday('s1'),/Trusted navigation/);
  assert.equal(api.nav.back(),true); assert.equal(f.route().view,'list'); assert.equal(api.nav.back(),false); assert.equal(f.route().view,'list');
  await f.host.loadTweaks(['miguel/model-pills'],f.slots,{teamAuthors:['miguel']});
  api.on('render',value=>{payload=value;}); f.host.rendered('list',f.doc.body); assert.equal(payload.part,'list'); assert.equal(payload.el,undefined);
  await f.clear(); assert.equal(await api.thread.model({id:'test-model',provider:'test'}),null); assert.deepEqual(Array.from(await api.models.list()),[]);
});
test('a core repaint removes the origin marker: teardown never resurrects stale duplicate actions', async () => {
  const f=fixture(); await f.mount('miguel/switch-row-actions');
  const marker=f.thread.children.find(n=>n.tagName==='comment'); assert.ok(marker); marker.remove();
  const replacement=f.doc.createElement('div'); replacement.setAttribute('data-part','thread-actions'); f.thread.append(replacement);
  await f.clear(); assert.equal(f.thread.querySelector('[data-part="thread-actions"]'),replacement); assert.equal(f.thread.children.filter(n=>n.dataset.part==='thread-actions').length,1);
});

function wizardExperience(storage = new Map()) {
  let skin = 'nebula', active = [], layout = storage.get('wos.layout') || 'classic';
  const window = { WosSkin: { get current() { return skin; }, familyOf: id => id === 'nebula' ? 'wizard' : 'novairecito', families: [{id:'wizard',tweaks:'wizard'}, {id:'novairecito'}] },
    WosSkinHost: { personalState:{ready:false}, get tweakState() { return active; }, get layout() { return layout; }, setLayout: id => { layout = id; }, loadTweaks: async ids => { active = ids; } }, addEventListener() {}, dispatchEvent() {} };
  vm.runInNewContext(read('web/core/experience.js'), {window, document:{baseURI:'https://wizard.test/wizard-os-home/',addEventListener(){}}, Event, URL, AbortSignal,
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}, fetch:async url=>({ok:true,json:async()=>JSON.parse(read('web/'+url.pathname.split('/wizard-os-home/')[1]))})});
  return { E:window.WosExperience, storage, skin:id=>{skin=id;}, active:()=>Array.from(active) };
}
test('profile default-off applies until the owner stores a deliberate choice, including an empty off list', async () => {
  let f = wizardExperience(); await f.E.refresh(); assert.deepEqual(f.active(), []); assert.equal(f.E.state.tweaks[0].on, false);
  await f.E.toggle('wizard/two-orbs'); assert.deepEqual(f.active(), ['wizard/two-orbs']);
  assert.deepEqual(JSON.parse(f.storage.get('wos.skin-tweaks.v1')).off.wizard, []);
  f = wizardExperience(f.storage); await f.E.refresh(); assert.deepEqual(f.active(), ['wizard/two-orbs']);
  f.skin('novairecito'); await f.E.chooseSkin(); assert.deepEqual(f.active(), []);
  f.skin('nebula'); await f.E.chooseSkin(); assert.deepEqual(f.active(), ['wizard/two-orbs']);
  await f.E.toggle('wizard/two-orbs'); await f.E.refresh(); assert.deepEqual(f.active(), []);
});
test('legacy two-orb migration opts in exactly once, preserving a later owner off choice', async () => {
  let f = wizardExperience(new Map([['wos.layout','two-orb']])); await f.E.refresh(); assert.deepEqual(f.active(), ['wizard/two-orbs']);
  await f.E.toggle('wizard/two-orbs');
  f = wizardExperience(f.storage); await f.E.refresh(); assert.deepEqual(f.active(), []);
  const saved = new Map([['wos.layout','two-orb'], ['wos.skin-tweaks.v1',JSON.stringify({version:1,off:{wizard:['wizard/two-orbs']}})]]);
  f = wizardExperience(saved); await f.E.refresh(); assert.deepEqual(f.active(), []);
});
test('layout handles become inert on disposal and their cleanup is idempotent', async () => {
  const f = fixture(); let api;
  f.host._test.setImporter(async () => ({default:a=>{api=a;return()=>{};}}));
  await f.mount('wizard/two-orbs'); await f.clear();
  api.layout.use('two-orb')(); assert.equal(f.host.layout,'classic');
});

test('slot lookup prefers a visible instance over hidden Chats copies (desktop)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../web/core/skin-host.js', import.meta.url), 'utf8');
  assert.match(src, /getClientRects\(\)\.length > 0\)/);
  assert.match(src, /querySelectorAll\(selector\)\]\.find\(seen\)/);
});
