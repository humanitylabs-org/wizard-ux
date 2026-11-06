import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Pull the real `echoed` out of chats.js so the test exercises production code, not a copy.
const src = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const start = src.indexOf('function echoed(turns, p)');
const end = src.indexOf('function retireLanded', start);
assert.ok(start > 0 && end > start, 'echoed() found');
const ctx = {}; vm.runInNewContext(`${src.slice(start, end)}; this.echoed = echoed;`, ctx);
const { echoed } = ctx;

const sentAt = 1_793_511_274_000;
const steer = { id: 'ob1', state: 'sent', steered: true, text: 'Okay, so the solution here has nothing to do with the notebooks app.', sentAt, createdAt: sentAt - 5000, attempts: 1 };
const reply = at => ({ u: null, a: { text: 'Understood', final: true, at }, steers: [] });

test('a steer folded away by compaction retires once a newer final answer is on screen', () => {
  assert.equal(echoed([reply(sentAt + 133_000)], steer), true);
});
test('it stays pending while only an older answer is on screen', () => {
  assert.equal(echoed([reply(sentAt - 60_000)], steer), false);
  assert.equal(echoed([reply(sentAt + 2_000)], steer), false); // inside the clock-skew margin
});
test('a failed turn or a non-final step does not retire it', () => {
  assert.equal(echoed([{ u: null, a: { final: true, failed: true, at: sentAt + 99_000 }, steers: [] }], steer), false);
  assert.equal(echoed([{ u: null, a: { final: false, at: sentAt + 99_000 }, steers: [] }], steer), false);
});
test('a queued steer and an ordinary send keep waiting for their own transcript row', () => {
  assert.equal(echoed([reply(sentAt + 133_000)], { ...steer, steerQueued: true }), false);
  assert.equal(echoed([reply(sentAt + 133_000)], { ...steer, steered: false, runId: 'r1' }), false);
});
test('matching by words still works', () => {
  assert.equal(echoed([{ u: { text: steer.text, at: sentAt, files: [] }, a: null, steers: [] }], steer), true);
});
