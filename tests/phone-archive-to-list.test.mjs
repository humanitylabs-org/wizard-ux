import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// James, 7 Nov 2026: on the phone, Archive on the open thread returns to the chats list, even with "Stay on this chat".
test('phone Archive leaves the thread for the list regardless of the After-actions setting', () => {
  const src = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
  assert.match(src, /else if \(a === 'done' && PHONE\(\) && w\?\.thread === sid\) \{ ch\(w\.id\)\.trail = \[\]; chatsBack\(w\); \}/);
  assert.match(src, /else if \(!keepThreadOpen\(\) && a !== 'restore' && w && w\.thread === sid\) threadBack\(w\);/);
});
