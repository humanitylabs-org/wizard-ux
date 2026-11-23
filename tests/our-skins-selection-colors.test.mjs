// Miguel's skins (Dark, Light, Landscapes) repaint core's violet text selection and selection menu
// (core/sel-menu.css) in their own palette. Before this, Light showed black ink on the dark violet menu and
// white text on a lavender highlight, and its New chat hat went grey under the skin-wide sigil dimmer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createDocument } from './fixtures/mini-dom.mjs';
import { onSkin } from './fixtures/w5-css.mjs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const obsidian = read('web/skins/obsidian/skin.css');
const landscapes = read('web/skins/landscapes/skin.css');
const rule = (css, sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
};

// The real cascade (core sheets, then the skin package) on a skeleton of each element, on both shells.
const CORE = ['web/core/sel-menu.css', 'web/styles.css', 'web/core/chats.css', 'web/core/skins.css'].map(read);
const sheetsFor = skin => [...CORE, skin.startsWith('landscapes') ? landscapes : obsidian];
const on = (skin, sel, shell = 'phone') => onSkin(sheetsFor(skin), sel, { skin, shell });
const SHELLS = ['phone', 'desktop'];

test('each of Miguel\'s skins paints its own selection highlight with readable text', () => {
  for (const [skin, colour] of [['obsidian', '#fff'], ['obsidian-light', '#000'], ['landscapes', '#fff'], ['landscapes-light', '#000']]) for (const shell of SHELLS) {
    const sel = on(skin, '.ch-msgs p::selection', shell), core = onSkin(CORE, '.ch-msgs p::selection', { skin, shell });
    assert.equal(sel.color, colour, `${skin} ${shell}: selection text is ${colour}`);
    assert.ok(sel.background || sel['background-color'], `${skin} sets its own highlight`);
    assert.doesNotMatch(sel.background || sel['background-color'], /143,\s*99,\s*255/, `${skin} highlight is not core violet`);
    assert.notDeepEqual(sel, core, 'the skin package does it');
  }
});

test('the selection menu uses skin ink on a skin surface, not core violet', () => {
  for (const shell of SHELLS) {
    assert.match(on('obsidian', '.selmenu', shell).background || '', /^color-mix\(in srgb, var\(--bg\)/);
    assert.equal(on('obsidian', '.selmenu button', shell).color, 'var(--ink)');
    assert.equal(on('obsidian', '.selmenu button svg', shell).stroke, 'var(--ink)');
    assert.match(on('landscapes', '.selmenu', shell).background || '', /^rgba\(16, 18, 22/);
    assert.equal(on('landscapes', '.selmenu button svg', shell).stroke, '#fff');
  }
  // the menu the real sel-menu.js builds carries that class
  const src = read('web/core/sel-menu.js'), at = src.indexOf("el = document.createElement('div'); el.className = 'selmenu';");
  const doc = createDocument();
  const el = vm.runInNewContext(`let el; ${src.slice(at, src.indexOf('\n', at))}; el`, { document: doc });
  assert.ok(el.matches('.selmenu') && el.getAttribute('role') === 'menu');
});

test('Light keeps the New chat hat crisp white; Landscapes uses glass instead of the violet tile', () => {
  for (const shell of SHELLS) {
    assert.equal(on('obsidian-light', '.ch-newchat .nc-mark .sgi', shell).filter, 'none');
    assert.match(on('landscapes', '.ch-newchat .nc-mark', shell).background || '', /^rgba\(255, 255, 255/);
  }
});
