// Miguel's skins (Dark, Light, Landscapes, Landscapes Light): once a draft wraps, core moves the model label under the
// text (.ch-field.lab-row) and paints the FIELD, keeping the textarea transparent. These skins paint the textarea
// itself with a more specific rule, so the strip under the text showed a second colour behind "Opus" (Miguel, 2 Nov
// 2026). Each skin must hand the textarea's paint to the field in that state, and keep its button fill off the label.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

test('landscapes-light: label-row field matches its light textarea', () => {
  const css = read('web/skins/landscapes/skin.css');
  const L = 'html[data-skin="landscapes-light"]:is([data-shell="desktop"], :not([data-shell="desktop"]))';
  assert.equal(bg(rule(css, `${L} .ch-compose .ch-field.lab-row`)), bg(rule(css, `${L} .ch-compose textarea`)));
});

test('obsidian: the model label never wears the skin button fill', () => {
  const css = read('web/skins/obsidian/skin.css');
  assert.equal(bg(rule(css, 'html[data-skin^="obsidian"] .ch-compose .ch-field > button.ch-mlabel')), 'transparent');
});
