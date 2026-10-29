import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Settings titles (.st-tx b, .ph-tx b, page heading) carry no colour of their own and inherit it.
// Skins such as Miguel's Light change --wz-text but not the legacy --ink, so the sheet must
// inherit from --wz-text or titles render near-white on white.
test('Settings root text follows the skin text token', () => {
  const css = readFileSync(new URL('../web/core/settings.css', import.meta.url), 'utf8');
  const rule = css.match(/^\.st-root \{([^}]*)\}/m);
  assert.ok(rule, '.st-root rule exists');
  assert.match(rule[1], /(^|;)\s*color:\s*var\(--wz-text\)/);
});
