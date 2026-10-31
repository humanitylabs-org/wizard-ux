// Variant of Oscar's wizard-ux #768 (James, 31 Oct 2026): keep its fixes and Select all, keep own skins and + New skin.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL('../web/' + p, import.meta.url), 'utf8');
const my = read('core/my-skin.js'), exp = read('core/experience.js'), set = read('core/settings.js');

test('+ New skin and Your skins stay; tweaks gain Select all', () => {
  assert.match(set, /data-newskin aria-label="New skin"/);
  assert.match(set, /data-tweak-all role="switch"/);
  assert.match(set, /el\.closest\('\[data-tweak-all\]'\)\) \{ void window\.WosExperience\?\.setAll\?\.\(\)/);
  assert.doesNotMatch(set, /data-tweakset/);
});

test('a picked skin survives reload: the worn recipe brings its base only when newly worn', () => {
  assert.match(my, /if \(oldActive !== recipes\.active && own\(\) && window\.WosSkin\?\.current !== own\(\)\.base/);
  assert.match(set, /skinAction\(\(\) => \{ S\.set\(b\.dataset\.skinpick\); return M\?\.active \? M\.leave\(\) : null; \}/);
});

test('tweaks survive reload: device switches are the truth; a worn recipe copies its tweaks once', () => {
  assert.match(exp, /const recipe = \(\) => null;/);
  assert.doesNotMatch(exp, /WosMySkin\.update\(\{ tweaks/);
  assert.match(exp, /if \(had === a\.id\) return;\s*localStorage\.setItem\(WORN, a\.id\);/);
});

test('no more empty My skin 2/3: same name is the same skin, blank My skin folders are hidden', () => {
  assert.match(my, /let found = list\.skins\.find\(k => k\.name === s\.name \|\| \(s\.legacy && \/\^My skin\( \\d\+\)\?\$\/\.test\(k\.name\)\)\);/);
  assert.match(my, /const blank = s => \/\^My skin\( \\d\+\)\?\$\/\.test\(s\.id\) && s\.empty && !s\.has_script && !s\.has_recipe && s\.id !== list\.active;/);
});
