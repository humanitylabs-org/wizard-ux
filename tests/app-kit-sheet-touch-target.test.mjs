// Sheet close button meets the 44px touch-target rule (wizard-os APP-DESIGN-RULES rule 6, issue wizard-os#272).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const kit = readFileSync(new URL('../web/kit/wizard-ui.css', import.meta.url), 'utf8');

test('sheet close button hit area reaches 44px around its 36px circle', () => {
  const base = kit.match(/\.wz-sheet-x \{([^}]*)\}/)[1];
  const size = Number(base.match(/width:\s*(\d+)px/)[1]);
  assert.match(base, /position:\s*(sticky|relative|absolute|fixed)/, 'button must contain its hit-area pseudo-element');
  const after = kit.match(/\.wz-sheet-x::after \{([^}]*)\}/);
  assert.ok(after, 'expected a .wz-sheet-x::after hit-area extension');
  assert.match(after[1], /position:\s*absolute/);
  const inset = Number(after[1].match(/inset:\s*-(\d+)px/)[1]);
  assert.ok(size + 2 * inset >= 44, `hit area ${size + 2 * inset}px is below 44px`);
});
