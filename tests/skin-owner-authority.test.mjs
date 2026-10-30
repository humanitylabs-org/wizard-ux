import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('owner correction is an existing instruction, not an unresolved opacity decision', () => {
  const contract = read('docs/OPAQUE_OVERLAYS.md');
  assert.match(contract, /already explicitly ordered preserving Miguel/);
  assert.match(contract, /do not reask, edit his skins, or force opacity/);
  assert.match(contract, /Base defaults only/);
});

test('inherited fallback is weaker than explicit package and My skin selectors', () => {
  const css = read('web/core/skins.css');
  assert.match(css, /:where\(html:not\(\[data-skin="nebula"\]\)\) :is\(\.sheet/);
  assert.doesNotMatch(css, /background:[^;]*!important/);
  for (const name of ['obsidian', 'landscapes']) {
    const skin = read('web/skins/' + name + '/skin.css');
    assert.match(skin, /backdrop-filter/);
    assert.match(skin, /rgba\(|transparent|color-mix/);
  }
});
