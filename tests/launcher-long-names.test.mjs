// Miguel's screenshot (29 Oct 2026): the desktop app picker showed "Troubleshoote / r". A long one-word name must get
// the `long` label class (smaller type, the tile's side padding) and never break mid-word without a hyphen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
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
  // the real picker paint line on mini-dom; the cascade decides what the long label gets
  const picker = fs.readFileSync(new URL('../web/desktop/desktop-picker.js', import.meta.url), 'utf8');
  const i = picker.indexOf('    palList.innerHTML = desktopVars.palItems.map('), line = picker.slice(i, picker.indexOf('\n', i));
  const doc = createDocument(), palList = doc.createElement('div'); palList.id = 'palList'; doc.body.appendChild(palList);
  vm.runInNewContext(line, { palList, desktopVars: { palSel: 0, palItems: [{ name: 'Troubleshooter', app: {} }, { name: 'Home Assistant', app: {} }] }, esc: String, ico: () => '' });
  const [long, short] = palList.querySelectorAll('.nm');
  assert.ok(long.classList.contains('long') && !short.classList.contains('long'));
  const l = cascade(long, css), sh = cascade(short, css);
  assert.equal(l['font-size']?.value, 'calc(var(--wz-text-sm) * .85)', 'smaller type');
  assert.equal(l['max-width']?.value, 'calc(100% + 8px)', 'the tile side padding');
  assert.equal(l['margin-inline']?.value, '-4px');
  assert.notEqual(sh['font-size']?.value, l['font-size']?.value, 'a short name keeps the normal size');
  // whole words break with a hyphen, never bare
  for (const el of [long, short]) { const c = cascade(el, css); assert.equal(c['overflow-wrap']?.value, 'break-word'); assert.equal(c.hyphens?.value, 'auto'); }
});
