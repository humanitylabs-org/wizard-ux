import assert from 'node:assert/strict';
export default async function check(f) { f.host.emit('sent', {thread:'s1'}); assert.equal(f.newThreads, 1); await f.clear(); f.host.emit('sent', {thread:'s1'}); assert.equal(f.newThreads, 1); }
