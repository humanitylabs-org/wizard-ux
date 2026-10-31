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
  const f = fixture(); await f.host.loadTweaks(catalog.tweaks, f.slots, { teamAuthors: ['miguel', 'wizard'] });
  assert.equal(f.host.tweakState.length, catalog.tweaks.length); assert.equal(f.host.action('snooze', {sessionId:'s1'}), true);
  await f.clear(); assert.equal(f.doc.head.children.length, 0); assert.equal(f.thread.handlers.get('touchend').size, 0); assert.equal(f.host.action('snooze', {sessionId:'s1'}), false);
});
test('a skin brings its tweaks; offs are remembered per skin; another skin drops them; new published tweaks arrive', async () => {
  const storage = new Map(); let skin = 'grove', published = { id: 'miguel', version: 1, skin: 'obsidian', tweaks: ['miguel/hidden-pin'], flags: {} }, active;
  const fams = [{ id: 'wizard', palettes: ['grove'] }, { id: 'mizel', tweaks: 'miguel', palettes: ['obsidian', 'landscapes'] }];
  const window = { WosSkin: { get current() { return skin; }, families: fams, familyOf: id => fams.find(f => f.palettes.includes(id)).id }, WosSkinHost: { personalState: { ready: false }, get tweakState() { return active || []; }, loadTweaks: async ids => { active = ids.filter(id => id !== 'wizard/unified-inbox'); } }, addEventListener() {}, dispatchEvent() {} };
  const ctx = { window, document: { baseURI:'https://wizard.test/wizard-os-home/', addEventListener() {} }, Event, URL, AbortSignal, localStorage: { getItem:k=>storage.get(k), setItem:(k,v)=>storage.set(k,v) }, fetch: async url => ({ ok:true, json: async () => url.pathname.endsWith('profile.json') ? published : JSON.parse(read('web/'+url.pathname.split('/wizard-os-home/')[1])) }) };
  vm.runInNewContext(read('web/core/experience.js'), ctx); const E = window.WosExperience;
  await E.refresh(); assert.equal(E.state.owner, null); assert.equal(active.length, 0);
  skin = 'obsidian'; await E.chooseSkin(); assert.equal(E.state.owner, 'miguel'); assert.deepEqual(Array.from(active), ['miguel/hidden-pin']);
  await E.toggle('miguel/hidden-pin'); assert.equal(active.length, 0); assert.equal(E.state.tweaks[0].on, false);
  published = { ...published, version:2, tweaks: ['miguel/home-bars','miguel/hidden-pin'] }; await E.refresh();
  assert.deepEqual(Array.from(active), ['miguel/home-bars']);
  skin = 'grove'; await E.chooseSkin(); assert.equal(E.state.owner, null); assert.equal(active.length, 0); assert.equal(E.state.tweaks.filter(t => t.id !== 'wizard/unified-inbox').length, 0);
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
  const requests = [];
  let skin = 'nebula', active = [], layout = storage.get('wos.layout') || 'classic';
  const window = { WosSkin: { get current() { return skin; }, familyOf: id => id === 'nebula' ? 'wizard' : 'novairecito', families: [{id:'wizard',tweaks:'wizard'}, {id:'novairecito'}] },
    WosSkinHost: { personalState:{ready:false}, get tweakState() { return active; }, get layout() { return layout; }, setLayout: id => { layout = id; }, loadTweaks: async ids => { active = ids; } }, addEventListener() {}, dispatchEvent() {} };
  vm.runInNewContext(read('web/core/experience.js'), {window, document:{baseURI:'https://wizard.test/wizard-os-home/',addEventListener(){}}, Event, URL, AbortSignal,
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}, fetch:async url=>{ requests.push(url.pathname); return {ok:true,json:async()=>JSON.parse(read('web/'+url.pathname.split('/wizard-os-home/')[1]))}; }});
  // Notifications in Chats is on by default for the Wizard family; these older checks are about the other tweaks.
  return { window, E:window.WosExperience, storage, requests, skin:id=>{skin=id;}, active:()=>Array.from(active).filter(id => id !== 'wizard/unified-inbox'), all:()=>Array.from(active) };
}
test('profile default-off applies until the owner stores a deliberate choice, including an empty off list', async () => {
  let f = wizardExperience(); await f.E.refresh(); assert.deepEqual(f.active(), []); assert.equal(f.E.state.tweaks.find(t => t.id === 'wizard/two-orbs').on, false);
  await f.E.toggle('wizard/two-orbs'); assert.deepEqual(f.active(), ['wizard/two-orbs']);
  assert.deepEqual(JSON.parse(f.storage.get('wos.skin-tweaks.v1')).off.wizard, ['wizard/app-borders']);
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
test('overview mode is capability gated, revoked on teardown, and stale handles cannot reactivate it', async () => {
  const f=fixture(); let api;
  f.host._test.setImporter(async()=>({default:a=>{api=a;return()=>{};}}));
  await f.mount('miguel/hidden-pin'); assert.equal(api.overview,undefined);
  await f.mount('miguel/arrange-download');
  assert.throws(()=>api.overview.use({hold:'exit',appHold:false}),/Invalid overview mode/);
  const release=api.overview.use({hold:'arrange',appAction:'home-screen',appHold:false});
  assert.equal(f.overview.hold,'arrange'); await f.clear(); assert.equal(f.overview,null);
  release(); release(); api.overview.use({hold:'arrange',appAction:'home-screen',appHold:false}); assert.equal(f.overview,null);
});
test('window refresh is layout+nav gated, revoked on teardown, and stale handles cannot reactivate it', async () => {
  const f=fixture(); let api;
  f.host._test.setImporter(async()=>({default:a=>{api=a;return()=>{};}}));
  await f.mount('miguel/hidden-pin'); assert.equal(api.windowRefresh,undefined);
  await f.mount('miguel/refresh-button'); assert.equal(f.windowRefresh,null);
  assert.throws(()=>api.windowRefresh.use({}),/Invalid window refresh mode/);
  const release=api.windowRefresh.use({pull:false,extra:1}); assert.deepEqual({...f.windowRefresh},{pull:false});
  release(); release(); assert.equal(f.windowRefresh,null);
  api.windowRefresh.use({pull:true}); assert.equal(f.windowRefresh.pull,true);
  await f.clear(); assert.equal(f.windowRefresh,null);
  api.windowRefresh.use({pull:false}); assert.equal(f.windowRefresh,null);
});
test('stock shell: no ↻ in window bars and pull-to-refresh stays unless a package holds window refresh', () => {
  const app=read('web/app.js'), chats=read('web/core/chats.js');
  assert.match(app,/\$\{refreshModes\.length \? RELOAD_BTN : ''\}<button class="wb" data-wact="full"/);
  assert.equal((app.match(/data-wact="reload"/g)||[]).length,2,'only RELOAD_BTN markup and its sync selector');
  assert.match(app,/pullRefresh: \(\) => !refreshModes\.some\(m => m\.pull === false\)/);
  assert.match(app,/windowRefresh: windowRefreshAdapter/);
  assert.match(app,/fresh\.style\.cssText = el\.style\.cssText; el\.replaceWith\(fresh\); mountWin\(w, fresh\); applyLayout\(deskOf\(id\)\);/,'a remounted window keeps its tile placement');
  assert.match(chats,/if \(H\.pullRefresh\?\.\(\) === false\) return;/);
  assert.doesNotMatch(app+chats,/refresh-button/,'core never names the package');
});
test('layout handles become inert on disposal and their cleanup is idempotent', async () => {
  const f = fixture(); let api;
  f.host._test.setImporter(async () => ({default:a=>{api=a;return()=>{};}}));
  await f.mount('wizard/two-orbs'); await f.clear();
  api.layout.use('two-orb')(); assert.equal(f.host.layout,'classic');
});


test('App borders migrates stored framed exactly once, leaves everyone else borderless and respects later off', async () => {
  for (const foundation of ['framed', 'borderless', null]) {
    const storage = new Map(foundation ? [['wos.skin.composition.v1', JSON.stringify({version:1,extends:'nebula',frame:{foundation}})]] : []);
    let f = wizardExperience(storage); await f.E.refresh();
    assert.equal(f.active().includes('wizard/app-borders'), foundation === 'framed');
    if (foundation === 'framed') { await f.E.toggle('wizard/app-borders'); f = wizardExperience(storage); await f.E.refresh(); assert.deepEqual(f.active(), []); }
  }
});
test('own recipes expose all installed tweaks, use published defaults and isolate builtin choices', async () => {
  const f = wizardExperience();
  f.window.WosSkin.familyOf = id => id === 'obsidian-light' ? 'mizel' : 'wizard';
  f.window.WosSkin.families.push({id:'mizel',name:'Mizel',tweaks:'miguel'});
  const defaults = await f.E.defaults('nebula');
  assert.equal(defaults['wizard/app-borders'], false); assert.equal(defaults['wizard/two-orbs'], false);
  assert.equal(defaults['miguel/model-pills'], false);
  const mizel = await f.E.defaults('obsidian-light'); assert.equal(mizel['miguel/model-pills'],true);
  const skin = {id:'quiet',tweaks:{...defaults,'miguel/model-pills':true}};
  f.window.WosMySkin = {active:skin,update(v){ Object.assign(skin.tweaks,v.tweaks); }};
  await f.E.refresh(); assert.equal(f.E.state.tweaks.length, JSON.parse(read('web/tweaks/catalog.json')).tweaks.length);
  assert.deepEqual(f.active(),['miguel/model-pills']);
  await f.E.toggle('wizard/app-borders'); assert.ok(f.active().includes('wizard/app-borders'));
  f.window.WosMySkin.active=null; await f.E.refresh(); assert.deepEqual(f.active(),[]);
});

test('installed list warms base profiles so picking Mizel does not wait for another network request', async () => {
  const f = wizardExperience(); f.window.WosSkin.families.push({ id: 'mizel', tweaks: 'miguel' });
  f.window.WosSkin.familyOf = id => id === 'obsidian-light' ? 'mizel' : 'wizard';
  await f.E.installed();
  const count = () => f.requests.filter(p => p.endsWith('/miguel/profile.json')).length;
  assert.equal(count(), 1);
  assert.equal((await f.E.defaults('obsidian-light'))['miguel/model-pills'], true);
  await f.E.defaults('obsidian-light'); assert.equal(count(), 1);
});

test('disposed foundation capability cannot change windows', async () => {
  const f = fixture(); let api;
  f.host._test.setImporter(async () => ({default:a=>{api=a;return()=>{};}}));
  await f.mount('wizard/app-borders'); await f.clear(); api.layout.foundation('framed')();
  assert.equal(f.ctx.window.WosSkin.frame.foundation, 'borderless');
});

test('slot lookup prefers a visible instance over hidden Chats copies (desktop)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../web/core/skin-host.js', import.meta.url), 'utf8');
  assert.match(src, /getClientRects\(\)\.length > 0\)/);
  assert.match(src, /querySelectorAll\(selector\)\]\.find\(seen\)/);
});

