import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

import { settingsView, skinsRuntime } from './fixtures/skin-palettes-harness.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { styles } from './fixtures/w5-css.mjs';
import { noImports } from './fixtures/r7A-css.mjs';
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// The real Settings › Look over the real skins.js table; document.fonts holds the faces until the test lets them load.
test('skin picker renders preview cards for every skin, names in each skin\'s own face', async () => {
  const { S } = skinsRuntime();
  let loaded; const fontsLoad = new Promise(r => { loaded = r; }), asked = [];
  const document = { activeElement: null, fonts: { load: spec => (asked.push(spec), fontsLoad) } };
  const h = settingsView({ WosSkin: S, document, timer: () => 0 }); // the 2.5 s face deadline never fires here
  const html = h.html(), cls = [];
  h.root.querySelectorAll = sel => (sel === '.skp-wait' ? [{ classList: { remove: c => cls.push(c) } }] : []);
  assert.match(html, /class="skp-all skp-wait"/, 'names hidden until the faces load');
  assert.doesNotMatch(html, /class="sk-dot"/, 'no dot swatches left');
  // James, 25 Nov 2026 (wizard-ux#1190): skins are a look only, so every colour is a look in one list.
  assert.match(html, /<h4>Looks<\/h4>/);
  assert.doesNotMatch(html, /data-skinfamily=/, 'no separate family controls');
  for (const f of S.families) for (const id of f.palettes.filter(id => !/^landscapes/.test(id))) assert.match(html, new RegExp(`data-skinpick="${id}"`), id);
  // Each Wizard colour is a preview card (its own tokens) with the name set in its own face.
  for (const id of ['nebula', 'grove', 'tide', 'ember', 'signal']) {
    const k = S.list.find(x => x.id === id);
    assert.ok(k.face, id + ' has a face');
    const card = html.match(new RegExp(`<button type="button" class="skp-card" data-skinpick="${id}"[^>]*>(.*?)</button>`))?.[1] || '';
    assert.match(card, new RegExp(`<span class="skp-mini" data-skp="${id}" style="--p-bg:`), id + ' preview from its tokens');
    assert.ok(card.includes(`<span class="skp-nm" style="font-family:${k.face.family.replace(/"/g, '&quot;')};font-weight:${k.face.weight}`), id + ' name in its face');
  }
  assert.equal(asked.length, S.list.filter(k => k.face).length, 'every face is asked for');
  loaded(); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(cls, ['skp-wait'], 'names show once the faces are in');
  h.view.destroy();
});

test('preview card styles are shell-wide (not gated to one skin) and the Landscapes preview image ships', () => {
  const [css] = noImports(read('web/core/skins.css'));
  const { S } = skinsRuntime();
  const h = settingsView({ WosSkin: S, document: { activeElement: null, fonts: { load: () => new Promise(() => {}) } }, timer: () => 0 });
  const html = h.html(); h.view.destroy();
  // The picker as drawn (names still waiting for their faces), inside Settings, under every skin and none.
  for (const skin of ['', ...S.list.map(k => k.id)]) {
    const doc = createDocument(); if (skin) doc.documentElement.setAttribute('data-skin', skin);
    doc.body.innerHTML = `<div class="st-root">${html}</div>`;
    const grid = doc.querySelector('.skp'), name = doc.querySelector('.skp-wait .skp-nm');
    assert.ok(grid && name, 'the picker and a waiting name are drawn');
    assert.equal(styles(grid, [css]).display, 'grid', `${skin || 'no skin'}: preview cards laid out`);
    assert.equal(styles(name, [css]).visibility, 'hidden', `${skin || 'no skin'}: names hidden until their faces load`);
  }
  assert.doesNotMatch(css, /html\[data-skin[^\n]*\.skp/, 'no skin gate on the picker');
  assert.ok(statSync(new URL('../web/skins/landscapes/preview.webp', import.meta.url)).size > 1000, 'the Landscapes preview image ships');
});
