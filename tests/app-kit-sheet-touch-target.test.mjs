// Sheet close button meets the 44px touch-target rule (wizard-os APP-DESIGN-RULES rule 6, issue wizard-os#272).
// The real sheet script (web/kit/wizard-sheet.js) adds the × to a sheet; the kit CSS decides how big its hit area is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { runRecording } from './fixtures/source-slice.mjs';
import { scoped } from './fixtures/r5B-parts.mjs';

const read = p => readFileSync(new URL('../web/' + p, import.meta.url), 'utf8');
const kit = read('kit/wizard-ui.css');

function sheetClose() {
  const doc = scoped(createDocument()), window = {};
  runRecording(read('kit/wizard-sheet.js'), { window });
  const d = doc.createElement('dialog'); d.className = 'wz-sheet'; d.innerHTML = '<h2>T</h2>';
  d.showModal = () => { d.open = true; }; d.close = () => { d.open = false; };
  doc.body.appendChild(d);
  window.WzSheet.open(d);
  return d.querySelector('.wz-sheet-x');
}
const px = v => { const m = /^(-?\d+(?:\.\d+)?)px$/.exec(String(v ?? '').trim()); return m ? Number(m[1]) : NaN; };

test('sheet close button hit area reaches 44px around its 36px circle', () => {
  const x = sheetClose();
  assert.ok(x, 'the sheet script adds the × button');
  const own = cascade(x, kit), after = cascade(x, kit, { pseudo: '::after' });
  const size = px(own.width?.value);
  assert.equal(size, 36, 'the visible circle');
  assert.match(own.position?.value || '', /^(sticky|relative|absolute|fixed)$/, 'button must contain its hit-area pseudo-element');
  assert.equal(after.position?.value, 'absolute', 'expected a .wz-sheet-x::after hit-area extension');
  const inset = -px(after.inset?.value);
  assert.ok(size + 2 * inset >= 44, `hit area ${size + 2 * inset}px is below 44px`);
});
