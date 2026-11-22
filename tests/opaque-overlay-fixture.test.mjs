// tools/qa-opaque-overlays.cjs (the opaque-panel browser check) run in node:vm against a fake Chromium
// (tests/fixtures/r8A-opaque-overlays.mjs): the fixture pages it builds are parsed into the mini DOM and its own
// fixture <style> goes through the mini-css cascade; the fake screenshots decide whether a panel shows through.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runOpaque } from './fixtures/r8A-opaque-overlays.mjs';
import { cascade } from './fixtures/mini-css.mjs';

test('nested opacity fixture keeps production ancestry but normalizes only geometry', async () => {
  const run = await runOpaque({ filter: 'share-option' });
  assert.equal(run.pages.length, 10, 'every skin, hosted and not');
  const { doc } = run.pages[0];
  const panel = doc.querySelector('[data-qa-panel]'), middle = panel.parentNode, wrap = middle.parentNode;
  assert.equal(panel.tagName.toLowerCase(), 'button');
  assert.ok(middle.hasAttribute('data-qa-middle') && middle.getAttribute('class') === 'dv-picker', 'the production picker between the share sheet and its option');
  assert.equal(wrap.getAttribute('class'), 'wz-share dv-wrap open');
  // The fixture's own sheet (the last <style>): on the middle layer it sets geometry only, never material.
  const fixtureCss = doc.querySelectorAll('style').at(-1).textContent;
  const mid = Object.keys(cascade(middle, fixtureCss));
  assert.ok(mid.includes('inset') && mid.includes('position'), mid.join());
  for (const p of mid) assert.doesNotMatch(p, /^(background|opacity|filter|color|border|backdrop)/, 'normalizes geometry only: ' + p);
  const won = cascade(panel, fixtureCss);
  assert.deepEqual(['translate', 'rotate', 'scale'].map(p => [won[p]?.value, won[p]?.important]), [['none', true], ['none', true], ['1', true]], 'the panel is never moved by a production transform');
  // A panel that does not fit names its case, box and clip in the failure.
  const off = await runOpaque({ filter: 'share-option', box: { x: 0, y: 800, width: 358, height: 240 } });
  assert.equal(off.exitCode, 1);
  assert.match(String(off.errors[0]), /"test":"share-option","box":\{"x":0,"y":800[^}]*\},"clip":\{/);
});

test('opacity browser closes even if a screenshot or assertion fails', async () => {
  const clean = await runOpaque();
  assert.deepEqual([clean.closed, clean.exitCode, clean.result.failures], [1, undefined, 0]); assert.ok(clean.logs.includes('PASS opaque overlays'));
  const shot = await runOpaque({ throwOnShot: true });
  assert.deepEqual([shot.closed, shot.exitCode], [1, 1], 'a failed screenshot still closes the browser');
  const see = await runOpaque({ seeThrough: true });
  assert.equal(see.closed, 1);
  assert.equal(see.result.failures, 10, 'a panel whose interior changes over loud text is see-through');
  assert.equal(see.exitCode, 1); assert.match(String(see.errors[0]), /text-bearing overlay interiors must be independent of content behind/);
});
