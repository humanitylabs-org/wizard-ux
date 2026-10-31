import assert from 'node:assert/strict';
// Wears the Orb layout on both shells (desktop: the orb scene instead of desks; phone: the orb scene on Home only);
// turning it off brings Desks back.
export default async function check(f) {
  assert.equal(f.host.layout, 'orb');
  assert.equal(f.doc.documentElement.dataset.layout, 'orb');
  await f.clear();
  assert.equal(f.host.layout, 'classic');
  assert.equal(f.doc.documentElement.dataset.layout, undefined);
}
