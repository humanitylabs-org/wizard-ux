import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'web/app.js'), 'utf8');
const source = app.slice(app.indexOf('  function frameEdge(f) {'), app.indexOf('  function syncImmersive()'));
assert.ok(source.startsWith('  function frameEdge(f) {'));
// Run the production measurement path. The canvas fixture models the browser's
// conversion seam; real CSS parsing/rendering remains browser acceptance.
function measure(colour, pixels, { top = '', canvasFails = false, accessible = true } = {}) {
  const classes = new Map(), styles = new Map(), paints = [];
  let painted = '';
  const win = { classList: { toggle: (key, value) => classes.set(key, value) }, style: {
    setProperty: (key, value) => styles.set(key, value), removeProperty: key => styles.delete(key),
  } };
  const body = { colour }, html = { colour: '', clientWidth: 390 };
  const header = top ? { colour: top, tagName: 'HEADER', parentElement: html, getBoundingClientRect: () => ({ width: 390 }) } : null;
  const context = {
    set fillStyle(value) { painted = value; paints.push(value); },
    get fillStyle() { return painted; }, fillRect() {},
    getImageData() { if (canvasFails) throw new Error('fixture conversion unavailable'); return { data: pixels }; },
  };
  const doc = { body, documentElement: html, styleSheets: [], querySelector: () => null,
    elementFromPoint: () => header,
    defaultView: { getComputedStyle: el => ({ backgroundColor: el.colour, backgroundImage: 'none' }), __wosTopWatch: true },
    createElement: name => { assert.equal(name, 'canvas'); return { getContext: () => context }; },
  };
  const frame = { closest: () => win, get contentDocument() { if (!accessible) throw new Error('cross origin'); return doc; } };
  const run = vm.runInNewContext(`${source}; frameEdge`, { document: doc, console, clearTimeout, setTimeout });
  run(frame);
  return { light: classes.get('edge-light'), paints, styles };
}
for (const colour of ['color(srgb 1 1 1)', 'color(display-p3 1 1 1)', 'oklch(1 0 0)']) {
  test(`production frameEdge normalizes ${colour} before choosing dark ink`, () => {
    const result = measure(colour, new Uint8ClampedArray([255, 255, 255, 255]));
    assert.equal(result.light, true);
    assert.ok(result.paints.includes(colour), 'must delegate conversion to browser canvas, not regex coordinates');
    assert.equal(result.styles.get('--frame-bg'), colour);
  });
}
test('opaque RGB light and dark controls', () => {
  assert.equal(measure('rgb(250, 250, 250)', [250, 250, 250, 255]).light, true);
  assert.equal(measure('rgb(5, 6, 15)', [5, 6, 15, 255]).light, false);
});
test('painted top edge wins over body background', () => {
  const result = measure('color(srgb 1 1 1)', [5, 6, 15, 255], { top: 'rgb(5, 6, 15)' });
  assert.equal(result.light, false);
  assert.ok(result.paints.includes('rgb(5, 6, 15)'));
  assert.equal(result.styles.get('--frame-top'), 'rgb(5, 6, 15)');
});
test('transparent app paint is flattened to the same opaque heading used for ink choice', () => {
  assert.equal(measure('rgba(255, 255, 255, 0.1)', [255, 255, 255, 26]).light, false);
  assert.equal(measure('rgba(255, 255, 255, 0.49)', [255, 255, 255, 127]).light, true);
  const dark = measure('rgba(0, 0, 0, 0.1)', [0, 0, 0, 26]);
  assert.equal(dark.light, false);
  assert.equal(dark.styles.get('--frame-bg'), '#0d0e12', 'rendered heading must be opaque, not white ink over a light skin');
  assert.equal(measure('rgba(255, 255, 255, 0.49)', [255, 255, 255, 127]).styles.get('--frame-bg'), '#878789');
  assert.equal(measure('rgba(255, 255, 255, 0.5)', [255, 255, 255, 128]).light, true);
  assert.equal(measure('color(srgb 1 1 1)', [255, 255, 255, 255], { canvasFails: true }).light, false);
  assert.equal(measure('', [], { accessible: false }).light, false);
});
