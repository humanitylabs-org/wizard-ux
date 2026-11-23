// Miguel, 28 Oct 2026: Landscapes split into Landscapes Dark (night and dusk photos, dark glass) and Landscapes Light
// (day photos, light glass). The dark one keeps the 'landscapes' id so a saved choice carries over.
// The real skins.js runs in a bare page, its photo rotation runs as shipped, and the skin's CSS is read through the
// cascade on the elements it styles (tests/fixtures/mini-css.mjs; wizard-ux issue 1674: tests run the code).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { block, runRecording } from './fixtures/source-slice.mjs';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const js = read('web/core/skins.js');
const skinCss = read('web/skins/landscapes/skin.css');

function skins() {
  const el = () => ({ style: { setProperty() {}, removeProperty() {} }, setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, appendChild() {}, remove() {}, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, dataset: {} });
  const document = { documentElement: el(), head: el(), body: el(), createElement: el, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {} };
  const ctx = { document, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, addEventListener() {}, dispatchEvent() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    CustomEvent: class {}, Event: class {}, location: { search: '' }, URLSearchParams, setTimeout, clearTimeout, requestAnimationFrame: () => 0, console };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(js, ctx);
  return ctx.WosSkin;
}
// the real LANDSCAPES rotation (its own IIFE), with a store and a clock
function landscapes(store = new Map()) {
  const loads = [];
  const ctx = runRecording(`${block(js, '  const LANDSCAPES = (() => {')})();\nthis.L = LANDSCAPES;`, {
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, BGL: { t: 0, dpr: 1 }, parseInt, isFinite, String, Object, Math,
    Image: class { set src(v) { loads.push(v); } } });
  return { L: vm.runInContext('this.L', ctx), loads, store };
}
// an element on a page wearing a skin, styled by the skin's CSS
function page(skin, html, { shell = 'phone' } = {}) {
  const doc = createDocument(); doc.documentElement.setAttribute('data-skin', skin); doc.documentElement.setAttribute('data-shell', shell);
  doc.body.innerHTML = html; return doc;
}
const val = (el, css, prop, opts) => cascade(el, css, opts)[prop]?.value ?? '';

test('Mizel offers Landscapes Dark and Landscapes Light, both from the one Landscapes package', () => {
  const S = skins(), by = id => S.list.find(s => s.id === id);
  assert.equal(by('landscapes')?.name, 'Landscapes Dark'); assert.equal(by('landscapes-light')?.name, 'Landscapes Light');
  for (const id of ['landscapes', 'landscapes-light']) assert.deepEqual({ ...S.pkgOf(id) }, { css: true, dir: 'landscapes' }, id);
  assert.equal(S.twin('landscapes')?.id, 'landscapes-light'); assert.equal(S.twin('landscapes-light')?.id, 'landscapes');
});

test('each palette rotates only its own photos, split by overall brightness, and together they cover all sixteen', () => {
  const { L } = landscapes(), num = f => parseInt(f, 10);
  const dark = [...L.dark.FILES].map(num), light = [...L.light.FILES].map(num);
  assert.deepEqual(dark, [6, 7, 8, 10, 13, 14]);
  assert.deepEqual([...dark, ...light].sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => i));
  assert.equal(L.light.LIGHT, true); assert.ok(!L.dark.LIGHT);
  // each keeps its own place in the rotation: a new page shows its next photo, and only its own
  const st = new Map(), r = landscapes(st), s1 = {}, s2 = {};
  r.L.light.init(s1, 100, 100); r.L.light.init(s2, 100, 100); r.L.dark.init({}, 100, 100);
  assert.equal(st.get('wos.skin.landscapes-light.at'), '1', 'Light keeps its own place in the rotation');
  assert.equal(st.get('wos.skin.landscapes.at'), '0');
  assert.equal(s2.cur, 1);
  const dayFiles = new Set(r.L.light.FILES);
  assert.ok(r.loads.slice(0, 4).every(u => dayFiles.has(u.split('/').pop().replace('.webp', ''))), 'Light loads only day photos');
  // the skin table hands each palette its own rotation
  const table = runRecording(`${block(js, '  const BG = {')};\nthis.BG = BG;`, { LANDSCAPES: r.L, Math }).BG;
  assert.equal(table.landscapes, r.L.dark, 'Landscapes Dark draws the dark rotation');
  assert.equal(table['landscapes-light'], r.L.light, 'Landscapes Light draws the day rotation');
});

