import assert from 'node:assert/strict';
export default async function check(f) {
  assert.equal(f.overview?.hold, 'arrange'); assert.equal(f.overview?.appAction, 'home-screen'); assert.equal(f.overview?.appHold, false);
  assert.ok(f.doc.head.children.some(n => n.href?.endsWith('arrange-download/tweak.css')));
  await f.clear(); assert.equal(f.overview, null); assert.equal(f.doc.head.children.length, 0);
}
