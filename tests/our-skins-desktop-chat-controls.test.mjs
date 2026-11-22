// Miguel's skins (Dark, Light, Landscapes) on desktop: the + New chat button, the voice disc by the composer and the
// chat accents (sort chip, selected row, composer, top-bar tile) follow the skin instead of core violet. Before this,
// Landscapes showed a glowing violet + tile and all three skins drew the voice button as a glossy violet-tinted sphere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { colours, linkOrder, onSkin } from './fixtures/w5-css.mjs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const obsidian = read('web/skins/obsidian/skin.css');
const landscapes = read('web/skins/landscapes/skin.css');
const rule = (css, sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
};
const VIOLET = /var\(--violet|143,\s*99,\s*255|122,\s*77,\s*255|185,\s*155,\s*255|#7a4dff|#c04dff/;
const O = 'html[data-skin^="obsidian"][data-shell="desktop"]';
const L = 'html[data-skin^="landscapes"][data-shell="desktop"]';

// The real cascade on the desktop (desktop.html's own sheets in its order, then the skin package) over a skeleton of
// each element (tests/fixtures/w5-css.mjs).
const order = linkOrder(read('web/desktop.html'));
const CORE = ['core/skins.css', 'core/chats.css', 'desktop/desktop.css'].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(f => read('web/' + f));
const sheetsFor = skin => [...CORE, skin.startsWith('landscapes') ? landscapes : obsidian];
const on = (skin, sel) => onSkin(sheetsFor(skin), sel, { skin, shell: 'desktop' });
const tint = (skin, sel) => colours(sheetsFor(skin), sel, { skin, shell: 'desktop' });

test('the desktop voice button is a flat disc in skin colours with the mic visible', () => {
  for (const [skin, fill] of [['obsidian', /var\(--ob-tint\)/], ['obsidian-light', /var\(--ob-tint\)/], ['landscapes', /rgba\(255, 255, 255/]]) {
    const disc = on(skin, '.dchats .ch-compose button.ch-mic');
    assert.match(disc.background || '', fill, `${skin}: the skin's own fill`);
    assert.doesNotMatch(disc.background || '', /radial-gradient/, 'no glossy sphere');
    assert.doesNotMatch(tint(skin, '.dchats .ch-compose button.ch-mic'), VIOLET);
    assert.equal(on(skin, '.dchats .ch-compose button.ch-mic svg').opacity, '1', 'mic icon shows');
  }
});

test('the desktop + New chat button is a round skin button with no glow', () => {
  const o = on('obsidian', '.dchats .ch-fab');
  assert.equal(o['border-radius'], '50%'); assert.equal(o.background, 'var(--ob-fill)'); assert.equal(o['box-shadow'], 'none');
  const l = on('landscapes', '.dchats .ch-fab');
  assert.equal(l['border-radius'], '50%'); assert.match(l.background || '', /^rgba\(255, 255, 255/);
  assert.doesNotMatch(tint('landscapes', '.dchats .ch-fab'), VIOLET); assert.doesNotMatch(l['box-shadow'] || '', /0 10px 26px/, 'no coloured drop glow');
});

test('Landscapes desktop accents are frosted white, not core violet', () => {
  for (const sel of ['.ch-rdy-bar button.on', '.dchats .ch-row.cur', '.ws.cur', '.ch-compose textarea', '.ch-compose textarea:focus', '.msg.u .bub', '.win.focus', '.ch-row.unread .tp time', '.st.unread']) {
    const c = tint('landscapes', sel);
    assert.doesNotMatch(c, VIOLET, `${sel} has no violet`);
    // Owner bubbles use the opaque owner token, which Landscapes sets from its white ink (James, 8 Nov 2026).
    assert.match(c, /rgba\(255, 255, 255|#fff|rgba\(0, 0, 0|var\(--wz-owner-message\)/, `${sel} uses white glass or ink`);
  }
});

test('the private Kimi K3 slot keeps its purple', () => {
  for (const skin of ['landscapes', 'landscapes-light']) assert.equal(on(skin, '.ms-o.secure').color, 'var(--secure)', skin);
});
