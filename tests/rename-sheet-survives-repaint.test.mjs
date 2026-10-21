// Rename (and other row sheets) live inside the chat pane; live repaints rebuild that pane with innerHTML.
// The open sheet and its focused field must be carried across, or Rename closes before a name can be typed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');

test('chat list and thread repaints keep an open sheet and its focus', () => {
  assert.match(src, /function keptSheet\(el\)/);
  assert.match(src, /function restoreSheet\(el, k\)/);
  const keeps = src.match(/const keepSheet = keptSheet\(el\);/g) || [];
  const restores = src.match(/restoreSheet\(el, keepSheet\);/g) || [];
  assert.equal(keeps.length, 2, 'both pane repaints read the sheet first');
  assert.equal(restores.length, 2, 'both pane repaints put it back');
  assert.match(src, /k\.f\.focus\(\{ preventScroll: true \}\)/, 'focused rename field keeps focus');
});
