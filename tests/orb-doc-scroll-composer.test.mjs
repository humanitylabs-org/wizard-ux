// Static guard for James's 8 Nov 2026 report (full-screen Working thread on the Android app: composer narrow and tall,
// Stop short of the edge, orb parked below). The browser proof is qa-orb-doc-scroll-composer.cjs (run it with and
// without QA_DOC=1); this keeps the two rules from being dropped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../web/styles.css', import.meta.url), 'utf8');
const chats = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
test('the corner orb reserves no composer column when the composer is pinned above the bottom strip (Android document scroll)', () => {
  assert.match(css, /html\.wos-doc-scroll \.device\.orb-corner \.wos-doc-thread \.ch-compose\s*\{\s*padding-right:\s*10px;?\s*\}/);
});
test('the pinned composer re-measures the bottom strip on resume and when the dock animation ends', () => {
  assert.match(chats, /\['visibilitychange', 'pageshow', 'focus'\]/);
  assert.match(chats, /'animationend'[^]*?id === 'dock'[^]*?queueDocumentThread/);
});
