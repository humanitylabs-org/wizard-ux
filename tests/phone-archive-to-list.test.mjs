import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// James, 7 Nov 2026: on the phone, Archive on the open thread returns to the chats list, even with "Stay on this chat".
test('phone Archive leaves the thread for the list regardless of the After-actions setting', () => {
  const src = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
  // Archive and Snooze share leaveFinishedThread: phone drops the link trail and goes straight to the list.
  assert.match(src, /if \(a === 'done' && w\?\.thread === sid\) leaveFinishedThread\(w, sid\);/);
  assert.match(src, /else \{ ch\(w\.id\)\.trail = \[\]; chatsBack\(w\); \}\n    return true;/);
  assert.match(src, /else if \(!keepThreadOpen\(\) && a !== 'restore' && w && w\.thread === sid\) threadBack\(w\);/);
});
