import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Rehearsal finding (wizard-os 389): on Landscapes Light the desktop "<App> opens in its own tab" card (browser boundary,
// own-tab apps) was dark --ink text on a fixed dark panel. The card must take the skin's surface and text tokens.
// Real Chromium proof on both skins: the rehearsal screenshots (wizard-os 389 report).
const css = readFileSync(new URL('../web/desktop/desktop.css', import.meta.url), 'utf8');
const rule = sel => (css.match(new RegExp('(^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}')) || [])[2] || '';

test('own-tab / blocked-frame card follows the skin: surface and text from tokens, no fixed colour', () => {
  const base = rule('.frame-fallback');
  assert.ok(base, 'rule present');
  assert.doesNotMatch(base, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'no literal panel colour');
  assert.match(base, /background: var\(--wz-panel/);
  assert.match(base, /color: var\(--wz-text/);
  assert.match(rule('.frame-fallback b'), /color: var\(--wz-text/);
});
