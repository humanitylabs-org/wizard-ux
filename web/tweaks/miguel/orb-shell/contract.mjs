import assert from 'node:assert/strict';
// Desktop: wears the Orb layout; turning it off brings the classic desktop back. Phone: changes nothing.
export default async function check(f) {
  if (f.doc.documentElement.dataset.shell !== 'desktop') { assert.equal(f.host.layout, 'classic'); return; }
  assert.equal(f.host.layout, 'orb');
  assert.equal(f.doc.documentElement.dataset.layout, 'orb');
  await f.clear();
  assert.equal(f.host.layout, 'classic');
  assert.equal(f.doc.documentElement.dataset.layout, undefined);
}
