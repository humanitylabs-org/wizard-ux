// Skins are look only (wizard-ux issue 1190, switch wizard/skins-look-only), Miguel 20 Nov 2026: "it's really just colors
// and background". With the switch on, Settings > Appearance > Look shows colours and background only (no skins, own
// skins or New skin, no feature switches), and the feature switches move to their own "Try new features" page. Off:
// Look is unchanged. Runs the real Settings renderer and dispatch.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { withSettingsParts } from './fixtures/settings-parts.mjs';
const source = withSettingsParts(fs.readFileSync(new URL('../web/core/settings.js', import.meta.url), 'utf8'));

function harness({ lookOnly, channel = 'latest', own = false, shell = 'desktop' }) {
  const picked = [], toggled = [], updated = [];
  const S = {
    current: 'nebula',
    list: ['nebula', 'grove', 'obsidian', 'obsidian-light', 'landscapes', 'landscapes-light', 'sepia'].map(id => ({ id, name: id, t: {} })),
    families: [{ id: 'wizard', name: 'Wizard', palettes: ['nebula', 'grove'] }, { id: 'mizel', name: 'Mizel', palettes: ['obsidian', 'obsidian-light', 'landscapes', 'landscapes-light'] }, { id: 'novairecito', name: 'Novairecito', palettes: ['sepia'] }],
    familyOf: id => /^(obsidian|landscapes)/.test(id) ? 'mizel' : id === 'sepia' ? 'novairecito' : 'wizard',
    lastIn: id => ({ wizard: 'nebula', mizel: 'obsidian', novairecito: 'sepia' })[id],
    set(id) { picked.push(id); this.current = id; },
    setFamily(id) { this.set(this.lastIn(id)); },
  };
  const tweaks = [
    { id: 'wizard/skins-look-only', name: 'Skins are look only', author: 'wizard', on: lookOnly },
    { id: 'miguel/snooze-someday', name: 'One-tap Snooze', author: 'miguel', on: false },
    { id: 'miguel/orb-shell', name: 'Orb', author: 'miguel', view: 'Orb', on: false },
  ];
  const E = { lookOnly, installedReady: true, installed: async () => [], defaults: async () => ({}),
    state: { owner: 'miguel', busy: false, error: '', channel, locked: channel === 'stable', tweaks, active: [], shell },
    toggle: async id => { toggled.push(id); } };
  const M = { recipes: [{ id: 'mine', name: 'My look', base: 'grove' }], active: own ? { id: 'mine', name: 'My look', base: 'grove' } : null, previews: [], on() {},
    update(p) { updated.push(p); }, leave() {}, wear() {} };
  const s = { console, URL, setTimeout, CSS: { escape: String }, navigator: { userAgent: 'Desktop' },
    document: { activeElement: null }, location: { host: 'example.test' }, WizCore: {}, WosSkin: S, WosExperience: E, WosMySkin: M };
  s.window = s;
  vm.runInNewContext(source, s);
  const root = { innerHTML: '', scrollTop: 0, dataset: {}, classList: { add() {} }, contains: () => false,
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  const view = s.WosSettings.mount(root, { shell, live: { ok: true } });
  const act = (feature, attr, value) => view.dispatch({ closest: sel => sel === '[data-settings-feature]'
    ? { dataset: { settingsFeature: feature } }
    : sel === `[${attr}]` ? { dataset: { [attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]: value } } : null });
  return { S, E, M, s, root, view, act, picked, toggled, updated };
}
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

for (const shell of ['phone', 'desktop']) test(`${shell}: with Skins are look only on, Look is colours and background only`, () => {
  const h = harness({ lookOnly: true, shell });
  h.view.focus('look');
  const html = h.root.innerHTML;
  assert.match(html, /data-look-only/);
  assert.doesNotMatch(html, /data-skinfamily=|aria-label="Skins"/, 'no skins');
  assert.doesNotMatch(html, /data-ownskin=|data-newskin/, 'no own skins and no New skin');
  for (const id of ['nebula', 'grove', 'obsidian', 'obsidian-light', 'sepia']) assert.match(html, new RegExp(`data-skinpick="${id}"`), id);
  assert.doesNotMatch(html, /data-skinpick="landscapes/, 'landscapes are a background, not a colour');
  assert.match(html, /data-skinpick="nebula" aria-pressed="true"/);
  assert.doesNotMatch(html, /data-try-features|data-tweak-toggle="miguel\/snooze-someday"|data-tweak-toggle="wizard\/skins-look-only"/, 'no feature switches on Look');
  assert.match(html, /data-tweak-toggle="miguel\/orb-shell"/, 'views stay with Look');
  assert.doesNotMatch(html, /data-skinimport/, 'no skin import');
  h.view.destroy();
});

for (const shell of ['phone', 'desktop']) test(`${shell}: with Skins are look only on, feature switches have their own Try new features page`, async () => {
  const h = harness({ lookOnly: true, shell });
  h.view.focus('look');
  assert.match(h.root.innerHTML, /data-st-page="try-features"[^]*<b>Try new features<\/b>/, 'listed in Settings');
  h.view.focus('try-features');
  assert.equal(h.view.page, 'try-features');
  const html = h.root.innerHTML;
  assert.match(html, /data-try-features><h4>Try new features<\/h4>[^]*data-tweak-toggle="miguel\/snooze-someday"/);
  assert.match(html, /data-tweak-toggle="wizard\/skins-look-only"/, 'the switch itself can be turned off here');
  assert.doesNotMatch(html, /data-skinpick=/, 'no colours on this page');
  h.act('try-features', 'data-tweak-toggle', 'wizard/skins-look-only'); await tick();
  assert.deepEqual(h.toggled, ['wizard/skins-look-only']);
  h.view.destroy();
});

test('For everyone: no Try new features page, even with Skins are look only on', () => {
  const h = harness({ lookOnly: true, channel: 'stable' });
  h.view.focus('look');
  assert.doesNotMatch(h.root.innerHTML, /data-st-page="try-features"/);
  h.view.destroy();
});

for (const shell of ['phone', 'desktop']) test(`${shell}: with Skins are look only off, Look is unchanged and there is no extra page`, () => {
  const h = harness({ lookOnly: false, shell });
  h.view.focus('look');
  const html = h.root.innerHTML;
  assert.match(html, /aria-label="Skins"/);
  assert.match(html, /data-skinfamily="mizel"/);
  assert.match(html, /data-ownskin="mine"/);
  assert.match(html, /data-try-features[^]*data-tweak-toggle="miguel\/snooze-someday"/, 'switches stay at the bottom of Look');
  assert.doesNotMatch(html, /data-skinpick="obsidian"/, 'colours stay per skin');
  assert.doesNotMatch(html, /data-st-page="try-features"/);
  h.view.destroy();
});

test('with Skins are look only on, a colour is worn plainly (an own skin is not rewritten)', async () => {
  const on = harness({ lookOnly: true, own: true });
  on.view.focus('look');
  on.act('look', 'data-skinpick', 'obsidian'); await tick();
  assert.deepEqual(on.picked, ['obsidian']);
  assert.deepEqual(on.updated, [], 'the own skin recipe is left as it is');
  on.view.destroy();
  const off = harness({ lookOnly: false, own: true });
  off.view.focus('look');
  off.act('look', 'data-skinpick', 'nebula'); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(off.updated)), [{ base: 'nebula' }], 'switch off: unchanged, the own skin takes the colour');
  off.view.destroy();
});

test('with Skins are look only on, a landscape background marks its plain colour as worn', () => {
  const h = harness({ lookOnly: true });
  h.S.current = 'landscapes-light';
  h.view.focus('look');
  assert.match(h.root.innerHTML, /data-skinpick="obsidian-light" aria-pressed="true"/);
  h.view.destroy();
});
