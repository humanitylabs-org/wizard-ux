// The wallpaper never re-renders because a layout re-tiles (Miguel, 2 Nov 2026, AI apps round 11: "the background and
// icons change dramatically whenever a panel opens or closes"). Layouts and the desktop shell send `resize` events for
// their own re-tiling while the page keeps its size; core/skins.js used to wipe its canvases and every skin's state on
// each one, so Landscapes moved on to its NEXT photo on every panel open/close and every random scene re-rolled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const body = (src, head) => { const i = src.indexOf(head); assert.ok(i >= 0, head); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } return ''; };

test('skins.js: a resize that leaves the page its size touches nothing (no canvas wipe, no new state, no next photo)', () => {
  const src = read('web/core/skins.js'), size = body(src, '  function size() {');
  assert.ok(!/BGL\.st = \{\};/.test(size), 'never throws every skin\'s state away (Landscapes re-picked its photo, scenes re-rolled)');
  // (same size: nothing to do; a real resize keeps a scene that can crop again: size() runs below)
  // the page's resize listener (its own line in skins.js, run): repaints only when size() says it changed
  const at = src.indexOf("addEventListener('resize',"), line = src.slice(at, src.indexOf('\n', at));
  const on = {}, woke = [], changed = { v: false };
  vm.runInNewContext(line, { addEventListener: (t, f) => { on[t] = f; }, size: () => changed.v, wake: () => woke.push(1) });
  on.resize(); assert.equal(woke.length, 0, 'a same-size resize: no repaint');
  changed.v = true; on.resize(); assert.equal(woke.length, 1, 'repaints only when it did change');
  // run size() for real against a fake canvas pair: a same-size resize leaves the canvases and states alone
  const fn = size;
  const cv = [{ width: 0, height: 0, parentElement: { getBoundingClientRect: () => ({ width: 1440, height: 900 }) } }, { width: 0, height: 0 }];
  cv[1].parentElement = cv[0].parentElement;
  const ctx = { BGL: { cv, st: {}, W: 0, H: 0, dpr: 1 }, BG: { landscapes: { resize(s) { s.cropped = (s.cropped || 0) + 1; } }, grove: {} }, devicePixelRatio: 1, out: [] };
  vm.runInNewContext(fn + '; out.push(size()); BGL.st.landscapes = { cur: 3 }; BGL.st.grove = { x: 1 }; let sets = 0; for (const c of BGL.cv) { let w = c.width; Object.defineProperty(c, "width", { get: () => w, set: v => { sets++; w = v; } }); } out.push(size(), sets, JSON.stringify(BGL.st));', ctx);
  assert.deepEqual(ctx.out, [true, false, 0, '{"landscapes":{"cur":3},"grove":{"x":1}}'], 'first sizing yes; a same-size resize: no canvas write, the same photo and scenes');
  ctx.BGL.cv[0].parentElement.getBoundingClientRect = () => ({ width: 1400, height: 900 });
  vm.runInNewContext(fn + '; out.push(size(), JSON.stringify(BGL.st));', ctx);
  assert.deepEqual(ctx.out.slice(4), [true, '{"landscapes":{"cur":3,"cropped":1}}'], 'a real resize: Landscapes keeps its photo (cropped again), a scene without resize starts over');
});

// The Landscapes scene from skins.js with a fake Image and canvas: photos load, then the page resizes.
function landscapes() {
  const src = read('web/core/skins.js'), i = src.indexOf('  const LANDSCAPES = (() => {'), j = src.indexOf('  const BG = {', i);
  assert.ok(i >= 0 && j > i, 'LANDSCAPES');
  const images = [], canvases = [], store = {};
  class Image { constructor() { images.push(this); this.naturalWidth = 3000; this.naturalHeight = 2000; } }
  const mk = (w, h) => { const o = { width: w, height: h, getContext: () => ({ drawImage() {}, createLinearGradient: () => ({ addColorStop() {} }), fillRect() {} }) }; canvases.push(o); return o; };
  const ctx = { Image, mk, BGL: { dpr: 1, t: 0 }, wake() {}, localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } }, images, canvases };
  vm.createContext(ctx);
  vm.runInContext(src.slice(i, j) + 'this.L = LANDSCAPES.dark;', ctx);
  return ctx;
}
test('Landscapes: a real resize crops the same photo again, never the next one', () => {
  const x = landscapes(), L = x.L, s = {};
  L.init(s, 1440, 900);
  const cur = s.cur, src = x.images[0].src;
  assert.equal(x.images.length, 2, 'the shown photo and the next one load');
  for (const im of x.images) im.onload();
  assert.deepEqual([s.img[cur].c.width, s.img[cur].c.height], [1440, 900], 'onload cover-fits the photo to the page');
  L.resize(s, 1000, 900);
  assert.equal(s.cur, cur, 'the same photo');
  assert.equal(x.images.length, 2, 'no new photo loaded');
  assert.equal(s.img[cur].im.src, src);
  assert.deepEqual([s.img[cur].c.width, s.img[cur].c.height], [1000, 900], 'cropped again for the new size by the same cover routine');
});

// scenery.js starLayer with a fake canvas: count the random draws that would re-roll the sky.
function stars() {
  const src = read('web/core/scenery.js'), fn = body(src, '  function starLayer() {');
  let rolls = 0; const listeners = {}, stills = [], arcs = [];
  const M = Object.create(Math); M.random = () => (rolls++, 0.5);
  const c = { clientWidth: 400, clientHeight: 300, width: 0, height: 0, getContext: () => ({ clearRect() {}, beginPath() {}, arc: (px, py) => arcs.push([px, py]), fill() {} }) };
  const ctx = { Math, document: { getElementById: () => c, documentElement: { dataset: {} } }, devicePixelRatio: 1, addEventListener: (t, f) => { listeners[t] = f; }, still: l => stills.push(l), host: null, window: {} };
  vm.createContext(ctx); ctx.Math = M;
  vm.runInContext(fn + '\nthis.layer = starLayer();', ctx);
  return { c, listeners, stills, arcs, layer: ctx.layer, rolls: () => rolls };
}
test('scenery.js stars: a same-size resize keeps the same sky; a real one stretches it (never re-rolls)', () => {
  const st = stars(), first = st.rolls();
  assert.ok(first > 0, 'the first sizing rolls a sky');
  st.layer.still(); const sky = st.arcs.splice(0);
  st.listeners.resize();
  assert.deepEqual(st.stills, [], 'same size: no repaint');
  assert.equal(st.rolls(), first, 'and no re-roll');
  st.layer.still(); assert.deepEqual(st.arcs.splice(0), sky, 'the same sky');
  st.c.clientWidth = 800; st.listeners.resize();
  assert.deepEqual(st.stills, ['stars'], 'a real resize repaints');
  assert.equal(st.rolls(), first, 'never re-rolls');
  assert.equal(st.c.width, 800);
  st.layer.still(); const wide = st.arcs.splice(0);
  assert.equal(wide.length, sky.length, 'the same stars');
  assert.deepEqual(wide.map(p => p[1]), sky.map(p => p[1]), 'heights kept, the field stretched across');
});
