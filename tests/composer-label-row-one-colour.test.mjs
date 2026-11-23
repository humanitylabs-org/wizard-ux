// Miguel's skins (Dark, Light, Landscapes, Landscapes Light): once a draft wraps, core moves the model label under the
// text (.ch-field.lab-row) and paints the FIELD, keeping the textarea transparent. These skins paint the textarea
// itself with a more specific rule, so the strip under the text showed a second colour behind "Opus" (Miguel, 2 Nov
// 2026). Each skin must hand the textarea's paint to the field in that state, and keep its button fill off the label.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onSkin } from './fixtures/w5-css.mjs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// The real cascade (core chat-power.css, then the skin) on a skeleton of the composer markup chats.js draws: once
// core's chats-fitlabel.js marks the field .lab-row, the field carries the paint the textarea had before.
const SHEETS = skin => [read('web/core/chat-power.css'), read(`web/skins/${skin}/skin.css`)];
const paint = (skin, name, selector, shell) => {
  const won = onSkin(SHEETS(skin), selector, { skin: name, shell });
  return won.background ?? won['background-color'] ?? '';
};
for (const [dir, skin] of [['obsidian', 'obsidian'], ['obsidian', 'obsidian-light'], ['landscapes', 'landscapes'], ['landscapes', 'landscapes-light']])
  test(`${skin}: label-row composer is one colour (textarea transparent, field painted like the textarea)`, () => {
    for (const shell of ['desktop', 'phone']) {
      const before = paint(dir, skin, '.ch-compose .ch-field > textarea', shell);
      const field = paint(dir, skin, '.ch-compose .ch-field.lab-row', shell);
      assert.ok(before && before !== 'transparent', `${shell}: the skin paints its textarea (${before})`);
      assert.equal(field, before, `${shell}: the label-row field wears the textarea's paint`);
      assert.equal(paint(dir, skin, '.ch-compose .ch-field.lab-row > textarea', shell), 'transparent', `${shell}: one colour, no second box`);
    }
  });

test('obsidian: the model label never wears the skin button fill', () => {
  for (const shell of ['desktop', 'phone']) {
    assert.equal(paint('obsidian', 'obsidian', '.ch-compose .ch-field > button.ch-mlabel', shell), 'transparent', shell);
    assert.equal(paint('obsidian', 'obsidian', '.ch-compose .ch-field.lab-row > button.ch-mlabel', shell), 'transparent', shell + ' label row');
  }
});
