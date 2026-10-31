// The interface reload banner is a shell notice, not a composer control. Keep it at the top on every phone skin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('the shared phone update banner stays under the status bar', () => {
  assert.match(read('web/core/update-banner.css'), /\.dv-update \{[^}]*top: calc\(40px \+ var\(--safe-t\)\)/s);
});

test('phone skins do not move the shared update banner over the composer', () => {
  for (const file of ['web/skins/obsidian/skin.css', 'web/skins/landscapes/skin.css']) {
    const css = read(file);
    assert.doesNotMatch(css, /\.device(?:\.orb-corner)? \.dv-update(?:\.web)?\s*\{[^}]*\b(?:top|bottom)\s*:/s, file);
  }
});
