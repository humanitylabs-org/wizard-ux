// James, 31 Oct and 1 Nov 2026; #801/#803: keep Skin and Color separate, never flatten colors into skins.
// Exercise the real Settings renderer and dispatch, not a parallel picker or a source-only label check.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../web/core/settings.js', import.meta.url), 'utf8');

function look(shell, ownSkins = false) {
  const picked = [], familyPicked = [], last = { wizard: 'grove', mizel: 'obsidian-light' };
  const S = {
    current: 'nebula',
    list: ['nebula', 'grove', 'obsidian', 'obsidian-light'].map(id => ({ id, name: id, t: {} })),
    families: [{ id: 'wizard', name: 'Wizard', palettes: ['nebula', 'grove'] }, { id: 'mizel', name: 'Mizel', palettes: ['obsidian', 'obsidian-light'] }],
    familyOf: id => id.startsWith('obsidian') ? 'mizel' : 'wizard',
    lastIn: id => last[id],
    set(id) { picked.push(id); this.current = id; last[this.familyOf(id)] = id; },
    setFamily(id) { familyPicked.push(id); this.set(last[id]); },
  };
  const s = { console, URL, setTimeout, CSS: { escape: String }, navigator: { userAgent: 'Desktop' },
    document: { activeElement: null }, location: { host: 'example.test' }, WizCore: {}, WosSkin: S };
  if (ownSkins) {
    s.WosMySkin = { recipes: [], active: null, on() {}, create(draft) { this.created = JSON.parse(JSON.stringify(draft)); } };
    s.WosExperience = { installedReady: true, installed: async () => [{ id: 'sample', name: 'Sample tweak' }], defaults: async () => ({ sample: true }), state: { tweaks: [{ id: 'sample', on: true, builtin: true }] } };   // built in: the New skin draft lists built-ins and views, not feature switches
  }
  s.window = s;
  vm.runInNewContext(source, s);
  const handlers = {};
  const root = { innerHTML: '', scrollTop: 0, dataset: {}, classList: { add() {} }, contains: () => false,
    querySelector: () => null, querySelectorAll: () => [], addEventListener: (name, fn) => { handlers[name] = fn; }, removeEventListener() {} };
  const view = s.WosSettings.mount(root, { shell, live: { ok: true } });
  view.focus('look');
  const act = (attr, value) => view.dispatch({ closest: selector => selector === '[data-settings-feature]'
    ? { dataset: { settingsFeature: 'look' } }
    : selector === `[${attr}]` ? { dataset: { [attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]: value } } : null });
  const input = (attr, value) => handlers.input({ target: { value, matches: selector => selector === `[${attr}]`, closest: () => ({ dataset: { settingsFeature: 'look' } }) } });
  return { S, root, view, act, input, s, picked, familyPicked };
}

for (const shell of ['phone', 'desktop']) test(`${shell}: Look keeps skin and colour as separate working controls`, async () => {
  const h = look(shell);
  const assertControls = (family, colours, foreign) => {
    const html = h.root.innerHTML;
    assert.match(html, /role="group" aria-label="Skins"/, 'a distinct Skin group must remain');
    for (const id of ['wizard', 'mizel']) assert.match(html, new RegExp(`data-skinfamily="${id}"`));
    assert.match(html, new RegExp(`data-skinfamily="${family}" aria-pressed="true"`));
    assert.match(html, /<h4>Colou?rs<\/h4>/i, 'colours have their own heading');
    for (const id of colours) assert.match(html, new RegExp(`data-skinpick="${id}"`));
    for (const id of foreign) assert.doesNotMatch(html, new RegExp(`data-skinpick="${id}"`), 'not one flat all-colours-as-skins grid');
  };
  assertControls('wizard', ['nebula', 'grove'], ['obsidian', 'obsidian-light']);
  h.act('data-skinfamily', 'mizel'); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.familyPicked.at(-1), 'mizel');
  assert.equal(h.S.current, 'obsidian-light', 'skin choice restores its last colour');
  assertControls('mizel', ['obsidian', 'obsidian-light'], ['nebula', 'grove']);
  h.act('data-skinpick', 'obsidian'); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.picked.at(-1), 'obsidian');
  assert.equal(h.S.familyOf(h.S.current), 'mizel', 'colour choice does not choose a different skin');
  h.act('data-skinfamily', 'wizard'); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.S.current, 'grove');
  h.act('data-skinfamily', 'mizel'); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.S.current, 'obsidian', 'family round-trip remembers the chosen colour');
  h.view.destroy();
});

