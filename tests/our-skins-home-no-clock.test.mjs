import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');

// Skins are colours only: no skin (Miguel's included) hides the Home date and clock.
test('every skin and core CSS keep the Home date and clock', () => {
  for (const f of ['../web/styles.css', '../web/core/skins.css', '../web/desktop/desktop.css', '../web/skins/obsidian/skin.css', '../web/skins/landscapes/skin.css']) assert.doesNotMatch(read(f), /\.home-(date|time)[^{]*\{[^}]*display:\s*none/, f);
});
