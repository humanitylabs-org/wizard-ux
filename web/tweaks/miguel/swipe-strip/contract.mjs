import assert from 'node:assert/strict';
export default async function check(f) { assert.ok(f.thread.handlers.get('touchend')?.size); await f.clear(); assert.equal(f.thread.handlers.get('touchend').size, 0); }
