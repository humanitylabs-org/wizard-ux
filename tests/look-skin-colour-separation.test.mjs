// Settings › Look (wizard-ux issue 1190, on for everyone since James's yes on 25 Nov 2026): skins are a look only, so
// Look is one list of skins (every colour, your own skins, + New skin), the worn colour's Background, and Views.
// Own skins, New skin and skin import stay, as looks; a new skin saves no feature choices.
// Exercise the real Settings renderer and dispatch, not a parallel picker or a source-only label check.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { withSettingsParts } from './fixtures/settings-parts.mjs'; // settings.js parts moved out verbatim (issue 1665)
const source = withSettingsParts(fs.readFileSync(new URL('../web/core/settings.js', import.meta.url), 'utf8'));

function look(shell, ownSkins = false) {
  const picked = [], last = { wizard: 'grove', mizel: 'obsidian-light' };
  const S = {
    current: 'nebula',
    list: ['nebula', 'grove', 'obsidian', 'obsidian-light'].map(id => ({ id, name: id, t: {} })),
    families: [{ id: 'wizard', name: 'Wizard', palettes: ['nebula', 'grove'] }, { id: 'mizel', name: 'Mizel', palettes: ['obsidian', 'obsidian-light'] }],
    familyOf: id => id.startsWith('obsidian') ? 'mizel' : 'wizard',
    lastIn: id => last[id],
    set(id) { picked.push(id); this.current = id; last[this.familyOf(id)] = id; },
    setFamily(id) { this.set(last[id]); },
  };
  const s = { console, URL, setTimeout, CSS: { escape: String }, navigator: { userAgent: 'Desktop' },
    document: { activeElement: null }, location: { host: 'example.test' }, WizCore: {}, WosSkin: S };
  if (ownSkins) {
    s.WosMySkin = { recipes: [], active: null, on() {}, create(draft) { this.created = JSON.parse(JSON.stringify(draft)); } };
    s.WosExperience = { installedReady: true, installed: async () => [{ id: 'sample', name: 'Sample tweak' }], defaults: async () => ({ sample: true }), state: { tweaks: [{ id: 'sample', on: true, builtin: true }] } };
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
  return { S, root, view, act, input, s, picked };
}
const ticks = async (n = 5) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

// owner-correction: humanitylabs-org/wizard-ux#1190 · 2026-11-27 · "call these skins, not looks. I did not approve renaming them to looks. They're called skins, but otherwise, yes, that's approved."
for (const shell of ['phone', 'desktop']) test(`${shell}: Look is one list of skins: every colour, own skins and + New skin`, async () => {
  const h = look(shell, true), M = h.s.WosMySkin;
  M.recipes = [{ id: 'own-1', name: 'Quiet', base: 'obsidian-light', tweaks: {} }];
  h.view.render();
  const html = () => h.root.innerHTML;
  assert.match(html(), /<h4>Skins<\/h4>/);
  assert.match(html(), /role="group" aria-label="Skins"/);
  for (const id of ['nebula', 'grove', 'obsidian', 'obsidian-light']) assert.match(html(), new RegExp(`data-skinpick="${id}"`), 'every colour of every skin');
  assert.match(html(), /data-ownskin="own-1"/, 'own skins stay in the one list');
  assert.match(html(), /data-newskin/, '+ New skin stays');
  assert.match(html(), /data-skinimport/, 'skin import stays');
  assert.doesNotMatch(html(), /data-skinfamily=/, 'no separate skin families');
  assert.doesNotMatch(html(), /Looks/, 'they are called skins, not looks');
  assert.match(html(), /data-skinpick="nebula" aria-pressed="true"/);
  h.act('data-skinpick', 'obsidian'); await ticks();
  assert.equal(h.picked.at(-1), 'obsidian', 'a colour of another skin is one tap away');
  assert.match(html(), /data-skinpick="obsidian" aria-pressed="true"/);
  h.view.destroy();
});

for (const shell of ['phone', 'desktop']) test(`${shell}: Look offers no feature switch`, () => {
  const h = look(shell, true);
  h.s.WosExperience.state = { shell, channel: 'latest', tweaks: [{ id: 'test/feature', name: 'A feature', on: false }] };
  h.view.render();
  assert.doesNotMatch(h.root.innerHTML, /data-tweak-toggle="test\/feature"/, 'feature switches are on Try new features, not Look');
  assert.doesNotMatch(h.root.innerHTML, /data-try-features/);
  h.view.destroy();
});

for (const shell of ['phone', 'desktop']) test(`${shell}: picking looks never changes the tweak mix (#801)`, async () => {
  const h = look(shell, true), storage = new Map(); let active = [];
  h.s.WosSkinHost = { layout: 'classic', personalState: { ready: false }, get tweakState() { return active; }, loadTweaks: async ids => { active = Array.from(ids); } };
  h.s.addEventListener = () => {}; h.s.dispatchEvent = () => {};
  vm.runInNewContext(fs.readFileSync(new URL('../web/core/experience.js', import.meta.url), 'utf8'), {
    window: h.s, Event, URL, AbortSignal, setTimeout() {},
    document: { baseURI: 'https://wizard.test/wizard-os-home/', addEventListener() {} },
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    fetch: async url => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(new URL('../web/' + url.pathname.split('/wizard-os-home/')[1], import.meta.url), 'utf8')) }),
  });
  const E = h.s.WosExperience; await E.refresh(); await E.toggle('wizard/sidebar-chats-view');
  const before = JSON.stringify(JSON.parse(storage.get('wos.skin-tweaks.v1')).mix), beforeActive = JSON.stringify(active);
  let pending = Promise.resolve(), picks = 0; const choose = E.chooseSkin.bind(E);
  E.chooseSkin = (...args) => { picks++; return pending = choose(...args); };
  for (const id of ['obsidian', 'nebula', 'obsidian-light', 'grove']) {
    h.act('data-skinpick', id); await pending; await ticks();
    assert.equal(JSON.stringify(JSON.parse(storage.get('wos.skin-tweaks.v1')).mix), before, 'real persisted mix survives each pick');
    assert.equal(JSON.stringify(active), beforeActive, 'real active host mix survives each pick');
  }
  assert.equal(h.S.current, 'grove'); assert.equal(picks, 4, 'dispatch must run the actual chooseSkin reconciler');
  h.view.destroy();
});