for (const shell of ['phone', 'desktop']) test(`${shell}: separate Skin/Color choices never replace the independent tweak mix (#801)`, async () => {
  const h=look(shell,true), storage=new Map();let active=[];
  for(const family of h.S.families) family.tweaks=family.id==='wizard'?'wizard':'miguel';
  h.s.WosSkinHost={layout:'classic',personalState:{ready:false},get tweakState(){return active;},loadTweaks:async ids=>{active=Array.from(ids);}};
  h.s.addEventListener=()=>{};h.s.dispatchEvent=()=>{};
  vm.runInNewContext(fs.readFileSync(new URL('../web/core/experience.js',import.meta.url),'utf8'),{
    window:h.s,Event,URL,AbortSignal,setTimeout(){},
    document:{baseURI:'https://wizard.test/wizard-os-home/',addEventListener(){}},
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
    fetch:async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(new URL('../web/'+url.pathname.split('/wizard-os-home/')[1],import.meta.url),'utf8'))}),
  });
  const E=h.s.WosExperience;await E.refresh();await E.toggle('wizard/thread-tracker');
  const before=JSON.stringify(JSON.parse(storage.get('wos.skin-tweaks.v1')).mix), beforeActive=JSON.stringify(active);
  let pending=Promise.resolve(), picks=0;const choose=E.chooseSkin.bind(E);
  E.chooseSkin=(...args)=>{picks++;return pending=choose(...args);};
  for(const [attr,id] of [['data-skinfamily','mizel'],['data-skinpick','obsidian'],['data-skinfamily','wizard'],['data-skinpick','nebula'],['data-skinfamily','mizel']]) {
    h.act(attr,id);await pending;for(let n=0;n<5;n++)await Promise.resolve();
    assert.equal(JSON.stringify(JSON.parse(storage.get('wos.skin-tweaks.v1')).mix),before,'real persisted mix survives each pick');
    assert.equal(JSON.stringify(active),beforeActive,'real active host mix survives each pick');
  }
  assert.equal(h.S.current,'obsidian');assert.equal(picks,5,'dispatch must run the actual chooseSkin reconciler');
  h.view.destroy();
});

for (const shell of ['phone', 'desktop']) test(`${shell}: installed own-skin API does not make plain family selection depend on the box`, async () => {
  const h = look(shell, true);
  h.s.WosMySkin.leave = () => { throw Error('offline: must not call leave without a worn own skin'); };
  h.act('data-skinfamily', 'mizel');
  await Promise.resolve();
  assert.equal(h.S.current, 'obsidian-light');
  h.s.WosMySkin.active = { id: 'own-1', name: 'Quiet', base: 'obsidian-light' };
  let updated;
  h.s.WosMySkin.update = async change => { updated = change.base; h.S.set(change.base); };
  h.act('data-skinpick', 'obsidian');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(updated, 'obsidian', 'Colours edit the worn own skin');
  let left = false;
  h.s.WosMySkin.leave = async () => { left = true; h.s.WosMySkin.active = null; };
  h.act('data-skinfamily', 'wizard');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(left, true, 'choosing another family takes the own skin off, as before #755');
  assert.equal(h.S.current, 'grove');
  h.view.destroy();
});

for (const shell of ['phone', 'desktop']) test(`${shell}: device recovery opens the existing draft, cancel keeps preview, Create is explicit`, async () => {
  const h = look(shell, true), M = h.s.WosMySkin, dismissed = [];
  const preview = { id: 'device-old', name: 'Old preview', base: 'obsidian-light', tweaks: {sample:false} };
  M.previews = [preview]; M.dismissPreview = id => { dismissed.push(id); M.previews = []; };
  h.view.focus('look'); assert.match(h.root.innerHTML, /data-skin-preview="device-old"/);
  h.act('data-skin-preview', 'device-old'); for (let i=0;i<10;i++) await Promise.resolve();
  assert.equal(h.S.current, 'nebula'); assert.equal(M.created, undefined); assert.equal(h.view.context.skinDraft.base, 'obsidian-light');
  assert.equal(h.view.context.skinDraft.tweaks.sample, false); h.view.back(); assert.equal(dismissed.length,0); assert.equal(M.previews.length,1);
  h.act('data-skin-preview', 'device-old'); for (let i=0;i<10;i++) await Promise.resolve();
  h.act('data-skin-create', ''); assert.deepEqual(M.created,{name:'Old preview',base:'obsidian-light',tweaks:{sample:false}});
  assert.deepEqual(dismissed,['device-old']); assert.deepEqual(preview,{id:'device-old',name:'Old preview',base:'obsidian-light',tweaks:{sample:false}});
  h.view.destroy();
});

