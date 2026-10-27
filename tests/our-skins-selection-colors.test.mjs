// Miguel's skins (Dark, Light, Landscapes) repaint core's violet text selection and selection menu
// (core/sel-menu.css) in their own palette. Before this, Light showed black ink on the dark violet menu and
// white text on a lavender highlight, and its New chat hat went grey under the skin-wide sigil dimmer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const obsidian = read('web/skins/obsidian/skin.css');
const landscapes = read('web/skins/landscapes/skin.css');
const rule = (css, sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
};

test('each of Miguel\'s skins paints its own selection highlight with readable text', () => {
  for (const [css, skin, colour] of [[obsidian, 'obsidian', '#fff'], [obsidian, 'obsidian-light', '#000'], [landscapes, 'landscapes', '#fff']]) {
    const r = rule(css, `html[data-skin="${skin}"] ::selection`);
    assert.ok(r, `${skin} sets ::selection`);
    assert.match(r, new RegExp(`color:\\s*${colour}`), `${skin} selection text is ${colour}`);
    assert.doesNotMatch(r, /143,\s*99,\s*255/, `${skin} highlight is not core violet`);
  }
});

test('the selection menu uses skin ink on a skin surface, not core violet', () => {
  assert.match(rule(obsidian, 'html[data-skin^="obsidian"] .selmenu') || '', /background:\s*color-mix\(in srgb, var\(--bg\)/);
  assert.match(rule(obsidian, 'html[data-skin^="obsidian"] .selmenu button') || '', /color:\s*var\(--ink\)/);
  assert.match(rule(obsidian, 'html[data-skin^="obsidian"] .selmenu svg') || '', /stroke:\s*var\(--ink\)/);
  assert.match(rule(landscapes, 'html[data-skin="landscapes"] .selmenu') || '', /background:\s*rgba\(16, 18, 22/);
  assert.match(rule(landscapes, 'html[data-skin="landscapes"] .selmenu svg') || '', /stroke:\s*#fff/);
});

test('Light keeps the New chat hat crisp white; Landscapes uses glass instead of the violet tile', () => {
  assert.match(rule(obsidian, 'html[data-skin="obsidian-light"] .ch-newchat .nc-mark .sgi') || '', /filter:\s*none/);
  assert.match(rule(landscapes, 'html[data-skin="landscapes"] .ch-newchat .nc-mark') || '', /background:\s*rgba\(255, 255, 255/);
});
