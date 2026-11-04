import assert from 'node:assert/strict';
// Wears the AI apps layout (phone here; the desktop too, tests/ai-apps-view.test.mjs); off brings the stock shell back.
export default async function check(f) {
  assert.equal(f.host.layout, 'ai-apps');
  assert.equal(f.doc.documentElement.dataset.layout, 'ai-apps');
  await f.clear();
  assert.equal(f.host.layout, 'classic');
  assert.equal(f.doc.documentElement.dataset.layout, undefined);
}
