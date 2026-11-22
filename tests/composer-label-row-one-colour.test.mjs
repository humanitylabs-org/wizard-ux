// Miguel's skins (Dark, Light, Landscapes, Landscapes Light): once a draft wraps, core moves the model label under the
// text (.ch-field.lab-row) and paints the FIELD, keeping the textarea transparent. These skins paint the textarea
// itself with a more specific rule, so the strip under the text showed a second colour behind "Opus" (Miguel, 2 Nov
// 2026). Each skin must hand the textarea's paint to the field in that state, and keep its button fill off the label.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onSkin } from './fixtures/w5-css.mjs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const rule = (css, sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const all = [...css.matchAll(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`, 'g'))];
  return all.length ? all[all.length - 1][1] : null;
};
const bg = body => (body?.match(/background:\s*([^;]+);/) || [])[1]?.trim();

for (const [dir, pre] of [['obsidian', 'html[data-skin^="obsidian"]'], ['landscapes', 'html[data-skin^="landscapes"]']]) {
  const css = read(`web/skins/${dir}/skin.css`);
  test(`${dir}: label-row composer is one colour (textarea transparent, field painted like the textarea)`, () => {
    assert.equal(bg(rule(css, `${pre} .ch-compose .ch-field.lab-row > textarea`)), 'transparent');
    for (const shell of ['[data-shell="desktop"]', ':not([data-shell="desktop"])']) {
      const field = bg(rule(css, `${pre}${shell} .ch-compose .ch-field.lab-row`));
      const ta = bg(rule(css, `${pre}${shell} .ch-compose textarea`));
      assert.ok(ta, `${dir} ${shell}: skin paints the textarea`);
      assert.equal(field, ta, `${dir} ${shell}: field carries the textarea's paint`);
    }
  });
}

// The real cascade (core chat-power.css, then the skin) on a skeleton of the composer markup chats.js draws: once
// core's chats-fitlabel.js marks the field .lab-row, the field carries the paint the textarea had before.
const SHEETS = skin => [read('web/core/chat-power.css'), read(`web/skins/${skin}/skin.css`)];
const paint = (skin, name, selector, shell) => {
  const won = onSkin(SHEETS(skin), selector, { skin: name, shell });
  return won.background ?? won['background-color'] ?? '';
};
test('landscapes-light: label-row field matches its light textarea', () => {
  for (const shell of ['desktop', 'phone']) {
    const before = paint('landscapes', 'landscapes-light', '.ch-compose .ch-field > textarea', shell);
    const field = paint('landscapes', 'landscapes-light', '.ch-compose .ch-field.lab-row', shell);
    assert.ok(before && before !== 'transparent', `${shell}: the skin paints its textarea (${before})`);
    assert.equal(field, before, `${shell}: the label-row field wears the textarea's paint`);
    assert.equal(paint('landscapes', 'landscapes-light', '.ch-compose .ch-field.lab-row > textarea', shell), 'transparent', `${shell}: one colour, no second box`);
  }
});

test('obsidian: the model label never wears the skin button fill', () => {
  for (const shell of ['desktop', 'phone']) {
    assert.equal(paint('obsidian', 'obsidian', '.ch-compose .ch-field > button.ch-mlabel', shell), 'transparent', shell);
    assert.equal(paint('obsidian', 'obsidian', '.ch-compose .ch-field.lab-row > button.ch-mlabel', shell), 'transparent', shell + ' label row');
  }
});
