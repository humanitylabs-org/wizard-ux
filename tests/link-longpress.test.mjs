import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const links = readFileSync(new URL('../web/core/links.js', import.meta.url), 'utf8');
test('long-press link menu: your browser or copy, dark card, never writes into the composer', () => {
  assert.match(links, /data-wl="mine">Open in your browser</);
  assert.match(links, /data-wl="copy">Copy link</);
  assert.doesNotMatch(links, /agent's browser|take a look:/);
  assert.match(links, /background:rgba\(22,14,46,\.98\)/);
  assert.match(links, /clipboard\?\.writeText\(u\.href\)/);
});
