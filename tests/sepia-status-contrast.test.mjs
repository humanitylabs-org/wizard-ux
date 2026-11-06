import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../web/skins/sepia/skin.css', import.meta.url), 'utf8');
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

test('Sepia status labels use paper-safe semantic colours', () => {
  const root = rule('html[data-skin="sepia"]');
  const roles = {
    needs: root.match(/--sepia-status-needs:\s*(#[0-9a-f]{6})/i)?.[1],
    check: root.match(/--sepia-status-check:\s*(#[0-9a-f]{6})/i)?.[1],
    done: root.match(/--sepia-status-done:\s*(#[0-9a-f]{6})/i)?.[1],
    fyi: root.match(/--sepia-status-fyi:\s*(#[0-9a-f]{6})/i)?.[1],
    failed: root.match(/--sepia-status-failed:\s*(#[0-9a-f]{6})/i)?.[1],
  };
  const paper = hex('#f6edda');
  for (const [name, value] of Object.entries(roles)) {
    assert.ok(value, `${name} role exists`);
    assert.ok(contrast(hex(value), paper) >= 4.5, `${name} reaches 4.5:1 on Sepia paper`);
  }

  assert.match(rule('html[data-skin="sepia"] :is(.ch-row, .ch-head) .emo.sti:is(.needs, .approval, .offline)'), /color:\s*var\(--sepia-status-needs\)/);
  assert.match(rule('html[data-skin="sepia"] :is(.ch-row, .ch-head) .emo.sti.check'), /color:\s*var\(--sepia-status-check\)/);
  assert.match(rule('html[data-skin="sepia"] :is(.ch-row, .ch-head) .emo.sti.done'), /color:\s*var\(--sepia-status-done\)/);
  assert.match(rule('html[data-skin="sepia"] :is(.ch-row, .ch-head) .emo.sti.fyi'), /color:\s*var\(--sepia-status-fyi\)/);
  assert.match(rule('html[data-skin="sepia"] :is(.ch-row, .ch-head) .emo.sti.failed'), /color:\s*var\(--sepia-status-failed\)/);
  assert.match(rule('html[data-skin="sepia"] .ch-row .pv em.att:is(.needs, .approval)'), /color:\s*var\(--sepia-status-needs\)/);
  assert.match(rule('html[data-skin="sepia"] .ch-row .pv em.att.check'), /color:\s*var\(--sepia-status-check\)/);
  assert.match(rule('html[data-skin="sepia"] .ch-row .pv em.att.done'), /color:\s*var\(--sepia-status-done\)/);
  assert.match(rule('html[data-skin="sepia"] .ch-row .pv em.att.fyi'), /color:\s*var\(--sepia-status-fyi\)/);
  assert.match(rule('html[data-skin="sepia"] .ch-row .pv em.att.failed'), /color:\s*var\(--sepia-status-failed\)/);
});
