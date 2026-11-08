import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// wizard-os spec/SKINS_AND_VIEWS.md §1: palettes live inside skins.
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('the two skins hold the right palettes, and an unlisted skin becomes its own skin', () => {
  const s = read('web/core/skins.js');
  assert.match(s, /\{ id: 'wizard', name: 'Wizard', [^\n]*palettes: \['nebula', 'grove', 'tide', 'ember', 'signal'\] \}/);
  assert.match(s, /\{ id: 'mizel', name: 'Mizel', [^\n]*palettes: \['obsidian', 'obsidian-light', 'landscapes', 'landscapes-light'\] \}/);
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

test('Settings › Look separates family tiles from family-scoped Colours, without a Chats pairing', () => {
  const s = read('web/core/settings.js');
  assert.match(s, /data-skinfamily=/);
  assert.doesNotMatch(s, /suggestionHtml|data-chats-suggest/);
  assert.match(s, /aria-label="Skins">\$\{tiles\}\$\{ownTiles\(S, ctx\.skinRemoving\)\}\$\{newTile\(\)\}<\/div>/, 'own skins stay in the family row');
  assert.match(s, /<h4>Colors<\/h4>/);
  assert.match(s, /\(family\?\.palettes \|\| \[\]\)\.map/, 'only the chosen family supplies colours');
  assert.doesNotMatch(s, /S\.list\.map\(k => skinCard/, 'never flatten all colours into a Skin grid');
  assert.match(s, /S\.setFamily\(family\.dataset\.skinfamily\)/);
});

test('Appearance v1 adds the skin family without changing the palette field', () => {
  const s = read('web/core/appearance-host.js');
  assert.match(s, /skin: t\.skin, family: window\.WosSkin\?\.familyOf\?\.\(t\.skin\) \|\| 'wizard'/);
});

test('colors and tweaks are separate: onboarding offers every color; Look offers tweak sets apart from color', () => {
  const w = read('web/core/welcome.js'), s = read('web/core/settings.js'), e = read('web/core/experience.js');
  assert.match(w, /const cur = S\.current, list = S\.list;/, 'first run lists every color, not one skin\'s');
  assert.doesNotMatch(w, /fam\.palettes/);
  assert.doesNotMatch(s, /data-tweakauthor=/, 'one flat list: no per-author quick button (Miguel, 1 Nov 2026)');
  assert.match(s, /list\.map\(t => tweakSwitches\(\[t\], 'data-tweak-toggle', s\.busy, name\)/, 'a switch per tweak');
  assert.doesNotMatch(s, /data-tweakpreset/, 'no preset sets: everything starts off');
  assert.match(e, /chooseSkin\(\) \{ if \(error \|\| wornOwner\(\) !== owner\) return apply\(\); return Promise\.resolve\(\); \}/, 'a color pick never swaps the tweak set');
  for (const who of ['wizard', 'miguel']) assert.equal(typeof JSON.parse(read(`web/tweaks/${who}/profile.json`)).name, 'string', who + ' set has a display name');
});

test('features on for everyone are plain settings where they act, not tweaks', () => {
  const s = read('web/core/settings.js');
  assert.doesNotMatch(s, /Built in/, 'no "built-in tweaks"');
  assert.match(s, /register\(\{ id: 'notifications-in-chats', page: 'chats'/);
  assert.match(s, /register\(\{ id: 'home-network', page: 'appearance'/);
  // On a desktop with standard views, the view tweaks move to the Shell view picker; built-ins stay out either way.
  assert.match(s, /const exp = s\.tweaks\.filter\(t => !t\.builtin && !\(E\.desktopViews\?\.length && t\.layout\)\);/, 'Tweaks lists only contributed ones');
});

test('review: a new skin starts from the worn own skin\'s choices; an upgraded device keeps the retired Home map CSS for its first frame', () => {
  const e = read('web/core/experience.js'), cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.match(e, /list\.map\(m => \[m\.id, enabled\(m\.id, recipe\(\)\)\]\)/);
  for (const old of Object.keys(cat.aliases)) {
    assert.ok(!cat.tweaks.includes(old), old + ' is retired');
    if (old === 'miguel/machines-home') assert.match(read(`web/tweaks/${old}/tweak.css`), /html\[data-tweaks~="miguel\/machines-home"\] \.home > :is\(\.home-top/, 'boot preload still hides stock Home');
  }
});