for (const shell of ['phone', 'desktop']) test(`${shell}: a worn own skin is a look: its tile is pressed, a colour takes it off`, async () => {
  const h = look(shell, true), M = h.s.WosMySkin;
  M.recipes = [{ id: 'own-1', name: 'Quiet', base: 'obsidian-light', tweaks: {} }];
  M.active = { id: 'own-1', name: 'Quiet', base: 'obsidian-light', tweaks: {} };
  M.update = () => { throw Error('a colour pick must not edit the own skin'); };
  h.S.current = 'obsidian-light'; h.view.render();
  assert.match(h.root.innerHTML, /data-ownskin="own-1" aria-pressed="true"/);
  assert.doesNotMatch(h.root.innerHTML, /data-skinpick="[^"]+" aria-pressed="true"/, 'no colour is the worn look');
  assert.match(h.root.innerHTML, /data-myskin="edit"/, 'Edit with your Wizard');
  assert.match(h.root.innerHTML, /data-ownskin-remove="own-1"/, 'Remove skin');
  assert.doesNotMatch(h.root.innerHTML, /data-myskin-script|Skin script/, 'no script row: skin scripts never run');
  let left = false;
  M.leave = async () => { left = true; M.active = null; };
  h.act('data-skinpick', 'nebula'); await ticks();
  assert.equal(left, true, 'a colour takes the own skin off first (wizard-ux#1816)');
  assert.equal(h.picked.at(-1), 'nebula', 'then the colour is worn');
  left = false;
  M.active = { id: 'own-1', name: 'Quiet', base: 'obsidian-light', tweaks: {} };
  h.act('data-ownskin', 'own-1'); await ticks();
  assert.equal(left, true, 'tapping the worn own skin takes it off');
  h.view.destroy();
});