test('beside hook: layout-gated event on change only, never a route event, and route().beside for late packages', async () => {
  const f = fixture(); let api; const seen = [], routes = [];
  f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  await f.host.loadTweaks(['miguel/snooze-someday'], f.slots, { teamAuthors: ['miguel'] });
  assert.throws(() => api.on('beside', () => {}), /requires layout/);
  await f.host.loadTweaks(['miguel/swipe-strip'], f.slots, { teamAuthors: ['miguel'] });
  api.on('beside', b => seen.push(b.side)); api.on('route', r => routes.push(r));
  f.setRoute({ beside: 1 }); f.setRoute({ beside: 1 }); f.setRoute({ beside: -1 }); f.setRoute({ beside: 0 });
  assert.deepEqual(seen, [1, -1, 0]); assert.equal(routes.length, 0, 'route listeners see nothing new');
  f.setRoute({ beside: 7 }); assert.equal(api.route().beside, 1, 'normalised to -1 | 0 | 1');
  assert.equal(api.mount, undefined, 'device controls go through the declared device-edge slot, not a raw mount');
  await f.clear(); f.setRoute({ beside: -1 }); assert.deepEqual(seen, [1, -1, 0, 1], 'a torn-down package hears nothing');
});
test('app.js tells the host when the bound view beside a thread changes, and reports it in route()', () => {
  const app = read('web/app.js');
  const peek = app.slice(app.indexOf('function syncPeek()'), app.indexOf('function detachBound('));
  assert.match(peek, /device\.classList\.toggle\('bound-view-peeking', left\);\s*window\.WosSkinHost\?\.beside\?\.\(\);/);
  assert.match(read('web/index.html'), /<div id="device" class="device" data-slot="device-edge">/);
  assert.ok(JSON.parse(read('web/core/slots.json')).slots['device-edge']);
  assert.match(app, /beside: device\.classList\.contains\('bound-peeking'\) \? 1 : device\.classList\.contains\('bound-view-peeking'\) \? -1 : 0/);
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
  assert.equal(await api.inbox.set('n1', { read: true, flag: true }), true); assert.equal(JSON.stringify(f.inbox.sets), JSON.stringify([['n1', { read: true }]]), 'only read / archived pass');
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

test('chats.js lists notifications among Ready chats only in list mode, in every Ready order', () => {
  const src = read('web/core/chats.js');
  assert.match(src, /const on = !!window\.WosSkinHost\?\.inboxList;/, 'gated on the host list flag');
  assert.match(src, /const nt = k === 'ready' \? listNotes : null/, 'eligible notifications join Ready');
  assert.match(src, /const top = sec === 'ready' \? bar : ''/, 'only Ready owns the order controls');
  assert.match(src, /return top \+ withNotes\(list, awake, rowFn\) \+ later;/, 'Newest, Oldest and Priority interleave in every dated section');
  assert.match(src, /if \(awake\.length && !groups\.has\(NOTES_SUBJECT\)\) groups\.set\(NOTES_SUBJECT, \[\]\);/, 'By subject: their own subject');
  assert.match(src, /\.ch-list \.ch-notif-row\[data-chnotif\]'\); if \(nr\) \{ window\.WosSkinHost\?\.inboxAct\?\.\('open'/, 'a tap goes to the package');
});
test('chats.js shows a notification draft as its thread only while notification threads are on', () => {
  const src = read('web/core/chats.js');
  assert.match(src, /function notifOf\(w\) \{\n    if \(!w \|\| w\.thread !== '__new__' \|\| winAgent\(w\) \|\| !window\.WosSkinHost\?\.inboxThreads\) return null;/);
  assert.match(src, /const NV = isNew && !pend\.length \? notifOf\(w\) : null;/);
  assert.match(src, /if \(sid === '__new__'\) \{ notifAct\(wid, a\); return; \}/);
  assert.match(read('web/desktop/desktop.js'), /f\.thread !== '__new__' \|\| !!CHATS\.notifOpen\?\.\(f\.id\)/, 'Done / Snooze keys reach an open notification');
});

test('desktop keys: ⌥↓ walks notification rows with Ready, ⌥X resolves an open notification', () => {
  const d = read('web/desktop/desktop.js');
  assert.match(d, /\.ch-sec\[data-sec="ready"\] \[data-chnotif\]', document\)/, 'Ready walk includes [data-chnotif] rows');
  assert.match(d, /code === 'KeyX'\) return hit\(\(\) => \{ if \(!e\.repeat\) chatAct\('resolve', 'X'\)/);
  assert.match(read('web/tweaks/wizard/unified-inbox/tweak.js'), /b\.dataset\.chnotif = it\.id/, 'the package marks its rows');
});

test('Notifications in Chats is on by default for the Wizard family and for Mizel', async () => {
  const f = wizardExperience(); await f.E.refresh(); assert.ok(f.all().includes('wizard/unified-inbox'));
  assert.equal((await f.E.defaults('nebula'))['wizard/unified-inbox'], true);
  assert.ok(JSON.parse(read('web/tweaks/miguel/profile.json')).tweaks.includes('wizard/unified-inbox'));
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

