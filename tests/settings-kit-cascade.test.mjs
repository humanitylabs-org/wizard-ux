import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';

// kit/controls.css loads after core/settings.css in both shells. Settings rows carry
// wz-row and Retry all carries wz-button, so equal-specificity kit rules would win by
// load order and turn flat hairline rows into rounded rows and the outlined pill into
// a solid accent button. Settings must out-rank the kit for its own look. The real
// stylesheets run here in each shell's own load order over Settings' own elements.
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const PAGES = ['../web/index.html', '../web/desktop.html'];
// the stylesheets a shell page links, in its order
const sheetsOf = page => {
  const html = read(page), doc = createDocument();
  doc.documentElement.innerHTML = html.slice(html.indexOf('<head'), html.lastIndexOf('</html>'));
  return doc.querySelectorAll('link[rel="stylesheet"]').map(l => l.getAttribute('href'));
};
// Settings' own sheet and the kit's, in the page's load order (one text, so source order runs across both)
const ordered = page => { const at = sheetsOf(page); return ['core/settings.css', 'kit/controls.css'].sort((a, b) => at.indexOf(a) - at.indexOf(b)).map(h => read('../web/' + h)); };
const el = (html) => { const d = createDocument(); d.body.innerHTML = html; return d.body.firstElementChild; };
const style = (node, page) => Object.fromEntries(Object.entries(cascade(node, ordered(page).join('\n'))).map(([k, v]) => [k, v.value]));

test('kit controls still load after Settings (premise of this guard)', () => {
  for (const page of PAGES) {
    const at = sheetsOf(page);
    assert.ok(at.includes('core/settings.css') && at.includes('kit/controls.css'), page);
    assert.ok(at.indexOf('kit/controls.css') > at.indexOf('core/settings.css'), page);
  }
});

test('Settings rows out-rank .wz-row and stay flat hairline lines', () => {
  for (const page of PAGES) {
    const s = style(el('<div class="st-row wz-row"></div>'), page);
    assert.match(s['border-radius'], /^0(px)?$/, page); assert.equal(s.padding, '12px 4px', page);
    assert.equal(s['min-height'], '60px', page); assert.equal(s['border-bottom'], '1px solid var(--wz-border)', page);
  }
});

test('Retry all out-ranks .wz-button.secondary and stays an outlined pill', () => {
  for (const page of PAGES) {
    const s = style(el('<button class="st-wide wz-button secondary">Retry all</button>'), page);
    assert.equal(s['border-radius'], '99px', page); assert.equal(s.background, 'transparent', page);
    assert.equal(s.border, '1px solid var(--wz-border)', page);
  }
});
