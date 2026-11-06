import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The shared rename sheet is used by both phone and desktop. It must not teach
// the retired task/feature naming rule, and the owner's lock promise stays intact.
test('rename sheet recommends a project home and preserves owner lock copy', () => {
  const source = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
  const start = source.indexOf('Use a short project name, such as Messenger.');
  assert.ok(start >= 0);
  assert.match(source.slice(start, start + 180), /Your name sticks;.*won’t rename it/);
  assert.doesNotMatch(source, /project\s*·\s*feature/i);
});
