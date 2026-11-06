import assert from 'node:assert/strict';
// Phone: wears the Apps layout (Home as an app grid, one icon per desk); off brings the stock Home back.
// Desktop: never wears it (tests/apps-home.test.mjs checks the desktop path).
export default async function check(f) {
  assert.equal(f.host.layout, 'apps');
  assert.equal(f.doc.documentElement.dataset.layout, 'apps');
  await f.clear();
  assert.equal(f.host.layout, 'classic');
  assert.equal(f.doc.documentElement.dataset.layout, undefined);
}
