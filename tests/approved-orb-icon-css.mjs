// James approved the white app icon in the orb and removal of the centre dot, 27 Oct 2026.
// Exempt only the exact approved .orb-app rules; all other dock/font guards remain in force.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
export function withoutApprovedOrbIcon(css) {
  const start = css.indexOf('/* ---------- Wizard skins (phone):');
  if (start < 0) return css;
  const block = css.slice(start);
  assert.equal(createHash('sha256').update(block).digest('hex'), '0661d1ca4dace028d895bee9927b534556fc636f3546cdb73bb091af14cd7150', 'Only the exact owner-approved .orb-app rules may bypass the dock guards');
  return css.slice(0, start);
}
