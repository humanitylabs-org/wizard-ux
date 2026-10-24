import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');

test('the release layer hides the Home date and clock (every skin)', () => {
  assert.match(read('../web/mine/mine.css'), /html\[data-mine\] :is\(\.home-date, \.home-time\) \{ display: none; \}/);
  for (const d of ['obsidian', 'landscapes']) assert.doesNotMatch(read(`../web/skins/${d}/skin.css`), /\.home-(date|time)[^{]*\{[^}]*display:\s*none/, d);
});

test('James skins and core CSS keep the Home date and clock', () => {
  for (const f of ['../web/styles.css', '../web/core/skins.css', '../web/desktop/desktop.css']) assert.doesNotMatch(read(f), /\.home-(date|time)[^{]*\{[^}]*display:\s*none/, f);
});
