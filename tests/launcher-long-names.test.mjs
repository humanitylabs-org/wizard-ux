// Miguel's screenshot (29 Oct 2026): the desktop app picker showed "Troubleshoote / r". A long one-word name must get
// the `long` label class (smaller type, the tile's side padding) and never break mid-word without a hyphen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { withShellParts } from './fixtures/shell-parts.mjs';
const js = withShellParts(fs.readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8'));
const css = withShellParts(fs.readFileSync(new URL('../web/desktop/desktop.css', import.meta.url), 'utf8'));
test('app picker tiles mark long one-word names', () => {
  // the real picker paint line (desktop-picker.js), run with two apps (wizard-ux issue 1674: tests run the code)
  const picker = fs.readFileSync(new URL('../web/desktop/desktop-picker.js', import.meta.url), 'utf8');
  const i = picker.indexOf('    palList.innerHTML = desktopVars.palItems.map('), line = picker.slice(i, picker.indexOf('\n', i));
  const palList = { innerHTML: '' };
  vm.runInNewContext(line, { palList, desktopVars: { palSel: 0, palItems: [{ name: 'Troubleshooter', app: {} }, { name: 'Home Assistant', app: {} }] }, esc: String, ico: () => '' });
  const names = [...palList.innerHTML.matchAll(/<span class="nm([^"]*)">([^<]*)</g)].map(m => [m[2], m[1].trim()]);
  assert.deepEqual(names, [['Troubleshooter', 'long'], ['Home Assistant', '']], 'only a long one-word name gets the smaller label');
});
test('long labels fit the tile and never split a word bare', () => {
  assert.match(css, /\.pal-app \.nm\.long \{[^}]*font-size: calc\(var\(--wz-text-sm\) \* \.85\);[^}]*max-width: calc\(100% \+ 8px\);[^}]*margin-inline: -4px;/);
  // The last rule that sets overflow-wrap on the label wins: it must break whole words with a hyphen.
  const wraps = [...css.matchAll(/\.pal-app \.nm \{[^}]*overflow-wrap:[^}]*\}/g)].map(m => m[0]);
  assert.match(wraps.at(-1), /overflow-wrap: break-word;[^}]*hyphens: auto/);
});
