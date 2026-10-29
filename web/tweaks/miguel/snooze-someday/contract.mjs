import assert from 'node:assert/strict';
export default async function check(f) { assert.equal(f.host.snoozeOrder, 'last'); assert.equal(f.host.action('snooze', {sessionId:'s1'}), true); await new Promise(r => setTimeout(r, 0)); assert.equal(f.deferred, 's1'); await f.clear(); assert.equal(f.host.snoozeOrder, 'default'); assert.equal(f.host.action('snooze', {sessionId:'s1'}), false); }
