// Swipe-back (every skin) fires only on an intentional swipe (James, 23 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { engages, commits, intentional } from '../web/core/swipe-intent.js';

test('subtle swipes never go back', () => {
  assert.equal(commits(45, 5, 80), false, 'the old 40 px flick');
  assert.equal(commits(70, 4, 60), false, 'quick short flick');
  assert.equal(commits(95, 10, 600), false, 'the old 90 px slow drag');
  assert.equal(commits(130, 60, 300), false, 'diagonal drift while scrolling');
  assert.equal(commits(110, 48, 100), false, 'fast but not level');
  assert.equal(engages(16, 2), false, 'a nudge does not move the thread');
  assert.equal(engages(30, 20), false, 'diagonal does not move the thread');
});

test('intentional swipes go back', () => {
  assert.equal(commits(140, 10, 500), true, 'long slow drag');
  assert.equal(commits(90, 8, 120), true, 'deliberate fast flick');
  assert.equal(engages(30, 5), true);
});

test('one threshold both ways: leftward skin swipes use the same rule as swipe-back', () => {
  assert.equal(intentional(-70, 4, 60), false, 'subtle left flick');
  assert.equal(intentional(-100, 8, 600), false, 'short left drag');
  assert.equal(intentional(-140, 10, 500), true, 'long left drag');
  assert.equal(intentional(-95, 6, 120), true, 'deliberate left flick');
  assert.equal(intentional(140, 10, 500), commits(140, 10, 500));
  assert.ok(globalThis.WosSwipeIntent?.intentional, 'classic scripts (skin-host) reach it');
});
