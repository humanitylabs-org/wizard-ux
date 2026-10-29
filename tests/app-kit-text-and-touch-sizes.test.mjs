import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// App design rules v0, rule 6: touch targets are at least 44 px and text is at least 13 px, except short uppercase
// labels and counters (.wz-sec-h, .wz-count), which may go down to 11 px. The kit itself broke both: pills and meters
// were 12.5 px, the count badge 10.5 px, and the single-line field and its button 42 px.
const kit = readFileSync(new URL('../web/kit/wizard-ui.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const LABELS = /^\.wz-(sec-h|count)\b/;

test('kit text is at least 13 px, labels and counters at least 11 px', () => {
  const small = [];
  for (const m of kit.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sel = m[1].trim().replace(/^@[^{]+\{\s*/, '');
    const size = m[2].match(/font-size:\s*([\d.]+)px/);
    if (!size) continue;
    const px = Number(size[1]), floor = sel.split(',').every(s => LABELS.test(s.trim())) ? 11 : 13;
    if (px < floor) small.push(`${sel} ${px}px (floor ${floor}px)`);
  }
  assert.deepEqual(small, []);
});

test('the single-line field and its button are 44 px touch targets', () => {
  assert.match(kit, /\.wz-field, \.wz-input \{[^}]*\bheight: 44px/);
  assert.match(kit, /\.wz-field-go, \.wz-send \{[^}]*\bwidth: 44px; height: 44px/);
});
