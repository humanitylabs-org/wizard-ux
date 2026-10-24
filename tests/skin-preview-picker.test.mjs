import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('skin picker renders preview cards for every skin, names in each skin\'s own face', () => {
  const s = read('web/core/settings.js');
  assert.match(s, /class="skp-all\$\{facesReady \? '' : ' skp-wait'\}"/);
  assert.doesNotMatch(s, /class="sk-dot"/, 'no dot swatches left');
  assert.match(s, /data-skinfamily=/, 'family tiles precede the picked family colours');
  const k = read('web/core/skins.js');
  assert.match(k, /face: FACES\[s\.id\] \|\| null, t: \{ \.\.\.s\.t \}/);
  for (const id of ['nebula', 'grove', 'tide', 'ember', 'signal']) assert.match(k, new RegExp(`\\n    ${id}: \\{ family:`));
});

test('preview card styles are shell-wide (not gated to one skin) and the Landscapes preview image ships', () => {
  const css = read('web/core/skins.css');
  assert.match(css, /\n\.st-root \.skp \{ display: grid;/);
  assert.match(css, /\n\.st-root \.skp-wait \.skp-nm \{ visibility: hidden; \}/);
  assert.doesNotMatch(css, /html\[data-skin[^\n]*\.skp/, 'no skin gate on the picker');
  assert.ok(readFileSync(new URL('../web/skins/landscapes/preview.webp', import.meta.url)).length > 1000);
});
