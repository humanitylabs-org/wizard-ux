import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { compare, interiorROI, longMetrics, pageBudget, decodePNG } = require('../tools/viewer-qa-oracles.cjs');
const raster = () => ({ width: 100, height: 60, rgba: Buffer.alloc(100 * 60 * 4, 255) });
test('strict fixed interior rejects one-channel transparency; exterior is diagnostic only', () => {
  const meta = { width: 100, height: 60, radii: [18], borders: [1], padding: [8], exclusions: [] }, roi = interiorROI(meta);
  const a = raster(), corner = raster(); corner.rgba[0] = 0;
  assert.equal(compare(a, corner).changed, 1); assert.equal(compare(a, corner, roi).changed, 0);
  const leak = raster(); leak.rgba[(roi.y * 100 + roi.x) * 4] = 254;
  assert.equal(compare(a, leak, roi).changed, 1);
  assert.throws(() => interiorROI({ ...meta, exclusions: [{ left: 0, top: 0, right: 100, bottom: 60 }] }), /No nonempty/);
});
test('phone budget and footer use rendered long image, not object-fit letterbox proxy', () => {
  const g = { state: { open: true, long: true, scale: 1, y: 0 }, natural: { width: 240, height: 4800 }, stage: { width: 412, height: 721, bottom: 775 }, image: { bottom: 8294 } };
  assert.equal(longMetrics(g).minY, -7519);
  const budget = pageBudget(g); assert(budget * .85 * 721 >= 7519);
  assert.equal(longMetrics({ ...g, state: { ...g.state, y: -7519 }, image: { bottom: 775 } }).remaining, 0);
  assert.throws(() => longMetrics({ ...g, state: { ...g.state, open: false } }));
});
test('trusted pointer helper cannot suppress click/capture or reopen after dismissal', () => {
  const s = fs.readFileSync(new URL('../tools/viewer-qa-repair.cjs', import.meta.url), 'utf8');
  assert(s.includes('e.isTrusted')); assert(s.includes("'first trusted click'"));
  assert(!/releasePointerCapture|preventDefault\(|stopPropagation\(|dispatchEvent\(/.test(s));
  assert(s.includes('ordinary media-ink click must not dismiss viewer'));
});
test('PNG decoder consumes an actual retained synthetic Chromium capture when provided', { skip: !process.env.QA_PNG_PROOF }, () => {
  const file = fs.readFileSync(process.env.QA_PNG_PROOF), a = decodePNG(file);
  assert.equal(a.width, 1440); assert.equal(a.height, 900); assert.equal(compare(a, decodePNG(file)).changed, 0);
  const b = { ...a, rgba: Buffer.from(a.rgba) }; b.rgba[4] ^= 1; assert.equal(compare(a, b).changed, 1);
});
test('alpha reader delegates CSS parsing to cleared canvas and multiplies ancestors', () => {
  const { panelPaint } = require('../tools/viewer-qa-repair.cjs');
  for (const alpha of [255, 128, 0]) {
    const panel = { parentElement: { parentElement: null, opacity: '.5' }, opacity: '1' }, operations = [];
    const ctx = { clearRect: () => operations.push('clear'), fillRect: () => operations.push('fill'), getImageData: () => ({ data: [29, 27, 36, alpha] }) };
    const sandbox = vm.createContext({ getComputedStyle: n => ({ opacity: n.opacity, backgroundColor: 'color(srgb 0.112941 0.104314 0.142353)' }), document: { createElement: () => ({ getContext: () => ctx }) }, panel });
    const paint = vm.runInContext('(' + panelPaint.toString() + ')(panel)', sandbox);
    assert.equal(paint.rgba[3], alpha); assert.equal(paint.effectiveOpacity, .5);
    assert.equal(ctx.fillStyle, paint.background); assert.deepEqual(operations, ['clear', 'fill']);
  }
});
