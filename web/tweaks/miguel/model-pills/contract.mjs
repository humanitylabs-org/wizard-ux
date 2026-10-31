import assert from 'node:assert/strict';
// No row above the chat list; Defer and Done ride beside the switch and go back on teardown.
export default async function check(f) {
  await new Promise(r => setTimeout(r, 0));
  assert.equal(f.list.querySelector('[data-part="model-pills"]'), null); assert.equal(f.list.querySelector('[data-slot="list-top"]')?.children.length || 0, 0);
  assert.equal(f.actions.parentNode.dataset.slot, 'thread-switch-row-end'); await f.clear(); assert.equal(f.actions.parentNode, f.thread);
}
