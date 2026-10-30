import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// kit/controls.css loads after core/settings.css in both shells. Settings rows carry
// wz-row and Retry all carries wz-button, so equal-specificity kit rules would win by
// load order and turn flat hairline rows into rounded rows and the outlined pill into
// a solid accent button. Settings must out-rank the kit for its own look.
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('../web/core/settings.css');

const spec = (sel) => {
  const s = sel.replace(/:not\(([^)]*)\)/g, ' $1');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const cls = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
  const el = (s.replace(/[.#][\w-]+|\[[^\]]+\]|::?[\w-]+/g, ' ').match(/[a-z][\w-]*/gi) || []).length;
  return ids * 10000 + cls * 100 + el;
};
const ruleFor = (text, wanted) => {
  for (const m of text.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sels = m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((x) => x.trim());
    if (sels.includes(wanted)) return { sels, body: m[2] };
  }
  return null;
};

test('kit controls still load after Settings (premise of this guard)', () => {
  for (const page of ['../web/index.html', '../web/desktop.html']) {
    const html = read(page);
    assert.ok(html.indexOf('kit/controls.css') > html.indexOf('core/settings.css'), page);
  }
});

test('Settings rows out-rank .wz-row and stay flat hairline lines', () => {
  const r = ruleFor(css, '.st-row.wz-row');
  assert.ok(r, '.st-row.wz-row rule exists');
  assert.ok(spec('.st-row.wz-row') > spec('.wz-row'));
  assert.match(r.body, /border-radius:\s*0/);
  assert.match(r.body, /padding:\s*12px 4px/);
  assert.match(r.body, /min-height:\s*60px/);
  assert.match(r.body, /border-bottom:\s*1px solid var\(--wz-border\)/);
});

test('Retry all out-ranks .wz-button.secondary and stays an outlined pill', () => {
  const r = ruleFor(css, '.st-wide.wz-button.secondary');
  assert.ok(r, '.st-wide.wz-button.secondary rule exists');
  assert.ok(spec('.st-wide.wz-button.secondary') > spec('.wz-button.secondary'));
  assert.match(r.body, /border-radius:\s*99px/);
  assert.match(r.body, /background:\s*transparent/);
  assert.match(r.body, /border:\s*1px solid var\(--wz-border\)/);
});
