import assert from 'node:assert/strict';
// The CSS switch; the view marked on for the box while the package lives (api.replies.use), off after teardown.
export default async function check(f) {
  assert.ok(f.doc.head.children.some(n => n.href?.endsWith('reply-summary/tweak.css')));
  await f.clear(); assert.equal(f.doc.head.children.length, 0);
}
