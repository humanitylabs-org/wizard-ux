import assert from 'node:assert/strict';
export default async function check(f) { assert.equal(f.actions.parentNode.dataset.slot, 'thread-switch-row-end'); await f.clear(); assert.equal(f.actions.parentNode, f.thread); }
