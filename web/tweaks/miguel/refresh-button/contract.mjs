import assert from 'node:assert/strict';
export default async function check(f) {
  assert.deepEqual({ ...f.windowRefresh }, { pull: false });
  assert.ok(f.doc.head.children.some(n => n.href?.endsWith('refresh-button/tweak.css')));
  await f.clear(); assert.equal(f.windowRefresh, null); assert.equal(f.doc.head.children.length, 0);
}
