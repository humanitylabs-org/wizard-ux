// James, 18 Oct 2026: the brand fonts were approved for the Home clock only.
// The Chats list, windows, titles and controls keep the shell's own font.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../web/core/brand-guide.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, sel, body]) => ({ sel: sel.trim(), body }))
  .filter(r => !r.sel.startsWith('@font-face') && !r.sel.startsWith(':root'));

test('brand guide sets fonts and type tracking on the Home clock only', () => {
  for (const r of rules) {
    if (!/font-family|font-weight|letter-spacing/.test(r.body)) continue;
    const sels = r.sel.split(',').map(s => s.trim());
    for (const s of sels) assert.ok(/^\.home-(time|date)$/.test(s), `brand-guide.css changes type on "${s}"`);
  }
});

test('brand guide never restyles the Chats list or the page body font', () => {
  assert.doesNotMatch(css, /(^|[\s,}])body\s*[,{][^}]*font-family/);
  for (const r of rules) {
    if (/\.ch-/.test(r.sel)) assert.doesNotMatch(r.body, /font|letter-spacing/, `type change on ${r.sel}`);
  }
});
