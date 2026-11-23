// A take's controls (phone dock Cancel / Pause / Screenshot / Attach, the desktop recording pill) follow the skin:
// on a light skin they were black icons on fixed navy discs. Nebula keeps its original navy.
// The real markup (web/index.html voice layer, web/desktop.html recording pill) through the real stylesheets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { between } from './fixtures/source-slice.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const skins = read('web/core/skins.css'), styles = read('web/styles.css'), desktop = read('web/desktop/desktop.css');
const voiceLayer = between(read('web/index.html'), '<div id="voice" class="voice"', '<!-- Dock -->');
const pill = between(read('web/desktop.html'), '<div id="voicePill"', '<div class="bar-r"');
const LITERAL = /#[0-9a-f]{3,8}\b|rgba?\(/i;
function phone(skin, { paused = false } = {}) {
  const doc = createDocument(); doc.documentElement.setAttribute('data-skin', skin);
  doc.body.innerHTML = `<div id="device" class="device"${paused ? ' data-voice="paused"' : ''}>${voiceLayer}</div>`;
  doc.getElementById('arcAttach').insertAdjacentHTML('beforeend', '<b class="arc-count">2</b>'); // the attach count the take adds
  return doc;
}
function desk(skin) {
  const doc = createDocument(); doc.documentElement.setAttribute('data-skin', skin); doc.documentElement.setAttribute('data-shell', 'desktop');
  doc.body.innerHTML = `<div class="bar-c">${pill}</div>`;
  return doc;
}
// one stylesheet text in load order: mini-css restarts source order per sheet in an array
const look = (el, sheets, opts) => { const c = cascade(el, [].concat(sheets).join('\n'), opts); return { background: c.background?.value, color: c.color?.value, 'border-color': c['border-color']?.value, from: c.background?.selector }; };

test('the phone dock voice discs use the skin panel and ink on every skin but Nebula, out-ranking the navy dock rule', () => {
  const sheets = [styles, skins];
  // Nebula: the stock navy dock rule this overrides
  assert.equal(look(phone('nebula').getElementById('arcPause'), sheets).background, 'rgba(25, 15, 49, .9)', 'Nebula keeps the navy disc');
  for (const skin of ['sepia', 'grove', 'obsidian-light', 'landscapes']) {
    const doc = phone(skin);
    for (const id of ['arcCancel', 'arcPause', 'arcScreen', 'arcAttach']) {
      const d = look(doc.getElementById(id), sheets);
      assert.match(d.background, /^linear-gradient\(var\(--sk-tour\), var\(--sk-tour\)\), var\(--wz-panel/, `${skin} ${id}: skin panel over the opaque panel material`);
      assert.equal(d['border-color'], 'var(--line-2)', `${skin} ${id}`);
      assert.match(d.color, /^var\(--(ink|red)\b/, `${skin} ${id}: skin ink`);
    }
    const count = look(doc.querySelector('.arc-count'), sheets);
    assert.equal(count.color, 'var(--bg)', `${skin}: the attach count reads on the accent`);
    assert.equal(count.background, 'var(--violet-2)', skin);
  }
  // Both defaults stay below html[data-skin] .arc, so My skin can override fill and state colours.
  const mine = 'html[data-skin] .arc { background: var(--my-fill); }';
  assert.equal(look(phone('mine').getElementById('arcCancel'), [...sheets, mine]).background, 'var(--my-fill)');
});

// Issue 1740: skins.css's shared `:where(...) :is(..., .scrub .sc-label, ...)` panel rule has the specificity of its
// most specific argument (0,2,0); while it listed `.arc` it out-ranked the (0,1,0) Cancel red rule below it. The
// stock paused rules in styles.css (0,3,0)/(0,5,0) out-ranked the skin's paused amber; they now sit in :where().
test('the phone take discs: Cancel reads as the skin red and a paused Pause as amber', () => {
  const sheets = [styles, skins];
  assert.equal(look(phone('sepia').getElementById('arcCancel'), sheets).color, 'var(--red, var(--ink))');
  for (const skin of ['sepia', 'grove', 'obsidian-light']) {
    assert.equal(look(phone(skin).getElementById('arcCancel'), sheets).color, 'var(--red, var(--ink))', `${skin}: Cancel is red`);
    const p = look(phone(skin, { paused: true }).getElementById('arcPause'), sheets);
    assert.equal(p.color, 'var(--amber)', `${skin}: paused Pause is amber`);
    assert.match(p.background, /^color-mix\(in srgb, var\(--amber\) 18%, var\(--wz-panel/, `${skin}: the skin amber over the opaque skin panel`);
  }
  // Nebula keeps its stock amber tint, and a paused Pause stays amber.
  const neb = look(phone('nebula', { paused: true }).getElementById('arcPause'), sheets);
  assert.equal(neb.background, 'rgba(255,190,85,.18)'); assert.equal(neb.color, 'var(--amber)');
});

test('the desktop recording pill and its tray use the skin panel and ink on every skin but Nebula', () => {
  const sheets = [desktop, skins];
  assert.match(look(desk('nebula').getElementById('voicePill'), sheets).background, /^linear-gradient\(rgba\(16, 10, 30, \.82\)/, 'Nebula keeps the navy pill');
  for (const skin of ['sepia', 'grove', 'obsidian-light']) {
    const doc = desk(skin);
    for (const sel of ['#voicePill', '#voicePill .voice-tray']) {
      const d = look(doc.querySelector(sel), sheets);
      assert.match(d.background, /var\(--sk-tour\)/, `${skin} ${sel}`); assert.equal(d.color, 'var(--ink)', `${skin} ${sel}`);
    }
    for (const sel of ['#voicePill .lvl', '#voiceCancel', '#voicePill .voice-extras button']) {
      const el = doc.querySelector(sel); assert.ok(el, sel);
      const d = look(el, sheets);
      assert.match(d.from, /nebula/, `${skin} ${sel}: the skin rule wins`);
      assert.doesNotMatch(d.background, LITERAL, `${skin} ${sel}: tokens only`);
      if (d.color) assert.doesNotMatch(d.color, LITERAL, `${skin} ${sel}: tokens only`);
    }
  }
});
