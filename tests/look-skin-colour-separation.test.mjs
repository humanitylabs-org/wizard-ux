// James, repeated: no flattening colours into skins.
// Exercise the real Settings renderer and dispatch, not a parallel picker or a source-only label check.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../web/core/settings.js', import.meta.url), 'utf8');

function look(shell) {
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
  s.window = s;
  vm.runInNewContext(source, s);
  const root = { innerHTML: '', scrollTop: 0, dataset: {}, classList: { add() {} }, contains: () => false,
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  const view = s.WosSettings.mount(root, { shell, live: { ok: true } });
  view.focus('look');
  const act = (attr, value) => view.dispatch({ closest: selector => selector === '[data-settings-feature]'
    ? { dataset: { settingsFeature: 'look' } }
    : selector === `[${attr}]` ? { dataset: { [attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]: value } } : null });
  return { S, root, view, act, picked, familyPicked };
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