for (const shell of ['phone', 'desktop']) test(`${shell}: New skin keeps Base skin and Colour independent without resetting name or tweaks`, async () => {
  const h = look(shell, true);
  h.S.set('grove');
  h.act('data-newskin', '');
  for (let tick = 0; tick < 10 && !h.view.context.skinDraft.items.length; tick++) await Promise.resolve();
  assert.equal(h.view.context.skinDraft.loading, false);
  assert.match(h.root.innerHTML, /Base skin<select data-skin-base>/);
  assert.match(h.root.innerHTML, /<h4>Color<\/h4>/);
  assert.match(h.root.innerHTML, /data-skinpick="grove" aria-pressed="true"/, 'starts from worn colour');
  h.input('data-skin-name', 'Quiet morning');
  h.act('data-draft-tweak', 'sample');
  h.input('data-skin-base', 'mizel');
  assert.match(h.root.innerHTML, /value="mizel" selected/);
  assert.match(h.root.innerHTML, /data-skinpick="obsidian-light" aria-pressed="true"/);
  assert.doesNotMatch(h.root.innerHTML, /data-skinpick="grove"/);
  h.act('data-skinpick', 'obsidian');
  assert.equal(h.S.current, 'grove', 'draft choices do not change the worn skin');
  assert.equal(h.view.context.skinDraft.name, 'Quiet morning');
  assert.equal(h.view.context.skinDraft.tweaks.sample, false, 'changing family or colour preserves edited switches');
  h.act('data-skin-create', '');
  assert.equal(h.s.WosMySkin.created.base, 'obsidian');
  assert.equal(h.s.WosMySkin.created.name, 'Quiet morning');
  assert.equal(h.s.WosMySkin.created.tweaks.sample, false);
  h.act('data-newskin', '');
  assert.equal(h.view.back(), true, 'Back leaves New skin, not Wizard');
  assert.equal(h.view.context.skinDraft, null);
  assert.match(h.root.innerHTML, /aria-label="Skins"/);
  h.view.destroy();
});

for (const shell of ['phone', 'desktop']) test(`${shell}: slow Create saves a snapshot and cannot wipe a later draft`, async () => {
  const h = look(shell, true);
  let finish, submitted;
  h.s.WosMySkin.create = snapshot => { submitted = snapshot; return new Promise(resolve => { finish = resolve; }); };
  h.act('data-newskin', '');
  for (let tick = 0; tick < 10 && !h.view.context.skinDraft.items.length; tick++) await Promise.resolve();
  h.input('data-skin-name', 'First');
  h.act('data-skin-create', '');
  h.input('data-skin-name', 'Changed while saving');
  h.input('data-skin-base', 'mizel');
  h.act('data-skinpick', 'grove');
  h.act('data-draft-tweak', 'sample');
  assert.equal(h.view.context.skinDraft.name, 'First');
  assert.equal(submitted.base, 'nebula');
  assert.equal(submitted.tweaks.sample, true);
  assert.equal(h.view.back(), true);
  h.act('data-newskin', '');
  h.input('data-skin-name', 'Second');
  const next = h.view.context.skinDraft;
  finish();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.view.context.skinDraft, next);
  assert.equal(next.name, 'Second');
  h.view.destroy();
});

for (const shell of ['phone', 'desktop']) test(`${shell}: New skin shares Look's shell filter without erasing hidden defaults`, async () => {
  const h = look(shell, true);
  const items = [
    { id: 'miguel/ai-apps', name: 'AI apps', view: 'AI apps', shells: ['desktop'] },
    { id: 'miguel/orb-shell', name: 'Orb', view: 'Orb', shells: ['phone', 'desktop'] },
    { id: 'test/phone', name: 'Phone only', view: 'Phone', shells: ['phone'] },
    { id: 'test/ordinary', name: 'Ordinary', shells: ['desktop'] },
  ];
  const defaults = Object.fromEntries(items.map(t => [t.id, true]));
  h.s.WosExperience.state = { shell, tweaks: items };
  h.s.WosExperience.installed = async () => items;
  h.s.WosExperience.defaults = async () => ({ ...defaults });
  h.view.render();
  const visible = id => id === 'miguel/ai-apps' ? shell === 'desktop' : id === 'test/phone' ? shell === 'phone' : true;
  // No channel read yet: only views show; feature switches appear under "Try new features" on For testers.
  for (const t of items) assert.equal(h.root.innerHTML.includes(`data-tweak-toggle="${t.id}"`), visible(t.id) && !!t.view, t.id);
  h.act('data-newskin', '');
  for (let n = 0; n < 10; n++) await Promise.resolve();
  // Feature switches (test/ordinary) are not offered in the draft; their saved state is carried over unchanged.
  for (const t of items) assert.equal(h.root.innerHTML.includes(`data-draft-tweak="${t.id}"`), visible(t.id) && !!t.view, t.id);
  assert.deepEqual(JSON.parse(JSON.stringify(h.view.context.skinDraft.tweaks)), defaults, 'filter presentation, not other-shell state');
  h.input('data-skin-name', 'Keep both devices'); h.act('data-draft-tweak', 'miguel/orb-shell');
  h.act('data-skin-create', '');
  assert.deepEqual(h.s.WosMySkin.created.tweaks, { ...defaults, 'miguel/orb-shell': false });
  h.view.destroy();
});
