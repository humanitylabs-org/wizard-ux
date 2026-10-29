// Miguel's skins (Dark, Light, Landscapes) on desktop: the + New chat button, the voice disc by the composer and the
// chat accents (sort chip, selected row, composer, top-bar tile) follow the skin instead of core violet. Before this,
// Landscapes showed a glowing violet + tile and all three skins drew the voice button as a glossy violet-tinted sphere.
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
const VIOLET = /var\(--violet|143,\s*99,\s*255|122,\s*77,\s*255|185,\s*155,\s*255|#7a4dff|#c04dff/;
const O = 'html[data-skin^="obsidian"][data-shell="desktop"]';
const L = 'html[data-skin^="landscapes"][data-shell="desktop"]';

test('the desktop voice button is a flat disc in skin colours with the mic visible', () => {
  for (const [css, p, fill] of [[obsidian, O, /var\(--ob-tint\)/], [landscapes, L, /rgba\(255, 255, 255/]]) {
    const disc = rule(css, `${p} .ch-compose button.ch-mic:not(.on)`);
    assert.ok(disc, `${p} styles the voice disc`);
    assert.match(disc, fill);
    assert.doesNotMatch(disc, /radial-gradient/, 'no glossy sphere');
    assert.doesNotMatch(disc, VIOLET);
    assert.match(rule(css, `${p} .ch-compose button.ch-mic:not(.on) svg`) || '', /opacity:\s*1/, 'mic icon shows');
  }
});

test('the desktop + New chat button is a round skin button with no glow', () => {
  const o = rule(obsidian, `${O} .dchats .ch-fab`) || '';
  assert.match(o, /border-radius:\s*50%/);
  assert.match(o, /background:\s*var\(--ob-fill\)/);
  assert.match(o, /box-shadow:\s*none/);
  const l = rule(landscapes, `${L} .dchats .ch-fab`) || '';
  assert.match(l, /border-radius:\s*50%/);
  assert.match(l, /background:\s*rgba\(255, 255, 255/);
  assert.doesNotMatch(l, VIOLET);
  assert.doesNotMatch(l, /0 10px 26px/, 'no coloured drop glow');
});

test('Landscapes desktop accents are frosted white, not core violet', () => {
  for (const sel of ['.ch-rdy-bar button.on', '.dchats .ch-row.cur', '.ws.cur', '.ch-compose textarea', '.ch-compose textarea:focus', '.msg.u .bub', '.win.focus', '.ch-row.unread .tp time', '.st.unread']) {
    const r = rule(landscapes, `${L} ${sel}`);
    assert.ok(r, `Landscapes styles ${sel}`);
    assert.doesNotMatch(r, VIOLET, `${sel} has no violet`);
    assert.match(r, /rgba\(255, 255, 255|#fff|rgba\(0, 0, 0/, `${sel} uses white glass or ink`);
  }
});

test('the private Kimi K3 slot keeps its purple', () => {
  assert.match(landscapes, /html\[data-skin\^="landscapes"\] \.ms-o\.secure \{ color: var\(--secure\); \}/);
});
