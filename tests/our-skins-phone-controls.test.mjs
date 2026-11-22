// Miguel's skins (Dark, Light, Landscapes) on the phone: sheets and the count badge follow the skin, and Landscapes' phone controls use the same frosted white glass as its desktop
// (before this the + New chat button, send button, sent bubbles, sort chip, model menu and orb were core violet).
// Every rule is phone-only (:not([data-shell="desktop"])), so desktop stays as it is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade, parseCss } from './fixtures/mini-css.mjs';
import { onSkin, parsed, skeleton, styles } from './fixtures/w5-css.mjs';
import { skinsRuntime } from './fixtures/skin-palettes-harness.mjs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const obsidian = read('web/skins/obsidian/skin.css');
const landscapes = read('web/skins/landscapes/skin.css');
const rule = (css, sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The last rule for a selector wins, like the cascade (older size-only rules can share a selector).
  const all = [...css.matchAll(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`, 'g'))];
  return all.length ? all.map(m => m[1]).join(' ') : null;
};
const VIOLET = /var\(--violet|143,\s*99,\s*255|122,\s*77,\s*255|185,\s*155,\s*255|160,\s*140,\s*255|205,\s*190,\s*255|#7a4dff|#c04dff|#C9BEFF/i;
const O = 'html[data-skin^="obsidian"]:not([data-shell="desktop"])';
const L = 'html[data-skin^="landscapes"]:not([data-shell="desktop"])';
const SOLO = '.device:not(.orb-corner) .tiles:not(.has-full) .win.solo.app-chats';

// The real cascade (the shell's own CSS, core skins, then the skin package, in page order) on a skeleton of each
// element, as the phone or desktop shell wears the skin (tests/fixtures/w5-css.mjs).
const CORE = ['web/styles.css', 'web/core/chats.css', 'web/core/skins.css'].map(read);
const sheetsFor = skin => [...CORE, skin.startsWith('landscapes') ? landscapes : obsidian];
const on = (skin, sel, shell = 'phone') => onSkin(sheetsFor(skin), sel, { skin, shell });
// The colours that reach the element: a shorthand's colour counts only when no later or stronger longhand replaced it.
const COLOURS = ['color', 'background', 'background-color', 'border', 'border-color', 'box-shadow', 'outline', 'outline-color', '--c'];
const LONG = { border: 'border-color', background: 'background-color', outline: 'outline-color' };
const rank = d => d ? d.rank[0] * 1e12 + d.rank[1] * 1e4 + d.rank[2] : -1;
function colours(skin, sel, shell = 'phone') {
  const doc = createDocument(); doc.documentElement.setAttribute('data-skin', skin); doc.documentElement.setAttribute('data-shell', shell);
  const k = skeleton(doc, sel), won = cascade(k.el, parsed(sheetsFor(skin)), { states: k.states });
  return COLOURS.filter(p => won[p] && !(LONG[p] && rank(won[LONG[p]]) > rank(won[p]))).map(p => won[p].value).join(' ; ');
}

test('phone sheets, menu rows and the count badge follow the skin (no violet edge, no glow)', () => {
  for (const skin of ['obsidian', 'landscapes']) {
    for (const sel of ['.sheet', '.ch-latest', '.ch-sheet-b button:focus-visible', '.ch-sheet-b button:active', '.ch-emoji-search:focus-within'])
      assert.doesNotMatch(colours(skin, sel), VIOLET, `${skin} ${sel} has no violet`);
    assert.match(on(skin, '.ch-sheet-b button:focus-visible').outline || '', /^none/, 'no heavy focus ring on the first action');
    assert.match(on(skin, '.dock .orb-badge')['box-shadow'] || '', /^0 0 0 2px var\(--bg\)/, 'badge ring in the pill colour, no amber glow');
    assert.match(on(skin, '.ch-compose button.ch-mic.on').animation || '', /^none/, 'core pink recording pulse is off (an animated box-shadow beats a plain one)');
    const mic = colours(skin, '.ch-compose button.ch-mic.on'); assert.doesNotMatch(mic, /255, 77, 109/); assert.doesNotMatch(mic, VIOLET);
  }
  assert.match(on('obsidian-light', '.dock .orb-badge').color || '', /^#fff/, 'Light badge number readable');
});

test('Landscapes phone controls are frosted white glass, not core violet', () => {
  const fab = on('landscapes', '.ch-fab');
  assert.match(fab.background || '', /^rgba\(255, 255, 255/); assert.match(fab['box-shadow'] || '', /^inset/, 'no coloured drop glow');
  assert.match(on('landscapes', '.ch-compose button.ch-send').background || '', /^#fff/); assert.match(on('landscapes', '.ch-compose button.ch-mic.on').background || '', /^#fff/);
  for (const sel of ['.ch-fab', '.ch-rdy-bar button.on', '.msg.u .bub', '.ch-row.unread .tp time', '.st.unread', '.mrow.on', '.mrow .mck', '.mrow.more', '.wx-spin', '.ch-row .emo.sti.deferred', '.ch-head .emo.sti.deferred', '.ch-row .pv em.att.deferred', '.ch-latest', '.dock .ddot.dhome .dsg .sgi', '.ch-compose textarea:focus']) {
    const c = colours('landscapes', sel);
    assert.doesNotMatch(c, VIOLET, `${sel} has no violet`);
    assert.match(c, /rgba\(255, 255, 255|#fff|var\(--wz-owner-message\)/, `${sel} uses white glass or ink`);
  }
  // the owner token on the page root: white ink glass, not violet
  const doc = createDocument(); doc.documentElement.setAttribute('data-skin', 'landscapes'); doc.documentElement.setAttribute('data-shell', 'phone');
  assert.match(styles(doc.documentElement, sheetsFor('landscapes'))['--wz-owner-message'] || '', /^color-mix\(in srgb, var\(--ink\) /, 'owner token is white ink glass, not violet');
  // the orb keeps its Wizard violet (Miguel, 27 Oct 2026): the skin changes nothing on it
  for (const sel of ['.dock .orb', '.dock .orb-fallback']) assert.deepEqual(on('landscapes', sel), onSkin(CORE, sel, { skin: 'landscapes', shell: 'phone' }), sel);
});

test('phone polish never reaches desktop and keeps the private purple', () => {
  for (const [css, skin] of [[obsidian, 'obsidian'], [landscapes, 'landscapes']]) {
    const from = css.indexOf('/* Phone polish (Miguel 27 Oct'), to = css.indexOf('/* Landscapes Light (', from);
    const block = css.slice(from, to > 0 ? to : undefined);
    const rules = parseCss(block).filter(r => r.selector.startsWith('html'));
    assert.ok(rules.length > 5, 'phone polish block present');
    // every rule of the block, on a skeleton of what it styles: it applies on the phone and never on the desktop
    for (const r of rules) for (const sel of r.selectors) {
      const m = /^html((?:\[[^\]]*\]|:not\((?:[^()]|\([^()]*\))*\)|:is\((?:[^()]|\([^()]*\))*\)|:root)*)\s*(.*)$/.exec(sel); assert.ok(m, sel);
      const light = /data-skin="([\w-]+)"/.exec(m[1])?.[1] || skin, rest = m[2] || '';
      if (!rest || /::/.test(rest)) continue;
      const one = shell => { const doc = createDocument(); doc.documentElement.setAttribute('data-skin', light); doc.documentElement.setAttribute('data-shell', shell); const k = skeleton(doc, rest); return styles(k.el, block, { states: k.states }); };
      assert.ok(Object.keys(one('phone')).length, `applies on the phone: ${sel}`);
      assert.deepEqual(one('desktop'), {}, `never on the desktop: ${sel}`);
    }
    assert.doesNotMatch(block, /\.ms-o\.secure|--secure/, 'private model colour untouched');
  }
  for (const shell of ['phone', 'desktop']) assert.equal(on('landscapes', '.ms-o.secure', shell).color, 'var(--secure)', `${shell}: the private purple`);
});

test('Mizel skins keep the violet orb on Dark, Light and Landscapes', () => {
  // the real core/skins.js sets the orb filter for the skin it wears
  const { S, documentElement } = skinsRuntime(), props = new Map();
  documentElement.style.setProperty = (k, v) => props.set(k, v); documentElement.style.removeProperty = k => props.delete(k);
  for (const id of ['obsidian', 'obsidian-light', 'landscapes']) {
    S.set(id); const m = /^hue-rotate\(([-\d.]+)deg\) saturate\(([\d.]+)\)/.exec(props.get('--sk-orb') || '');
    assert.ok(m, `${id} has an orb filter`);
    assert.equal(+m[1], 0, `${id} orb keeps the Wizard hue`);
    assert.ok(+m[2] >= 1, `${id} orb is coloured, not grey`);
  }
});
