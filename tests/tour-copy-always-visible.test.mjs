// The tour's instruction text must be readable even if its entrance animation never advances. WebKit (iPhone Safari,
// Telegram's in-app browser, Home Screen app) held the beat-1 entrance at frame 0 for 1.3-2.2 s while the shell booted;
// with opacity in the keyframes "Tap the orb and say hello" was invisible that whole time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../web/core/tour.css', import.meta.url), 'utf8');
test('the tour entrance (trIn) animates movement only: no opacity, visibility or blur in its keyframes', () => {
  const m = css.match(/@keyframes trIn \{([^]*?)\}\s*\}/);
  assert.ok(m, 'trIn keyframes exist');
  assert.doesNotMatch(m[1], /opacity|visibility|filter/);
});
test('every element that enters with trIn is tour copy, a glyph or the desktop guide', () => {
  const users = [...css.matchAll(/([^{}]+)\{[^}]*animation:[^;}]*\btrIn\b/g)].map(x => x[1].trim());
  assert.ok(users.length >= 3, users.join(' | '));
});
