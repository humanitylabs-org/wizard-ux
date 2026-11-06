import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../web/skins/landscapes/skin.css', import.meta.url), 'utf8');
const rule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] || '';
};
const hex = value => {
  const h = value.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
};
const lum = rgb => rgb.map(v => {
  const x = v / 255;
  return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
}).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);

test('Landscapes Light read previews clear the normal-text contrast floor', () => {
  const preview = rule('html[data-skin="landscapes-light"] .ch-row:not(.unread):not(.draft) .pv');
  assert.match(preview, /color:\s*rgba\(17,\s*18,\s*22,\s*\.62\)/);
  assert.equal(rule('html[data-skin="landscapes-light"] .ch-row:not(.unread) .pv'), '', 'saved drafts keep their amber semantic preview');
  assert.ok(contrast(hex('#626367'), hex('#fafafc')) >= 4.5);
});
