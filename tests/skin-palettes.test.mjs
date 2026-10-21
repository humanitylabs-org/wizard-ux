import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// wizard-os spec/SKINS_AND_VIEWS.md §1: palettes live inside skins.
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('the two skins hold the right palettes, and an unlisted skin becomes its own skin', () => {
  const s = read('web/core/skins.js');
  assert.match(s, /\{ id: 'wizard', name: 'Wizard', [^\n]*palettes: \['nebula', 'grove', 'tide', 'ember', 'signal'\] \}/);
  assert.match(s, /\{ id: 'mizel', name: 'Mizel', [^\n]*palettes: \['obsidian', 'obsidian-light', 'landscapes'\] \}/);
  assert.match(s, /\{ id: 'novairecito', name: 'Novairecito', [^\n]*palettes: \['novairecito', 'sepia'\] \}/, 'Novaire’s looks are colours of one skin');
  assert.match(s, /if \(!f\) f = \{ id: s\.id, name: s\.name, who: s\.who, palettes: \[s\.id\] \};/);
  assert.match(s, /families: FAMS,/);
});

test('the saved choice stays the palette id; the last palette per skin is remembered', () => {
  const s = read('web/core/skins.js');
  assert.match(s, /localStorage\.setItem\(KEY, SKINS\[i\]\.id\); localStorage\.setItem\(LAST \+ SKINS\[i\]\.family, SKINS\[i\]\.id\)/);
  assert.match(s, /setFamily\(fid\) \{ const id = this\.lastIn\(fid\)/);
  assert.match(s, /return ids\.includes\(v\) \? v : ids\[0\]/, 'a stale or foreign saved palette falls back to the skin\'s first');
});

test('Settings › Look shows skin cards, then only the worn skin\'s colours', () => {
  const s = read('web/core/settings.js');
  assert.match(s, /data-skinfamily="\$\{esc\(f\.id\)\}"/);
  assert.match(s, /S\.list\.filter\(k => f\.palettes\.includes\(k\.id\)\)/);
  assert.match(s, /aria-label="Colours"/);
  assert.match(s, /S\.setFamily\(fb\.dataset\.skinfamily\)/);
});

test('Appearance v1 adds the skin family without changing the palette field', () => {
  const s = read('web/core/appearance-host.js');
  assert.match(s, /skin: t\.skin, family: window\.WosSkin\?\.familyOf\?\.\(t\.skin\) \|\| 'wizard'/);
});
