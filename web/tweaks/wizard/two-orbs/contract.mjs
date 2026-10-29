import assert from 'node:assert/strict';
export default async function check(f) {
  assert.equal(f.host.layout, 'two-orb');
  await f.clear();
  assert.equal(f.host.layout, 'classic');
  assert.equal(f.doc.documentElement.dataset.layout, undefined);
}
