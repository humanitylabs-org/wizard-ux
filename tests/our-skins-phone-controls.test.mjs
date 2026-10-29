// Miguel's skins (Dark, Light, Landscapes) on the phone: the long-press and model menus clear the pill dock, sheets and
// the count badge follow the skin, and Landscapes' phone controls use the same frosted white glass as its desktop
// (before this the + New chat button, send button, sent bubbles, sort chip, model menu and orb were core violet).
// Every rule is phone-only (:not([data-shell="desktop"])), so desktop stays as it is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const obsidian = read('web/skins/obsidian/skin.css');
const landscapes = read('web/skins/landscapes/skin.css');
const rule = (css, sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The last rule for a selector wins, like the cascade (older size-only rules can share a selector).
  const all = [...css.matchAll(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`, 'g'))];
  return all.length ? all[all.length - 1][1] : null;
};
const VIOLET = /var\(--violet|143,\s*99,\s*255|122,\s*77,\s*255|185,\s*155,\s*255|160,\s*140,\s*255|205,\s*190,\s*255|#7a4dff|#c04dff|#C9BEFF/i;
const O = 'html[data-skin^="obsidian"]:not([data-shell="desktop"])';
const L = 'html[data-skin^="landscapes"]:not([data-shell="desktop"])';
const SOLO = '.device:not(.orb-corner) .tiles:not(.has-full) .win.solo.app-chats';

test('the long-press and model menus end above the pill dock on all three skins', () => {
  for (const [css, p] of [[obsidian, O], [landscapes, L]]) {
    const r = rule(css, `${p} ${SOLO} .ch-sheet-b`);
    assert.ok(r, `${p} pads the chat sheets`);
    assert.match(r, /padding-bottom:\s*calc\(var\(--pill-top\)/);
    // A thread in many Spaces gets one action per Space: the padded sheet must scroll, never clip its top actions.
    const sc = rule(css, `${p} ${SOLO} .ch-sheet-b:not(.ch-emoji-sheet)`) || '';
    assert.match(sc, /max-height:\s*calc\(100% - /);
    assert.match(sc, /overflow-y:\s*auto/);
  }
});

test('phone sheets, menu rows and the count badge follow the skin (no violet edge, no glow)', () => {
  for (const [css, p] of [[obsidian, O], [landscapes, L]]) {
    for (const sel of ['.sheet', '.ch-latest', '.ch-sheet-b button:focus-visible', '.ch-sheet-b button:active', '.ch-emoji-search:focus-within']) {
      const r = rule(css, `${p} ${sel}`);
      assert.ok(r, `${p} styles ${sel}`);
      assert.doesNotMatch(r, VIOLET, `${sel} has no violet`);
    }
    assert.match(rule(css, `${p} .ch-sheet-b button:focus-visible`), /outline:\s*none/, 'no heavy focus ring on the first action');
    const badge = rule(css, `${p} .dock .orb-badge`) || '';
    assert.match(badge, /box-shadow:\s*0 0 0 2px var\(--bg\)/, 'badge ring in the pill colour, no amber glow');
  }
  for (const [css, p] of [[obsidian, O], [landscapes, L]]) {
    const mic = rule(css, `${p} .ch-compose button.ch-mic.on`) || '';
    assert.match(mic, /animation:\s*none/, 'core pink recording pulse is off (an animated box-shadow beats a plain one)');
    assert.doesNotMatch(mic, /255, 77, 109|VIOLET/);
  }
  assert.match(rule(obsidian, 'html[data-skin="obsidian-light"]:not([data-shell="desktop"]) .dock .orb-badge') || '', /color:\s*#fff/, 'Light badge number readable');
});

test('Landscapes phone controls are frosted white glass, not core violet', () => {
  const fab = rule(landscapes, `${L} .ch-fab`) || '';
  assert.match(fab, /background:\s*rgba\(255, 255, 255/);
  assert.match(fab, /box-shadow:\s*inset/, 'no coloured drop glow');
  assert.match(rule(landscapes, `${L} .ch-compose button:is(.ch-send, .ch-mic.on)`) || '', /background:\s*#fff/);
  for (const sel of ['.ch-fab', '.ch-rdy-bar button.on', '.msg.u .bub', '.ch-row.unread .tp time', '.st.unread', '.mrow.on', '.mrow .mck', '.mrow.more', '.wx-spin', ':is(.ch-row, .ch-head) .emo.sti.deferred', '.ch-row .pv em.att.deferred', '.ch-latest', '.dock .ddot.dhome .dsg .sgi', '.ch-compose textarea:focus']) {
    const r = rule(landscapes, `${L} ${sel}`);
    assert.ok(r, `Landscapes phone styles ${sel}`);
    assert.doesNotMatch(r, VIOLET, `${sel} has no violet`);
    assert.match(r, /rgba\(255, 255, 255|#fff/, `${sel} uses white glass or ink`);
  }
  assert.equal(rule(landscapes, `${L} .dock :is(.orb, .orb-fallback)`), null, 'the orb keeps its Wizard violet (Miguel, 27 Oct 2026)');
});

test('phone polish never reaches desktop and keeps the private purple', () => {
  for (const css of [obsidian, landscapes]) {
    const from = css.indexOf('/* Phone polish (Miguel 27 Oct'), to = css.indexOf('/* Landscapes Light (', from);
    const block = css.slice(from, to > 0 ? to : undefined);
    assert.ok(block.length > 100, 'phone polish block present');
    for (const line of block.split('\n').filter(l => l.startsWith('html'))) assert.match(line, /:not\(\[data-shell="desktop"\]\)/, line);
    assert.doesNotMatch(block, /\.ms-o\.secure|--secure/, 'private model colour untouched');
  }
  assert.match(landscapes, /html\[data-skin\^="landscapes"\] \.ms-o\.secure \{ color: var\(--secure\); \}/);
});

test('Mizel skins keep the violet orb on Dark, Light and Landscapes', () => {
  const skins = readFileSync(new URL('../web/core/skins.js', import.meta.url), 'utf8');
  for (const id of ['obsidian', 'obsidian-light', 'landscapes']) {
    const m = skins.match(new RegExp(`id: '${id}'[^\\n]*orb: \\[([^\\]]+)\\]`));
    assert.ok(m, `${id} has an orb filter`);
    const [hue, sat] = m[1].split(',').map(Number);
    assert.equal(hue, 0, `${id} orb keeps the Wizard hue`);
    assert.ok(sat >= 1, `${id} orb is coloured, not grey`);
  }
});
