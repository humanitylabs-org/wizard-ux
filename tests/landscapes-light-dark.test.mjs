// Miguel, 28 Oct 2026: Landscapes split into Landscapes Dark (night and dusk photos, dark glass) and Landscapes Light
// (day photos, light glass). The dark one keeps the 'landscapes' id so a saved choice carries over.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const js = read('web/core/skins.js');

test('Mizel offers Landscapes Dark and Landscapes Light, both from the one Landscapes package', () => {
  assert.match(js, /\{ id: 'landscapes', pkg: \{ css: true, dir: 'landscapes' \}, name: 'Landscapes Dark'/);
  assert.match(js, /\{ id: 'landscapes-light', pkg: \{ css: true, dir: 'landscapes' \}, name: 'Landscapes Light'/);
});

test('each palette rotates only its own photos, split by overall brightness, and together they cover all sixteen', () => {
  const dark = js.match(/dark: make\(\[([\d, ]+)\]/)[1].split(',').map(Number);
  const light = js.match(/light: make\(\[([\d, ]+)\]/)[1].split(',').map(Number);
  assert.deepEqual(dark, [6, 7, 8, 10, 13, 14]);
  assert.deepEqual([...dark, ...light].sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => i));
  assert.match(js, /landscapes: LANDSCAPES\.dark,\s*'landscapes-light': LANDSCAPES\.light,/);
  assert.match(js, /'wos\.skin\.landscapes-light\.at'/, 'Light keeps its own place in the rotation');
});

test('the Landscapes package and Miguel\'s shell rules cover both palettes', () => {
  const css = read('web/skins/landscapes/skin.css');
  assert.doesNotMatch(css, /data-skin="landscapes"\]/, 'shared rules use ^="landscapes"');
  assert.match(css, /html\[data-skin="landscapes-light"\]:is\(\[data-shell="desktop"\], :not\(\[data-shell="desktop"\]\)\) \.msg\.u \.bub \{ background: rgba\(0, 0, 0, \.07\)/);
  for (const f of ['web/app.js', 'web/live.js', 'web/core/chats.js', 'web/core/chat-models.js', 'web/desktop/desktop.js']) assert.match(read(f), /'landscapes', 'landscapes-light'/, f);
  assert.doesNotMatch(read('web/desktop/desktop.css'), /data-skin="landscapes"\]/);
});

test('Landscapes Light: 85% window glass, white send arrow, full-colour marks, bright badges', () => {
  assert.match(js, /id: 'landscapes-light'[^\n]*\n[^\n]*\n[^\n]*\n[^\n]*'sk-win': 'rgba\(250,250,252,\.85\)'/);
  const css = read('web/skins/landscapes/skin.css');
  assert.match(css, /landscapes-light[^\n]*\.ch-compose button:is\(\.ch-send, \.ch-mic\.on\) svg \{ stroke: #fff; \}/);
  assert.match(css, /landscapes-light[^\n]*\.dsg \{ opacity: 1; \}/);
  assert.match(css, /landscapes-light[^\n]*:is\(\.dsg \.dbg, \.orb-badge\) \{ color: #160b05; background: #ffbe55;/);
});

test('skin names in the picker wrap to two lines instead of cutting off', () => {
  const css = read('web/core/skins.css');
  assert.match(css, /\.st-root \.skp-nm \{[^}]*-webkit-line-clamp: 2;[^}]*min-height: 18px;/);
  assert.doesNotMatch(css.match(/\.st-root \.skp-nm \{[^}]*\}/)[0], /nowrap/);
});

test('Landscapes Light: the Latest pill and the small in-thread notes read as ink on light glass', () => {
  const css = read('web/skins/landscapes/skin.css');
  assert.match(css, /landscapes-light"\]:is\(\[data-shell="desktop"\], :not\(\[data-shell="desktop"\]\)\) \.ch-latest \{ background: rgba\(250, 250, 252/);
  assert.match(css, /landscapes-light[^\n]*:is\(\.msg\.agentnote > summary, \.laterrun, [^\n]*\{ color: var\(--ink-2\); \}/);
});
