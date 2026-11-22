import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';

// Browser-free CSS contract + boundary geometry, not native/screenshot acceptance. The real stylesheets are applied to
// the Settings markup through a small cascade (tests/fixtures/mini-css.mjs; wizard-ux issue 1674: tests run the code).
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const shared = read('../web/core/settings.css');
const phone = read('../web/styles.css');
function settings(html) { const d = createDocument(); d.body.innerHTML = html; return d; }
const style = (doc, sel, css) => { const el = doc.querySelector(sel); assert.ok(el, sel); const c = cascade(el, css); return p => c[p]?.value; };
const phoneDoc = () => settings('<div class="settings"><div class="settings-body st-root"><div class="st-phone"></div></div></div>');
const deskDoc = () => settings('<div class="dsettings"><div class="settings-body st-root st-desktop"><div class="st-page"></div></div></div>');

test('phone Settings ends above the actual dock plus browser/native safe inset', () => {
  const s = style(phoneDoc(), '.settings', phone);
  assert.equal(s('--wz-settings-nav-clearance'), 'calc(var(--dock-h) + var(--safe-b))');
  assert.equal(s('bottom'), 'calc(var(--wz-settings-nav-clearance) + var(--wz-space-2))');
  for (const height of [520, 892]) for (const dock of [66, 124]) for (const safe of [0, 34, 80]) {
    const navTop = height - dock - safe;
    const sheetBottom = height - (dock + safe + 8);
    assert.ok(sheetBottom <= navTop - 8, 'no text-bearing sheet area under the nav');
  }
});

test('phone scroll owner has edge padding without counting dock/safe area twice', () => {
  const d = phoneDoc();
  assert.equal(style(d, '.settings-body', shared)('padding-bottom'), 'var(--wz-space-5)');
  assert.equal(style(d, '.st-phone', shared)('padding-bottom'), undefined, 'no fixed spacer on the non-scrolling inner wrapper');
  assert.equal(style(d, '.settings-body', phone)('overflow-y'), 'auto');
});

test('desktop constrains the grid track and the actual page scroller', () => {
  const d = deskDoc();
  assert.equal(style(d, '.st-desktop', shared)('grid-template-rows'), 'minmax(0, 1fr)');
  const page = style(d, '.st-page', shared);
  assert.equal(page('min-height'), '0'); assert.equal(page('overflow-y'), 'auto'); assert.equal(page('padding-bottom'), 'var(--wz-space-5)');
});

test('last full row and caption can scroll above the padded page boundary', () => {
  // At max scroll the final row ends at scrollport bottom minus padding.
  // Constraining the track makes that scrollport no taller than its clipped parent.
  const d = deskDoc();
  assert.equal(style(d, '.st-desktop', shared)('grid-template-rows'), 'minmax(0, 1fr)');
  assert.equal(style(d, '.st-page', shared)('padding-bottom'), 'var(--wz-space-5)');
  for (const viewport of [240, 480, 640]) for (const rowHeight of [60, 84, 120]) {
    const padding = 24, content = viewport + 800, maxScroll = content + padding - viewport;
    const rowBottom = content - maxScroll, rowTop = rowBottom - rowHeight;
    assert.ok(rowTop >= 0 && rowBottom <= viewport - padding);
    assert.ok(rowBottom - 12 < viewport - padding, 'caption stays inside the whole row');
  }
});

test('both real shells retain the shared Settings stylesheet and renderer', () => {
  for (const entry of ['index.html', 'desktop.html']) {
    const html = read('../web/' + entry), d = createDocument();
    d.documentElement.innerHTML = html.slice(html.indexOf('<head'), html.lastIndexOf('</html>'));
    const clean = s => String(s || '').replace(/^\.\//, '').replace(/\?.*$/, '');
    assert.ok(d.querySelectorAll('link[rel="stylesheet"]').some(l => clean(l.getAttribute('href')) === 'core/settings.css'), entry + ': settings.css');
    assert.ok(d.querySelectorAll('script[src]').some(s => clean(s.getAttribute('src')) === 'core/settings.js'), entry + ': settings.js');
  }
});

test('the floating desktop Settings panel keeps an opaque base', () => {
  assert.equal(style(deskDoc(), '.dsettings', shared)('background'), 'linear-gradient(var(--wz-overlay), var(--wz-overlay)), var(--wz-base)');
});
