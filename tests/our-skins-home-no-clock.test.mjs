import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');

test('every skin keeps the shared Home date and clock visible', () => {
  for (const f of ['../web/styles.css', '../web/core/skins.css', '../web/desktop/desktop.css', '../web/skins/obsidian/skin.css', '../web/skins/landscapes/skin.css']) {
    assert.doesNotMatch(read(f), /:is\(\.home-date, \.home-time\)\s*\{\s*display:\s*none|\.home-(?:date|time)[^{]*\{[^}]*display:\s*none/, f);
  }
  const phone = read('../web/app.js'), desktop = read('../web/desktop/desktop.js');
  assert.match(phone, /<div class="home-date" id="homeDate">/);
  assert.match(phone, /<div class="home-time" id="homeTime">/);
  assert.match(desktop, /<div class="home-time">/);
  assert.match(desktop, /<div class="home-date">/);
  assert.doesNotMatch(desktop, /function mineHomeHtml\(\)/, 'Miguel appearances use the same desktop Home renderer');
});
