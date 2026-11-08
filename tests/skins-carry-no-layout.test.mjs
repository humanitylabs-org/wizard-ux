import { modelContext, runWithChatsModel } from './fixtures/chats-list-model.mjs';
// Skins are colours only (James and Miguel, 1 Nov 2026). Picking Dark, Light or Landscapes must never change the Chats
// list, dock, Home or launcher on its own. Miguel's old Mizel layout is retired (2 Nov 2026): no tweak carries it, so
// every skin runs the stock shell.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SHELL = ['web/app.js', 'web/live.js', 'web/core/chats.js', 'web/core/chat-models.js', 'web/core/resources.js', 'web/core/experience.js', 'web/desktop/desktop.js'];

test('no shell file picks a layout from the worn skin', () => {
  for (const f of SHELL) assert.doesNotMatch(read(f), /'obsidian'|'landscapes'|"obsidian"|"landscapes"/, f);
});

test('the retired miguel/layout tweak is gone: no package, no catalog or profile entry, no shell gate', () => {
  assert.ok(!existsSync(new URL('../web/tweaks/miguel/layout', import.meta.url)), 'package removed');
  const cat = JSON.parse(read('web/tweaks/catalog.json')), prof = JSON.parse(read('web/tweaks/miguel/profile.json'));
  assert.ok(!cat.tweaks.includes('miguel/layout') && !(cat.defaults || []).includes('miguel/layout'));
  assert.ok(!prof.tweaks.includes('miguel/layout'));
  for (const f of SHELL) assert.doesNotMatch(read(f), /miguel\/layout|miguelLayoutMoved/, f);
});

test('Mizel skins carry colours only: no layout rule, gated or not', () => {
  for (const [d, p] of [['obsidian', 'html[data-skin^="obsidian"]'], ['landscapes', 'html[data-skin^="landscapes"]']]) {
    const css = read(`web/skins/${d}/skin.css`);
    assert.ok(!css.includes('miguel/layout'), `${d}: nothing gated on the retired layout tweak`);
    // Markup only another tweak renders (model switch, dials, dock back) keeps its own rules; nothing else ungated moves things.
    const OTHER = /\.(ms-[\w-]+|rs-[\w-]+|mz-[\w-]+)/;
    const ungated = css.split('\n').filter(l => l.startsWith(p) && !l.includes('[data-tweaks~=') && !l.slice(0, l.indexOf('{')).replace(/\([^()]*\)/g, '').replace(/\([^()]*\)/g, '').split(',').every(s => OTHER.test(s)));
    for (const l of ungated) assert.doesNotMatch(l, /\{[^}]*\b(display|order|flex-direction|position)\s*:/, `${d}: ungated layout: ${l.slice(0, 140)}`);
  }
});

async function boot(skin, saved) {
  const storage = new Map([['wos.skin', skin], ['wos.skin-tweaks.v1', JSON.stringify({ version: 1, off: {}, preset: 'none', defaultsMigrated: true, machinesHomeMoved: true, ...saved })]]);
  let active = [];
  const window = { WosSkin: { current: skin, families: [], familyOf: () => '' }, WosSkinHost: { personalState: { ready: false }, get tweakState() { return active; }, loadTweaks: async ids => { active = ids; } }, addEventListener() {}, dispatchEvent() {} };
  runWithChatsModel(read('web/core/experience.js'), { window, setTimeout, document: { baseURI: 'https://wizard.test/wizard-os-home/', addEventListener() {}, documentElement: { dataset: { skin } } }, Event, URL, AbortSignal, localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) }, fetch: async url => ({ ok: true, json: async () => JSON.parse(read('web/' + url.pathname.split('/wizard-os-home/')[1])) }) });
  await window.WosExperience.refresh();
  return { active, mix: JSON.parse(storage.get('wos.skin-tweaks.v1')).mix || {} };
}

test('a Mizel skin with Miguel\'s tweaks on (or an old miguel/layout switch saved) loads no layout tweak', async () => {
  const his = await boot('obsidian-light', { mix: { 'miguel/send-and-go': true } });
  assert.ok(his.active.includes('miguel/send-and-go'), 'his other tweaks still load');
  assert.ok(!his.active.includes('miguel/layout'), 'no layout migration');
  const old = await boot('landscapes', { mix: { 'miguel/send-and-go': true, 'miguel/layout': true } });
  assert.ok(!old.active.includes('miguel/layout'), 'a saved switch for the retired id does nothing');
});
