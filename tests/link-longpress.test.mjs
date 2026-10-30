import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const links = readFileSync(new URL('../web/core/links.js', import.meta.url), 'utf8');
test('long-press link menu: your browser or copy, dark card, never writes into the composer', () => {
  assert.match(links, /data-wl="mine">Open in your browser</);
  assert.match(links, /data-wl="copy">Copy link</);
  assert.doesNotMatch(links, /agent's browser|take a look:/);
  // The original dark tint stays, but it must sit above the shared opaque panel material.
  assert.match(links, /background:linear-gradient\(rgba\(22,14,46,\.98\),rgba\(22,14,46,\.98\)\),var\(--wz-panel/);
  assert.match(links, /clipboard\?\.writeText\(u\.href\)/);
});

test('own-page links: long-press offers your browser (native bridge) and Download for files; taps on files download', () => {
  assert.match(links, /data-wl="dl">Download</);
  assert.match(links, /openInBrowser/);
  assert.match(links, /if \(isFile\(u\)\) return download\(u, doc\);/);
  assert.match(links, /linkMenu\(doc, 'body', doc\.baseURI\)/);
  assert.doesNotMatch(links, /\|\| inApp\(u\)\) return false;/);
  assert.match(links, /if \(NATIVE && inApp\(u\)\) return;/); // never window.open our own page over the shell
});