test('the Landscapes package and Miguel\'s shell rules cover both palettes', () => {
  assert.doesNotMatch(skinCss, /data-skin="landscapes"\]/, 'shared rules use ^="landscapes"');
  // the owner's message bubble on Light: opaque ink glass (James, 8 Nov 2026), on both shells
  for (const shell of ['phone', 'desktop']) {
    const d = page('landscapes-light', '<div class="msg u"><div class="bub"></div></div>', { shell });
    assert.equal(val(d.querySelector('.bub'), skinCss, 'background'), 'var(--wz-owner-message)', shell);
  }
  const d = page('landscapes-light', '');
  assert.equal(val(d.documentElement, skinCss, '--wz-owner-message'), 'color-mix(in srgb, var(--ink) 16%, var(--bg))', 'Light owner bubble: opaque ink glass');
  // Skins are colours only (James, Miguel, 1 Nov 2026): no shell file asks which skin is worn to pick a layout.
  for (const f of ['web/app.js', 'web/live.js', 'web/core/chats.js', 'web/core/chat-models.js', 'web/desktop/desktop.js']) assert.doesNotMatch(read(f), /'landscapes', 'landscapes-light'/, f);
  assert.doesNotMatch(read('web/desktop/desktop.css'), /data-skin="landscapes"\]/);
});

test('Landscapes Light: 85% window glass, white send arrow, full-colour marks, bright badges', () => {
  assert.equal(skins().list.find(s => s.id === 'landscapes-light').t['sk-win'], 'rgba(250,250,252,.85)');
  const d = page('landscapes-light', '<form class="ch-compose"><button class="ch-send"><svg></svg></button><button class="ch-mic on"><svg></svg></button></form><span class="dsg"><b class="dbg"></b></span><b class="orb-badge"></b>');
  for (const sel of ['.ch-send svg', '.ch-mic svg']) assert.equal(val(d.querySelector(sel), skinCss, 'stroke'), '#fff', sel);
  assert.equal(val(d.querySelector('.dsg'), skinCss, 'opacity'), '1');
  for (const sel of ['.dbg', '.orb-badge']) { const c = cascade(d.querySelector(sel), skinCss); assert.equal(c.color?.value, '#160b05', sel); assert.equal(c.background?.value, '#ffbe55', sel); }
});

test('skin names in the picker wrap to two lines instead of cutting off', () => {
  const d = createDocument(); d.body.innerHTML = '<div class="st-root"><span class="skp-nm">Landscapes Light</span></div>';
  const c = cascade(d.querySelector('.skp-nm'), read('web/core/skins.css'));
  assert.equal(c['-webkit-line-clamp']?.value, '2'); assert.equal(c['min-height']?.value, '18px');
  assert.notEqual(c['white-space']?.value, 'nowrap');
});

test('Landscapes Light: the Latest pill and the small in-thread notes read as ink on light glass', () => {
  for (const shell of ['phone', 'desktop']) {
    const d = page('landscapes-light', '<div class="ch-latest"></div><details class="msg agentnote"><summary></summary></details><div class="laterrun"></div>', { shell });
    assert.match(val(d.querySelector('.ch-latest'), skinCss, 'background'), /^rgba\(250, 250, 252/, shell);
    for (const sel of ['.agentnote > summary', '.laterrun']) assert.equal(val(d.querySelector(sel), skinCss, 'color'), 'var(--ink-2)', `${shell} ${sel}`);
  }
});

test('Landscapes Light resource sheet draws capacity bars in ink, not white', () => {
  const d = page('landscapes-light', '<div class="rs-sheet"><span class="rs-cap-seg"><i></i></span></div>');
  assert.equal(val(d.querySelector('.rs-cap-seg'), skinCss, 'background'), 'rgba(0, 0, 0, .08)');
  assert.equal(val(d.querySelector('.rs-cap-seg i'), skinCss, 'background'), 'rgba(17, 18, 22, .72)');
  const dark = page('landscapes', '<div class="rs-sheet"><span class="rs-cap-seg"><i></i></span></div>');
  assert.notEqual(val(dark.querySelector('.rs-cap-seg i'), skinCss, 'background'), 'rgba(17, 18, 22, .72)', 'Dark keeps its own bars');
});