for (const shell of ['phone', 'desktop']) test(`${shell}: device recovery opens the existing draft, cancel keeps preview, Create is explicit`, async () => {
  const h = look(shell, true), M = h.s.WosMySkin, dismissed = [];
  const preview = { id: 'device-old', name: 'Old preview', base: 'obsidian-light', tweaks: { sample: false } };
  M.previews = [preview]; M.dismissPreview = id => { dismissed.push(id); M.previews = []; };
  h.view.focus('look'); assert.match(h.root.innerHTML, /data-skin-preview="device-old"/);
  h.act('data-skin-preview', 'device-old'); await ticks(10);
  assert.equal(h.S.current, 'nebula'); assert.equal(M.created, undefined); assert.equal(h.view.context.skinDraft.base, 'obsidian-light');
  h.view.back(); assert.equal(dismissed.length, 0); assert.equal(M.previews.length, 1);
  h.act('data-skin-preview', 'device-old'); await ticks(10);
  h.act('data-skin-create', '');
  assert.deepEqual(M.created, { name: 'Old preview', base: 'obsidian-light', tweaks: { sample: false } }, 'a recovered skin keeps only its own saved choices');
  assert.deepEqual(dismissed, ['device-old']); assert.deepEqual(preview, { id: 'device-old', name: 'Old preview', base: 'obsidian-light', tweaks: { sample: false } });
  h.view.destroy();
});

for (const shell of ['phone', 'desktop']) test(`${shell}: New skin is a name, a base skin and a colour, with no feature list`, async () => {
  const h = look(shell, true);
  h.S.set('grove');
  h.act('data-newskin', '');
  assert.match(h.root.innerHTML, /Base skin<select data-skin-base>/);
  assert.match(h.root.innerHTML, /<h4>Color<\/h4>/);
  assert.match(h.root.innerHTML, /data-skinpick="grove" aria-pressed="true"/, 'starts from worn colour');
  assert.match(h.root.innerHTML, /data-newskin-look-only/);
  assert.doesNotMatch(h.root.innerHTML, /data-draft-tweak=|<h4>Tweaks<\/h4>|data-skinretry/, 'no tweak switches in the draft');
  assert.doesNotMatch(h.root.innerHTML, /data-skin-create disabled/, 'Create never waits for a tweak list');
  h.input('data-skin-name', 'Quiet morning');
  h.input('data-skin-base', 'mizel');
  assert.match(h.root.innerHTML, /value="mizel" selected/);
  assert.match(h.root.innerHTML, /data-skinpick="obsidian-light" aria-pressed="true"/);
  assert.doesNotMatch(h.root.innerHTML, /data-skinpick="grove"/);
  h.act('data-skinpick', 'obsidian');
  assert.equal(h.S.current, 'grove', 'draft choices do not change the worn skin');
  assert.equal(h.view.context.skinDraft.name, 'Quiet morning');
  h.act('data-skin-create', '');
  assert.deepEqual(h.s.WosMySkin.created, { name: 'Quiet morning', base: 'obsidian', tweaks: {} }, 'a new skin saves no feature choices');
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
  h.input('data-skin-name', 'First');
  h.act('data-skin-create', '');
  h.input('data-skin-name', 'Changed while saving');
  h.input('data-skin-base', 'mizel');
  h.act('data-skinpick', 'grove');
  assert.equal(h.view.context.skinDraft.name, 'First');
  assert.equal(submitted.base, 'nebula');
  assert.deepEqual(JSON.parse(JSON.stringify(submitted.tweaks)), {});
  assert.equal(h.view.back(), true);
  h.act('data-newskin', '');
  h.input('data-skin-name', 'Second');
  const next = h.view.context.skinDraft;
  finish();
  await ticks(2);
  assert.equal(h.view.context.skinDraft, next);
  assert.equal(next.name, 'Second');
  h.view.destroy();
});

for (const shell of ['phone', 'desktop']) test(`${shell}: Look lists only the views this shell can wear`, () => {
  const h = look(shell, true);
  const items = [
    { id: 'miguel/ai-apps', name: 'AI apps', view: 'AI apps', shells: ['desktop'] },
    { id: 'test/phone', name: 'Phone only', view: 'Phone', shells: ['phone'] },
    { id: 'test/ordinary', name: 'Ordinary', shells: ['desktop'] },
  ];
  h.s.WosExperience.state = { shell, tweaks: items };
  h.view.render();
  const visible = id => id === 'miguel/ai-apps' ? shell === 'desktop' : id === 'test/phone' ? shell === 'phone' : false;
  for (const t of items) assert.equal(h.root.innerHTML.includes(`data-tweak-toggle="${t.id}"`), visible(t.id), t.id);
  h.view.destroy();
});
