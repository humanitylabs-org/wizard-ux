import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');

test('core CSS keeps the dot for James skins', () => {
  for (const f of ['../web/styles.css', '../web/core/skins.css']) assert.doesNotMatch(read(f), /\.now-card \.pip \{[^}]*display:\s*none/, f);
});
