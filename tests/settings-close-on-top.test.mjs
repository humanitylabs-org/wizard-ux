import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The Settings X must stay tappable whatever a skin does to the body below it (a fade mask, a transform or a
// filter puts the scrolling body on its own layer, which then paints over an unlayered X and swallows the tap).
test('Settings close button sits on its own layer above the settings body (phone and desktop)', () => {
  const phone = readFileSync(new URL('../web/styles.css', import.meta.url), 'utf8').match(/\n\.st-close \{[^}]*\}/)[0];
  assert.match(phone, /position: absolute/);
  assert.match(phone, /z-index: [1-9]/);
  const desk = readFileSync(new URL('../web/core/settings.css', import.meta.url), 'utf8').match(/\.dsettings > \.st-close \{[^}]*\}/)[0];
  assert.match(desk, /position: relative/);
  assert.match(desk, /z-index: [1-9]/);
});
