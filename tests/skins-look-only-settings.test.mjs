// Skins are look only (wizard-ux issue 1190; Miguel 20 Nov 2026 "it's really just colors and background", James 25
// Nov: one list of looks, own skins, New skin and skin import stay, as looks). On for everyone, no switch: Settings >
// Appearance > Look is the looks (no skin families, no feature switches), and the feature switches have their own
// "Try new features" page. Runs the real Settings renderer and dispatch.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { withSettingsParts } from './fixtures/settings-parts.mjs';
const source = withSettingsParts(fs.readFileSync(new URL('../web/core/settings.js', import.meta.url), 'utf8'));

function harness({ channel = 'latest', own = false, shell = 'desktop' } = {}) {
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
    { id: 'miguel/snooze-someday', name: 'One-tap Snooze', author: 'miguel', on: false },
    { id: 'miguel/orb-shell', name: 'Orb', author: 'miguel', view: 'Orb', on: false },
  ];
  const E = { installedReady: true, installed: async () => [], defaults: async () => ({}),
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

for (const shell of ['phone', 'desktop']) test(`${shell}: Look is the looks: every colour, own skins, + New skin, Background, Views`, () => {
  const h = harness({ shell });
  h.view.focus('look');
  const html = h.root.innerHTML;
  assert.match(html, /data-look-only/);
  assert.doesNotMatch(html, /data-skinfamily=|aria-label="Skins"/, 'no skin families');
  assert.match(html, /data-ownskin="mine"/, 'own skins are looks');
  assert.match(html, /data-newskin/, '+ New skin');
  for (const id of ['nebula', 'grove', 'obsidian', 'obsidian-light', 'sepia']) assert.match(html, new RegExp(`data-skinpick="${id}"`), id);
  assert.doesNotMatch(html, /data-skinpick="landscapes/, 'landscapes are a background, not a colour');
  assert.match(html, /data-skinpick="nebula" aria-pressed="true"/);
  assert.doesNotMatch(html, /data-try-features|data-tweak-toggle="miguel\/snooze-someday"/, 'no feature switches on Look');
  assert.doesNotMatch(html, /skins-look-only/, 'the old switch is gone');
  assert.match(html, /data-tweak-toggle="miguel\/orb-shell"/, 'views stay with Look');
  assert.match(html, /data-skinimport/, 'skin import stays');
  h.view.destroy();
});

for (const shell of ['phone', 'desktop']) test(`${shell}: feature switches have their own Try new features page`, async () => {
  const h = harness({ shell });
  h.view.focus('look');
  assert.match(h.root.innerHTML, /data-st-page="try-features"[^]*<b>Try new features<\/b>/, 'listed in Settings');
  h.view.focus('try-features');
  assert.equal(h.view.page, 'try-features');
  const html = h.root.innerHTML;
  assert.match(html, /data-try-features><h4>Try new features<\/h4>[^]*data-tweak-toggle="miguel\/snooze-someday"/);
  assert.doesNotMatch(html, /data-skinpick=/, 'no colours on this page');
  h.act('try-features', 'data-tweak-toggle', 'miguel/snooze-someday'); await tick();
  assert.deepEqual(h.toggled, ['miguel/snooze-someday']);
  h.view.destroy();
});

test('For everyone: no Try new features page', () => {
  const h = harness({ channel: 'stable' });
  h.view.focus('look');
  assert.doesNotMatch(h.root.innerHTML, /data-st-page="try-features"/);
  h.view.destroy();
});

test('a colour is worn plainly: an own skin is taken off, never rewritten', async () => {
  const h = harness({ own: true });
  h.view.focus('look');
  assert.match(h.root.innerHTML, /data-ownskin="mine" aria-pressed="true"/);
  assert.doesNotMatch(h.root.innerHTML, /<h4>Background<\/h4>/, 'an own skin sets its own background');
  h.act('look', 'data-skinpick', 'obsidian'); await tick();
  assert.deepEqual(h.picked, ['obsidian']);
  assert.deepEqual(h.updated, [], 'the own skin recipe is left as it is');
  h.view.destroy();
});

test('a landscape background marks its plain colour as worn', () => {
  const h = harness();
  h.S.current = 'landscapes-light';
  h.view.focus('look');
  assert.match(h.root.innerHTML, /data-skinpick="obsidian-light" aria-pressed="true"/);
  h.view.destroy();
});
