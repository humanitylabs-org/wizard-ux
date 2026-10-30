// Miguel's screenshot (29 Oct 2026): the desktop app picker showed "Troubleshoote / r". A long one-word name must get
// the `long` label class (smaller type, the tile's side padding) and never break mid-word without a hyphen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const js = fs.readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../web/desktop/desktop.css', import.meta.url), 'utf8');
test('app picker tiles mark long one-word names', () => {
  const marks = js.match(/<span class="nm\$\{\/\\S\{13,\}\/\.test\(it\.name\) \? ' long' : ''\}">/g) || [];
  assert.equal(marks.length, 2, 'both picker renderers mark long names');
  assert.ok(/\S{13,}/.test('Troubleshooter') && !/\S{13,}/.test('Home Assistant'));
});
test('long labels fit the tile and never split a word bare', () => {
  assert.match(css, /\.pal-app \.nm\.long \{[^}]*font-size: calc\(var\(--wz-text-sm\) \* \.85\);[^}]*max-width: calc\(100% \+ 8px\);[^}]*margin-inline: -4px;/);
  // The last rule that sets overflow-wrap on the label wins: it must break whole words with a hyphen.
  const wraps = [...css.matchAll(/\.pal-app \.nm \{[^}]*overflow-wrap:[^}]*\}/g)].map(m => m[0]);
  assert.match(wraps.at(-1), /overflow-wrap: break-word;[^}]*hyphens: auto/);
});
