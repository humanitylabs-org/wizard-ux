import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';

const css = readFileSync(new URL('../web/skins/landscapes/skin.css', import.meta.url), 'utf8');

const hex = value => {
  const h = value.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
};
const lum = rgb => rgb.map(v => {
  const x = v / 255;
  return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
}).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
// A colour as drawn over the page: #rrggbb, or rgba() blended over `under`.
const over = (value, under) => {
  if (/^#[0-9a-f]{6}$/i.test(value)) return hex(value);
  const m = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/.exec(value); assert.ok(m, value);
  const a = m[4] === undefined ? 1 : Number(m[4]);
  return [1, 2, 3].map((k, i) => Math.round(Number(m[k]) * a + under[i] * (1 - a)));
};

test('Landscapes Light read previews clear the normal-text contrast floor', () => {
  // Chats rows (skeleton of the list markup): a read row, an unread row and a saved draft, on Landscapes Light
  const doc = createDocument(); doc.documentElement.setAttribute('data-skin', 'landscapes-light');
  doc.body.innerHTML = '<div class="ch-list"><button class="ch-row" id="read"><span class="bd"><span class="pv">Read preview</span></span></button>'
    + '<button class="ch-row unread" id="unread"><span class="bd"><span class="pv">New</span></span></button>'
    + '<button class="ch-row draft" id="draft"><span class="bd"><span class="pv">Draft · saved on this device</span></span></button></div>';
  const color = id => cascade(doc.querySelector(`#${id} .pv`), css).color?.value;
  assert.equal(color('read'), 'rgba(17, 18, 22, .62)');
  const paper = hex('#fafafc');
  assert.ok(contrast(over(color('read'), paper), paper) >= 4.5, 'a read preview reaches 4.5:1 on the light page');
  assert.notEqual(color('draft'), color('read'), 'saved drafts keep their amber semantic preview');
  assert.notEqual(color('unread'), color('read'), 'unread rows keep their own ink');
});
