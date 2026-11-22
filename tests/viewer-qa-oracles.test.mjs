import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { runZoom } from './fixtures/r7A-viewer-zoom.mjs';
const require = createRequire(import.meta.url);
const { compare, interiorROI, containedMetrics, decodePNG } = require('../tools/viewer-qa-oracles.cjs');
const raster = () => ({ width: 100, height: 60, rgba: Buffer.alloc(100 * 60 * 4, 255) });
test('strict fixed interior rejects one-channel transparency; exterior is diagnostic only', () => {
  const meta = { width: 100, height: 60, radii: [18], borders: [1], padding: [8], exclusions: [] }, roi = interiorROI(meta);
  const a = raster(), corner = raster(); corner.rgba[0] = 0;
  assert.equal(compare(a, corner).changed, 1); assert.equal(compare(a, corner, roi).changed, 0);
  const leak = raster(); leak.rgba[(roi.y * 100 + roi.x) * 4] = 254;
  assert.equal(compare(a, leak, roi).changed, 1);
  assert.throws(() => interiorROI({ ...meta, exclusions: [{ left: 0, top: 0, right: 100, bottom: 60 }] }), /No nonempty/);
});
test('James correction, 6 Nov 2026: phone oracle rejects scroll-on-open and any image beyond the stage', () => {
  const g = { state: { open: true, long: false, scale: 1 }, stage: { left: 0, right: 393, top: 54, bottom: 775 }, image: { left: 148, right: 245, top: 54, bottom: 775 } };
  assert.equal(containedMetrics(g).footerBottom,775);
  assert.throws(() => containedMetrics({ ...g, state: { ...g.state, long: true } }));
  assert.throws(() => containedMetrics({ ...g, image: { ...g.image, bottom: 8294 } }));
  assert.throws(() => containedMetrics({ ...g, image: { ...g.image, left: -1 } }));
  assert.throws(() => containedMetrics({ ...g, state: { ...g.state, open: false } }));
});
test('trusted pointer helper cannot suppress click/capture or reopen after dismissal', async () => {
  // The real zoom() check over a model viewer that behaves: it passes, using only the trusted mouse.
  const ok = await runZoom();
  assert.equal(ok.error, null, String(ok.error));
  assert.deepEqual(ok.journal.map(j => j.label).filter(Boolean), ['first trusted click', 'second trusted click', 'zoomed mouse pan', 'reset', 'drag ends over letterbox', 'fresh letterbox click']);
  assert.ok(ok.input.length > 0 && ok.input.every(e => e.trusted), 'it records the page\'s own trusted input, and dispatches none');
  assert.ok(ok.input.some(e => e.type === 'click' && e.target === 'mv-stage'));
  assert.equal(ok.opens, 1); assert.equal(ok.state.open, false, 'after the outside click the viewer stays closed: never reopened');
  // And it fails each way a broken viewer could pass a looser check.
  assert.match(String((await runZoom({ faults: { dismissOnClick: true } })).error?.message), /ordinary media-ink click must not dismiss viewer/);
  assert.match(String((await runZoom({ faults: { untrusted: true } })).error?.message), /native captured click actually retargets to stage/);
  assert.match(String((await runZoom({ faults: { staleSuppression: true } })).error?.message), /fresh outside click closes, no stale suppression/);
  const s = fs.readFileSync(new URL('../tools/viewer-qa-repair.cjs', import.meta.url), 'utf8');
  assert(!/releasePointerCapture|preventDefault\(|stopPropagation\(|dispatchEvent\(/.test(s));
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
