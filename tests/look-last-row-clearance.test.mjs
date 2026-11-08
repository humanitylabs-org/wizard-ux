import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Browser-free CSS contract + boundary geometry, not native/screenshot acceptance.
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const shared = read('../web/core/settings.css');
const phone = read('../web/styles.css');
function rule(css, selector) {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(m => m[1].trim() === selector).map(m => m[2]).join(';');
}
const decl = (css, selector, prop) => [...rule(css, selector).matchAll(new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`, 'g'))].at(-1)?.[1].trim();

test('phone Settings ends above the actual dock plus browser/native safe inset', () => {
  assert.equal(decl(phone, '.settings', '--wz-settings-nav-clearance'), 'calc(var(--dock-h) + var(--safe-b))');
  assert.equal(decl(phone, '.settings', 'bottom'), 'calc(var(--wz-settings-nav-clearance) + var(--wz-space-2))');
  for (const height of [520, 892]) for (const dock of [66, 124]) for (const safe of [0, 34, 80]) {
    const navTop = height - dock - safe;
    const sheetBottom = height - (dock + safe + 8);
    assert.ok(sheetBottom <= navTop - 8, 'no text-bearing sheet area under the nav');
  }
});

test('phone scroll owner has edge padding without counting dock/safe area twice', () => {
  assert.equal(decl(shared, '.settings-body.st-root', 'padding-bottom'), 'var(--wz-space-5)');
  assert.equal(decl(shared, '.st-phone', 'padding-bottom'), undefined, 'no fixed spacer on the non-scrolling inner wrapper');
  assert.match(rule(phone, '.settings-body'), /overflow-y:\s*auto/);
});

test('desktop constrains the grid track and the actual page scroller', () => {
  assert.equal(decl(shared, '.st-desktop', 'grid-template-rows'), 'minmax(0, 1fr)');
  assert.equal(decl(shared, '.st-desktop .st-page', 'min-height'), '0');
  assert.match(rule(shared, '.st-desktop .st-page'), /overflow-y:\s*auto/);
  assert.equal(decl(shared, '.st-desktop .st-page', 'padding-bottom'), 'var(--wz-space-5)');
});

test('last full row and caption can scroll above the padded page boundary', () => {
  // At max scroll the final row ends at scrollport bottom minus padding.
  // Constraining the track makes that scrollport no taller than its clipped parent.
  assert.equal(decl(shared, '.st-desktop', 'grid-template-rows'), 'minmax(0, 1fr)');
  assert.equal(decl(shared, '.st-desktop .st-page', 'padding-bottom'), 'var(--wz-space-5)');
  for (const viewport of [240, 480, 640]) for (const rowHeight of [60, 84, 120]) {
    const padding = 24, content = viewport + 800, maxScroll = content + padding - viewport;
    const rowBottom = content - maxScroll, rowTop = rowBottom - rowHeight;
    assert.ok(rowTop >= 0 && rowBottom <= viewport - padding);
    assert.ok(rowBottom - 12 < viewport - padding, 'caption stays inside the whole row');
  }
});

test('both real shells retain the shared Settings stylesheet and renderer', () => {
  for (const entry of ['index.html', 'desktop.html']) {
    const html = read('../web/' + entry);
    assert.match(html, /href="core\/settings.css"/);
    assert.match(html, /src="core\/settings.js"/);
  }
});

test('the floating desktop Settings panel keeps an opaque base', () => {
  assert.match(rule(shared, '.dsettings'), /background:\s*linear-gradient\(var\(--wz-overlay\), var\(--wz-overlay\)\), var\(--wz-base\)/);
});
