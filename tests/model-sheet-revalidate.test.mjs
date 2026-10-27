import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Main now refreshes a stale catalogue after ~15 seconds rather than on every tap.
// Keep that behavior and the guard against a refresh repainting a different chat.
test('model sheet revalidates stale catalogues without repainting a different thread', () => {
  const src = readFileSync(new URL('../web/core/chat-power.js', import.meta.url), 'utf8');
  const open = src.slice(src.indexOf("openSheet({ type: 'model'"), src.indexOf('function openFiles'));
  assert.match(open, /M\.stale \? M\.stale\(\) : !M\.ready\) M\.load\(M\.ready\)/);
  assert.doesNotMatch(open, /if \(!M\.ready\) M\.load\(\)/);
  assert.match(open, /sheet !== opened/);
  assert.match(open, /H\.win\(wid\)\?\.thread !== opened\.sid/);
  assert.match(open, /newModel\(ch\(wid\), w\)/);
  assert.match(open, /paint\(sheet\.pane, A\.elOf\(sheet\.pane\)\)/);
});
