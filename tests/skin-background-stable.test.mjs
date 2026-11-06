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
  assert.match(size, /if \(r\.width === BGL\.W && r\.height === BGL\.H && dpr === BGL\.dpr && [^\n]*\) return false;/, 'same size: nothing to do');
  assert.match(size, /if \(R && R\.resize\) R\.resize\.call\(R, BGL\.st\[id\], BGL\.W, BGL\.H\); else delete BGL\.st\[id\];/, 'a real resize keeps a scene that can crop again');
  assert.match(src, /addEventListener\('resize', \(\) => \{ if \(size\(\)\) wake\(\); \}\);/, 'repaints only when it did change');
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

test('Landscapes: a real resize crops the same photo again, never the next one', () => {
  const src = read('web/core/skins.js');
  assert.match(src, /resize\(s, W, H\) \{ for \(const slot of Object\.values\(s\.img\)\) if \(slot\.ready && slot\.im\) this\.cover\(slot, W, H\); \}/);
  assert.match(src, /im\.onload = \(\) => \{ this\.cover\(slot, W, H\); slot\.ready = true; wake\(\); \};/, 'one cover-fit routine for load and resize');
});

test('scenery.js stars: a same-size resize keeps the same sky; a real one stretches it (never re-rolls)', () => {
  const src = read('web/core/scenery.js'), size = body(src, '    function size() {');
  assert.match(size, /if \(pts\.length && w === Wd && h === H\) return false;/);
  assert.match(size, /for \(const p of pts\) \{ p\.x \*= kx; p\.y \*= ky; \}/);
  assert.match(src, /addEventListener\('resize', \(\) => \{ if \(size\(\)\) still\('stars'\); \}\);/);
});
