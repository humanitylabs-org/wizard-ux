// Chats accent controls (the section count, the New chat button, the active sort) follow the palette the skin sets:
// the real chats.css cascaded over those elements, with two made-up palettes, and var() resolved the way a browser does
// (tests/fixtures/r7A-css.mjs). Wizard-ux issue 1674: tests run the code, CSS included.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { valueOf } from './fixtures/r7A-css.mjs';

const chats = readFileSync(new URL('../web/core/chats.css', import.meta.url), 'utf8');
const PALETTES = { a: { violet: '#123456', violet2: '#0a0b0c', base: '#fefdfc', bg: '#010203' }, b: { violet: '#e05a00', violet2: '#bb4400', base: '#111111', bg: '#222222' } };
const palette = id => { const p = PALETTES[id]; return `html[data-pal="${id}"] { --violet: ${p.violet}; --violet-2: ${p.violet2}; --wz-base: ${p.base}; --bg: ${p.bg}; }`; };

function page(id) {
  const doc = createDocument();
  doc.documentElement.setAttribute('data-pal', id);
  doc.body.innerHTML = '<div class="ch-sec-h"><b>3</b></div><button class="ch-fab">+</button><div class="ch-rdy-bar"><button class="on">Newest</button></div>';
  const v = (q, prop) => valueOf(doc.querySelector(q), [chats, palette(id)], prop).replace(/\s+/g, ' ').trim();
  return { v };
}
const bgOf = (p, q) => p.v(q, 'background') || p.v(q, 'background-color');

for (const id of Object.keys(PALETTES)) test(`palette ${id}: Chats accent controls take its accent, with its base as ink`, () => {
  const P = PALETTES[id], p = page(id);
  assert.equal(bgOf(p, '.ch-sec-h b'), P.violet, 'the section count is filled with the accent');
  assert.equal(p.v('.ch-sec-h b', 'color'), P.base, 'its number is the palette base');
  assert.ok(bgOf(p, '.ch-fab').includes(P.violet), 'New chat follows the accent');
  assert.equal(p.v('.ch-fab', 'color'), P.base);
  assert.equal(bgOf(p, '.ch-rdy-bar button.on'), `color-mix(in srgb, ${P.violet} 14%, transparent)`, 'the active sort is a light accent tint');
  assert.equal(p.v('.ch-rdy-bar button.on', 'border-color'), `color-mix(in srgb, ${P.violet2} 45%, transparent)`);
});
